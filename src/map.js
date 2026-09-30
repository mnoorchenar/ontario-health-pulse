// Choropleth map drawn as plain SVG from data/phu_boundaries.geojson. No tiles, no external calls.

const NS = 'http://www.w3.org/2000/svg';
const WIDTH = 1000;
const LAT0 = 49; // projection centre latitude for the simple equirectangular scaling
const KX = Math.cos((LAT0 * Math.PI) / 180);
// bounding boxes [minLon, minLat, maxLon, maxLat]
const VIEWS = { all: null, south: [-83.6, 41.6, -74.0, 46.3] };

const project = ([lon, lat]) => [lon * KX, -lat];

function bounds(geojson) {
  let a = Infinity; let b = Infinity; let c = -Infinity; let d = -Infinity;
  for (const f of geojson.features) {
    for (const poly of f.geometry.coordinates) for (const ring of poly) for (const [lon, lat] of ring) {
      if (lon < a) a = lon; if (lat < b) b = lat; if (lon > c) c = lon; if (lat > d) d = lat;
    }
  }
  return [a, b, c, d];
}

function el(name, attrs = {}) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function createMap(container, geojson, { onSelect, tooltip }) {
  const box = bounds(geojson);
  const viewBox = (bb) => {
    const [x1, y1] = project([bb[0], bb[3]]);
    const [x2, y2] = project([bb[2], bb[1]]);
    const w = x2 - x1;
    const h = y2 - y1;
    return { x: x1, y: y1, w, h, scale: WIDTH / w };
  };
  const full = viewBox(box);
  const svg = el('svg', { class: 'map-svg', role: 'group', 'aria-label': 'Map of Ontario public health units. Each area can be selected with Tab and Enter.', focusable: 'false' });
  const g = el('g');
  svg.appendChild(g);
  const paths = new Map();
  const fmt = (n) => n.toFixed(1);

  for (const f of geojson.features) {
    let d = '';
    for (const poly of f.geometry.coordinates) for (const ring of poly) {
      ring.forEach((pt, i) => {
        const [x, y] = project(pt);
        d += `${i ? 'L' : 'M'}${fmt((x - full.x) * full.scale)} ${fmt((y - full.y) * full.scale)}`;
      });
      d += 'Z';
    }
    const p = el('path', { d, class: 'phu', tabindex: '0', role: 'button', 'data-id': f.properties.id, 'fill-rule': 'evenodd' });
    p.addEventListener('click', () => onSelect(f.properties.id));
    p.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(f.properties.id); }
    });
    const show = (e) => tooltip.show(f.properties.id, e, p);
    p.addEventListener('pointermove', show);
    p.addEventListener('pointerenter', show);
    p.addEventListener('pointerleave', () => tooltip.hide());
    p.addEventListener('focus', () => tooltip.show(f.properties.id, null, p));
    p.addEventListener('blur', () => tooltip.hide());
    g.appendChild(p);
    paths.set(f.properties.id, p);
  }
  const cityLayer = el('g', { class: 'city-layer', 'aria-hidden': 'true' });
  const markerLayer = el('g', { class: 'marker-layer', 'aria-hidden': 'true' });
  svg.append(cityLayer, markerLayer);
  container.replaceChildren(svg);

  const xy = (lon, lat) => { const [x, y] = project([lon, lat]); return [(x - full.x) * full.scale, (y - full.y) * full.scale]; };
  const LEFT = new Set(['Hamilton', 'Sarnia', 'Kitchener', 'Sault Ste. Marie', 'Ottawa', 'Kingston', 'Sudbury']);
  let currentView = 'all';
  let cityNodes = [];
  let marker = null;

  /** Keep dots and text a constant size on screen whatever the zoom. */
  function applyScale() {
    const vb = svg.viewBox.baseVal;
    const px = svg.getBoundingClientRect().width || 500;
    const k = vb.width / px;
    const flag = currentView === 'south' ? 'S' : 'A';
    for (const n of cityNodes) {
      n.g.style.display = n.flags.includes(flag) && !(marker && marker.name === n.name) ? '' : 'none';
      n.dot.setAttribute('r', (3.4 * k).toFixed(2));
      const left = LEFT.has(n.name);
      n.text.setAttribute('x', ((left ? -6 : 6) * k).toFixed(2));
      n.text.setAttribute('y', (4 * k).toFixed(2));
      n.text.setAttribute('text-anchor', left ? 'end' : 'start');
      n.text.style.fontSize = `${(12.5 * k).toFixed(2)}px`;
      n.text.style.strokeWidth = `${(3 * k).toFixed(2)}px`;
    }
    if (marker) {
      marker.ring.setAttribute('r', (8 * k).toFixed(2));
      marker.ring.style.strokeWidth = `${(3 * k).toFixed(2)}px`;
      marker.text.setAttribute('x', (11 * k).toFixed(2));
      marker.text.setAttribute('y', (-9 * k).toFixed(2));
      marker.text.style.fontSize = `${(14 * k).toFixed(2)}px`;
      marker.text.style.strokeWidth = `${(3.5 * k).toFixed(2)}px`;
    }
  }

  function setView(name) {
    currentView = name;
    const bb = VIEWS[name] || box;
    const v = viewBox(bb);
    svg.setAttribute('viewBox', `${fmt((v.x - full.x) * full.scale)} ${fmt((v.y - full.y) * full.scale)} ${fmt(v.w * full.scale)} ${fmt(v.h * full.scale)}`);
    applyScale();
  }
  setView('all');
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(applyScale).observe(container);

  return {
    setView,
    /** Draw small labelled dots for the main cities (those with a label flag in cities.json). */
    setCities(list) {
      cityLayer.replaceChildren();
      cityNodes = [];
      for (const c of list.filter((x) => x.label)) {
        const [x, y] = xy(c.lon, c.lat);
        const grp = el('g', { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, class: 'city' });
        const dot = el('circle', { class: 'city-dot' });
        const text = el('text', { class: 'city-label' });
        text.textContent = c.name;
        grp.append(dot, text);
        cityLayer.appendChild(grp);
        cityNodes.push({ g: grp, dot, text, name: c.name, flags: c.label });
      }
      applyScale();
    },
    /** Show a pin on a searched city (null to remove). */
    setMarker(c) {
      markerLayer.replaceChildren();
      marker = null;
      if (c) {
        const [x, y] = xy(c.lon, c.lat);
        const grp = el('g', { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` });
        const ring = el('circle', { class: 'marker-ring' });
        const text = el('text', { class: 'marker-label' });
        text.textContent = c.name;
        grp.append(ring, text);
        markerLayer.appendChild(grp);
        marker = { ring, text, name: c.name };
        applyScale();
      }
    },
    /** @param {(id:number)=>{fill:string,label:string}} styleFor */
    update(styleFor, selectedId) {
      for (const [id, p] of paths) {
        const s = styleFor(id);
        p.setAttribute('fill', s.fill);
        p.setAttribute('aria-label', s.label);
        p.setAttribute('aria-pressed', String(String(id) === String(selectedId)));
        p.classList.toggle('selected', String(id) === String(selectedId));
      }
      const sel = paths.get(Number(selectedId));
      if (sel) g.appendChild(sel); // draw the selected outline on top
    },
    focus(id) { const p = paths.get(Number(id)); if (p) p.focus(); },
  };
}

/** Sequential / diverging colour ramps. Blue = testing, green = vaccination, blue-to-amber = change. */
const RAMPS = {
  light: {
    pos: ['#e8f3fb', '#b3d6ee', '#69aed9', '#2d7db3', '#0a4a78'],
    vax: ['#e7f5ee', '#b1e0ca', '#6fc5a2', '#2f9a78', '#0d6550'],
    div: ['#1f6fa6', '#8fc1e3', '#f1f1ee', '#f0c48f', '#b8651a'],
  },
  dark: {
    pos: ['#16344a', '#1f5a80', '#2f86b5', '#63b3e0', '#b4dcf4'],
    vax: ['#123a30', '#1b6650', '#2f9a78', '#66c9a5', '#b3ead4'],
    div: ['#6cb6ec', '#2f6e9b', '#2a3641', '#9a6a2f', '#f0b56a'],
  },
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => `rgb(${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t)).join(',')})`;

export function rampColor(kind, theme, t) {
  const ramp = RAMPS[theme][kind];
  const x = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  return mix(ramp[i], ramp[i + 1], x - i);
}

export function rampGradient(kind, theme) {
  return `linear-gradient(90deg, ${RAMPS[theme][kind].join(', ')})`;
}
export const NO_DATA_FILL = { light: '#cfd8df', dark: '#3a4956' };
