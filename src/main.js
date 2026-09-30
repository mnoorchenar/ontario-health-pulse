// App wiring: loads the snapshot, draws the map and detail panel, runs the chat and the Update button.
import {
  REMOTE_DATA_URL, LLM, LOCAL_DATA_URL, BOUNDARIES_URL, DATA_CACHE_NAME, UPDATE_TIMEOUT_MS, FORECAST_HORIZON, STALE_AFTER_DAYS,
} from './config.js';
import {
  INDICATORS, getSeries, latest, change, valueBack, formatDate, formatValue, formatChange, regionName, daysOld, YEAR_WEEKS, indicatorLabel,
} from './data.js';
import { validateSnapshot, knownFromBoundaries } from './validate.js';
import { forecast, FORECAST_EXPLAINER } from './forecast.js';
import { summarize } from './summary.js';
import { answerQuestion, EXAMPLES } from './chat.js';
import { createMap, rampColor, rampGradient, NO_DATA_FILL } from './map.js';
import { renderTrend } from './charts.js';
import { connect, disconnect, askModel, llmReady } from './llm.js';

const $ = (id) => document.getElementById(id);
const state = {
  data: null, geo: null, known: null, regionId: 'ON', ind: 'pos', mode: 'pos:latest', range: 104, showFc: true, view: 'all',
  llm: 'off', mapApi: null,
};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage may be blocked */ } },
};
const theme = () => document.documentElement.getAttribute('data-theme') || 'light';

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------
function dataUrl() {
  const q = new URLSearchParams(location.search).get('data');
  return q && /^data\/[\w.-]+\.json$/.test(q) ? q : LOCAL_DATA_URL; // ?data=data/sample.json for the demo sample only
}

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function boot() {
  $('fatal').hidden = true;
  try {
    const [data, geo] = await Promise.all([loadJson(dataUrl()), loadJson(BOUNDARIES_URL)]);
    const known = knownFromBoundaries(geo);
    const v = validateSnapshot(data, known, null);
    if (!v.ok) throw new Error(v.errors.join('; '));
    Object.assign(state, { data, geo, known });
  } catch (err) {
    $('layout').hidden = true;
    $('fatal').hidden = false;
    $('asof').textContent = 'Data not loaded';
    return;
  }
  readHash();
  buildControls();
  $('layout').hidden = false;
  state.mapApi = createMap($('map'), state.geo, { onSelect: (id) => selectRegion(id, true), tooltip });
  renderAll();
}

// ---------------------------------------------------------------------------------------------
// Hash (shareable state)
// ---------------------------------------------------------------------------------------------
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const r = p.get('r');
  if (r === 'ON' || state.known.ids.map(String).includes(r)) state.regionId = r === 'ON' ? 'ON' : Number(r);
  if (INDICATORS.includes(p.get('i'))) state.ind = p.get('i');
  const m = p.get('m');
  if (m && INDICATORS.some((i) => m === `${i}:latest` || m === `${i}:change`)) state.mode = m;
  else state.mode = `${state.ind}:latest`;
}
function writeHash() {
  const p = new URLSearchParams({ r: String(state.regionId), i: state.ind, m: state.mode });
  try { history.replaceState(null, '', `#${p}`); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------------------------
function buildControls() {
  const d = state.data;
  const modeSel = $('map-mode');
  modeSel.replaceChildren();
  for (const ind of INDICATORS) {
    for (const kind of ['latest', 'change']) {
      const o = document.createElement('option');
      o.value = `${ind}:${kind}`;
      o.textContent = `${indicatorLabel(d, ind)}: ${kind === 'latest' ? 'latest week' : 'change over 4 weeks'}`;
      modeSel.appendChild(o);
    }
  }
  const regionSel = $('region-select');
  regionSel.replaceChildren();
  const all = document.createElement('option');
  all.value = 'ON';
  all.textContent = 'Ontario overall';
  regionSel.appendChild(all);
  for (const p of d.phus.slice().sort((a, b) => a.name.localeCompare(b.name))) {
    const o = document.createElement('option');
    o.value = String(p.id);
    o.textContent = p.name;
    regionSel.appendChild(o);
  }
  const tabs = $('ind-tabs');
  tabs.replaceChildren();
  for (const ind of INDICATORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn';
    b.dataset.ind = ind;
    b.textContent = indicatorLabel(d, ind);
    b.addEventListener('click', () => { state.ind = ind; state.mode = `${ind}:${state.mode.split(':')[1]}`; renderAll(); });
    tabs.appendChild(b);
  }
  const nl = $('notes-list');
  nl.replaceChildren();
  for (const n of d.meta.notes || []) { const li = document.createElement('li'); li.textContent = n; nl.appendChild(li); }
}

function wireStaticEvents() {
  $('map-mode').addEventListener('change', (e) => { state.mode = e.target.value; state.ind = state.mode.split(':')[0]; renderAll(); });
  $('region-select').addEventListener('change', (e) => selectRegion(e.target.value === 'ON' ? 'ON' : Number(e.target.value), false));
  $('range-select').addEventListener('change', (e) => { state.range = Number(e.target.value); renderDetail(); });
  $('fc-toggle').addEventListener('change', (e) => { state.showFc = e.target.checked; renderDetail(); });
  document.querySelectorAll('.seg-btn[data-view]').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    document.querySelectorAll('.seg-btn[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    state.mapApi.setView(state.view);
  }));
  $('theme-btn').addEventListener('click', () => {
    const next = theme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set('ohp-theme', next);
    if (state.data) renderAll();
    syncThemeButton();
  });
  $('update-btn').addEventListener('click', updateData);
  $('retry-btn').addEventListener('click', boot);
  $('chat-form').addEventListener('submit', (e) => { e.preventDefault(); const i = $('chat-input'); const q = i.value.trim(); i.value = ''; if (q) ask(q); });
  $('llm-btn').addEventListener('click', enableSmarter);
  window.addEventListener('online', netStatus);
  window.addEventListener('offline', netStatus);
  netStatus();
  syncThemeButton();
}

function syncThemeButton() {
  const dark = theme() === 'dark';
  $('theme-btn').textContent = dark ? 'Light theme' : 'Dark theme';
  $('theme-btn').setAttribute('aria-pressed', String(dark));
}
function netStatus() { $('net').textContent = navigator.onLine === false ? 'Offline: using saved data' : ''; }

function selectRegion(id, fromMap) {
  state.regionId = id;
  renderAll();
  if (fromMap && window.innerWidth <= 960) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (fromMap) $('detail').focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------
function renderAll() {
  renderHeader();
  renderMap();
  renderDetail();
  writeHash();
  $('map-mode').value = state.mode;
  $('region-select').value = String(state.regionId);
}

function renderHeader() {
  const d = state.data;
  $('asof').textContent = `Data as of ${formatDate(d.meta.latest_data_date)}`;
  const srcs = d.meta.sources.filter((s) => s.id !== 'boundaries').map((s) => s.name);
  $('sources').textContent = `Sources: ${srcs.join('; ')}.`;
  // banners
  const host = $('banners');
  host.querySelectorAll('.dyn').forEach((n) => n.remove());
  const add = (cls, text) => {
    const p = document.createElement('p');
    p.className = `banner dyn ${cls}`;
    p.setAttribute('role', cls === 'danger' ? 'alert' : 'status');
    p.textContent = text;
    host.insertBefore(p, $('update-msg'));
  };
  if (d.meta.synthetic) add('danger', 'SAMPLE DATA, NOT REAL');
  const age = daysOld(d.meta.latest_data_date);
  if (!d.meta.synthetic && age > STALE_AFTER_DAYS) {
    const archived = d.meta.sources.filter((s) => /^archived/i.test(s.status || '')).length;
    add('warn', `The newest week in this snapshot is ${formatDate(d.meta.latest_data_date)}, about ${Math.round(age / 30)} months ago.${archived ? ' The official Ontario files it uses are no longer updated, so this is a historical view.' : ''}`);
  }
}

const tooltip = {
  show(id, ev, pathEl) {
    const tip = $('tip');
    const wrap = tip.parentElement.getBoundingClientRect();
    const s = mapStyle(id);
    tip.textContent = s.short;
    tip.hidden = false;
    let x; let y;
    if (ev) { x = ev.clientX - wrap.left; y = ev.clientY - wrap.top; } else {
      const b = pathEl.getBoundingClientRect(); x = b.left + b.width / 2 - wrap.left; y = b.top + b.height / 2 - wrap.top;
    }
    tip.style.left = `${Math.max(4, Math.min(x + 12, wrap.width - tip.offsetWidth - 4))}px`;
    tip.style.top = `${Math.max(4, y - tip.offsetHeight - 10)}px`;
  },
  hide() { $('tip').hidden = true; },
};

let mapCache = null;
function computeMap() {
  const [ind, kind] = state.mode.split(':');
  const d = state.data;
  const vals = new Map();
  for (const p of d.phus) {
    const s = getSeries(d, p.id, ind);
    const v = kind === 'latest' ? (latest(s) || {}).value : change(s, 4);
    vals.set(p.id, v == null ? null : v);
  }
  const nums = [...vals.values()].filter((v) => v != null);
  let lo = Math.min(...nums);
  let hi = Math.max(...nums);
  let ramp;
  if (kind === 'change') { const m = Math.max(Math.abs(lo), Math.abs(hi), 1e-9); lo = -m; hi = m; ramp = 'div'; } else { ramp = ind === 'pos' ? 'pos' : 'vax'; }
  if (hi === lo) hi = lo + 1;
  mapCache = { ind, kind, vals, lo, hi, ramp };
}

function mapStyle(id) {
  const { ind, kind, vals, lo, hi, ramp } = mapCache;
  const d = state.data;
  const v = vals.get(id);
  const name = regionName(d, id);
  const text = v == null ? 'no data' : kind === 'latest' ? formatValue(v, ind, d) : `${formatChange(v, ind, d)} over 4 weeks`;
  return {
    fill: v == null ? NO_DATA_FILL[theme()] : rampColor(ramp, theme(), (v - lo) / (hi - lo)),
    label: `${name}: ${indicatorLabel(d, ind)}, ${text}. Press Enter to open details.`,
    short: `${name}: ${text}`,
  };
}

function renderMap() {
  computeMap();
  state.mapApi.update(mapStyle, state.regionId);
  const { ind, kind, lo, hi, ramp } = mapCache;
  const d = state.data;
  const legend = $('legend');
  legend.replaceChildren();
  const cap = document.createElement('div');
  cap.className = 'cap';
  cap.textContent = kind === 'latest' ? `${indicatorLabel(d, ind)}, latest week` : `${indicatorLabel(d, ind)}: change compared with 4 weeks earlier`;
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.style.background = rampGradient(ramp, theme());
  const ends = document.createElement('div');
  ends.className = 'ends';
  const mid = document.createElement('span');
  const fmtV = (v) => (kind === 'latest' ? formatValue(v, ind, d) : formatChange(v, ind, d));
  const a = document.createElement('span'); a.textContent = fmtV(lo);
  const b = document.createElement('span'); b.textContent = fmtV(hi);
  if (kind === 'change') mid.textContent = 'no change';
  ends.append(a, mid, b);
  const nd = document.createElement('div');
  nd.className = 'nodata';
  nd.innerHTML = '<span class="sw"></span> <span>No value available</span>';
  nd.firstElementChild.style.background = NO_DATA_FILL[theme()];
  legend.append(cap, bar, ends, nd);
}

function alignedValues(id, ind, dates) {
  const idx = new Map(state.data.dates.map((x, i) => [x, i]));
  const arr = state.data.series[String(id)][ind];
  return dates.map((x) => (idx.has(x) ? arr[idx.get(x)] : null));
}

function td(text, cls) { const c = document.createElement('td'); c.textContent = text; if (cls) c.className = cls; return c; }
function th(text, cls, scope) { const c = document.createElement('th'); c.textContent = text; if (cls) c.className = cls; if (scope) c.scope = scope; return c; }

function renderDetail() {
  const d = state.data;
  const id = state.regionId;
  const ind = state.ind;
  const isON = String(id) === 'ON';
  const name = regionName(d, id);
  $('detail-h').textContent = name;
  const phu = d.phus.find((p) => p.id === id);
  $('detail-sub').textContent = isON ? 'Province-wide figures. Choose a region on the map or in the list.'
    : phu && phu.merged_from && phu.merged_from.length ? 'Formed on 1 January 2025 from earlier units; earlier history is combined.' : 'Public health unit';
  document.querySelectorAll('#ind-tabs .seg-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ind === ind)));
  $('chat-h').textContent = `Ask about ${name}`;

  const s = getSeries(d, id, ind);
  const ont = getSeries(d, 'ON', ind);
  const fcAll = forecast(s.values, { horizon: FORECAST_HORIZON, max: d.meta.indicators[ind].unit === '%' ? 100 : undefined });
  $('summary').textContent = summarize(d, id, ind, fcAll);

  // chart
  const take = state.range > 0 ? Math.min(state.range, s.dates.length) : s.dates.length;
  const dates = s.dates.slice(s.dates.length - take);
  const region = s.values.slice(s.values.length - take);
  const ontario = alignedValues('ON', ind, dates);
  const fc = state.showFc && !fcAll.skipped ? fcAll : null;
  const ok = renderTrend($('chart'), { dates, region, ontario, regionName: name, showOntario: !isON, forecast: fc, ind, data: d });
  const l = latest(s);
  $('chart').setAttribute('aria-label', l ? `Line chart of ${indicatorLabel(d, ind).toLowerCase()} for ${name}, ${formatDate(dates[0])} to ${formatDate(l.date)}. Latest ${formatValue(l.value, ind, d)}. A data table follows.` : 'No data');
  if (!ok) $('chart').replaceWith(Object.assign(document.createElement('p'), { id: 'chart', textContent: 'The chart could not be drawn. The table below has the same numbers.' }));

  // forecast note
  const note = $('fc-note');
  if (fcAll.skipped) note.textContent = `No estimate shown. ${fcAll.reason}`;
  else if (!state.showFc) note.textContent = 'The estimate is hidden. Tick "Show estimate for the next weeks" to see it.';
  else {
    const from = formatDate(dates[dates.length - 1]);
    note.textContent = `Estimate for the ${fcAll.horizon} weeks after ${from}, using ${fcAll.methodLabel}. ${FORECAST_EXPLAINER}`;
  }

  // facts table
  const t = $('facts');
  t.querySelectorAll('thead,tbody').forEach((n) => n.remove());
  const head = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.append(th('Measure', '', 'col'), th(name, 'num', 'col'));
  if (!isON) hr.append(th('Ontario', 'num', 'col'));
  head.append(hr);
  const body = document.createElement('tbody');
  const rowsSpec = [
    [`Latest (week of ${l ? formatDate(l.date) : 'n/a'})`, (ser) => formatValue((latest(ser) || {}).value, ind, d)],
    ['Change from last week', (ser) => formatChange(change(ser, 1), ind, d)],
    ['Change from 4 weeks ago', (ser) => formatChange(change(ser, 4), ind, d)],
    ['Same week last year', (ser) => { const y = valueBack(ser, YEAR_WEEKS); return y == null ? 'n/a' : `${formatValue(y, ind, d)} (${formatChange(change(ser, YEAR_WEEKS), ind, d)})`; }],
  ];
  for (const [label, fn] of rowsSpec) {
    const r = document.createElement('tr');
    r.append(th(label, '', 'row'), td(fn(s), 'num'));
    if (!isON) r.append(td(fn(ont), 'num'));
    body.append(r);
  }
  t.append(head, body);

  // chart table (last 12 weeks + estimate)
  const ct = $('chart-table');
  ct.replaceChildren();
  const ch = document.createElement('thead');
  const chr = document.createElement('tr');
  chr.append(th('Week of', '', 'col'), th(name, 'num', 'col'));
  if (!isON) chr.append(th('Ontario', 'num', 'col'));
  chr.append(th('Estimate range', 'num', 'col'));
  ch.append(chr);
  const cb = document.createElement('tbody');
  const last = dates.slice(-12);
  const lastV = region.slice(-12);
  const lastO = ontario.slice(-12);
  last.forEach((dt, i) => {
    const r = document.createElement('tr');
    r.append(th(formatDate(dt), '', 'row'), td(formatValue(lastV[i], ind, d), 'num'));
    if (!isON) r.append(td(formatValue(lastO[i], ind, d), 'num'));
    r.append(td('', 'num'));
    cb.append(r);
  });
  if (fc) {
    fc.mean.forEach((m, k) => {
      const r = document.createElement('tr');
      const dt = new Date(Date.UTC(...dates[dates.length - 1].split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))))); dt.setUTCDate(dt.getUTCDate() + 7 * (k + 1));
      r.append(th(`${formatDate(dt.toISOString().slice(0, 10))} (estimate)`, '', 'row'), td(formatValue(m, ind, d), 'num'));
      if (!isON) r.append(td('', 'num'));
      r.append(td(`${formatValue(fc.lo[k], ind, d)} to ${formatValue(fc.hi[k], ind, d)}`, 'num'));
      cb.append(r);
    });
  }
  ct.append(ch, cb);

  renderChatMeta();
}

// ---------------------------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------------------------
function renderChips() {
  const host = $('chat-chips');
  host.replaceChildren();
  for (const q of EXAMPLES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = q;
    b.addEventListener('click', () => ask(q));
    host.appendChild(b);
  }
}

function renderChatMeta() {
  $('chat-mode').textContent = state.llm === 'ready'
    ? 'Mode: smarter answers (online model). Any answer with a number not in the data is discarded.'
    : 'Mode: simple rules. Works fully offline. Every number comes from the data.';
  if (!$('chat-chips').children.length) renderChips();
  if (!$('chat-log').children.length) addMsg('bot', 'Hello. Ask me about the selected region, or tap one of the example questions below.', null);
}

function addMsg(role, text, source, examples) {
  const log = $('chat-log');
  const m = document.createElement('div');
  m.className = `msg ${role}`;
  const p = document.createElement('span');
  p.textContent = text;
  m.appendChild(p);
  if (source) { const s = document.createElement('span'); s.className = 'src'; s.textContent = source; m.appendChild(s); }
  if (examples) {
    const c = document.createElement('div');
    c.className = 'chips';
    for (const q of EXAMPLES.slice(0, 4)) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = q;
      b.addEventListener('click', () => ask(q));
      c.appendChild(b);
    }
    m.appendChild(c);
  }
  log.appendChild(m);
  log.scrollTop = log.scrollHeight;
}

async function ask(q) {
  addMsg('user', q);
  let out;
  try {
    out = answerQuestion(q, { data: state.data, regionId: state.regionId, indicator: state.ind });
  } catch (e) {
    out = { text: "I don't have that data.", source: '', examples: true, kind: 'error' };
  }
  if (state.llm === 'ready' && llmReady() && !['medical', 'help', 'empty', 'error'].includes(out.kind)) {
    const r = await askModel(q, state.data, state.regionId);
    if (r) out = { ...out, text: r.text, examples: false };
    else out = { ...out, source: `${out.source} (The smarter mode could not answer this one, so the simple rules were used.)` };
  }
  addMsg('bot', out.text, out.source, out.examples);
}

function fillModels() {
  const sel = $('llm-model');
  sel.replaceChildren();
  for (const m of LLM.models) sel.appendChild(Object.assign(document.createElement('option'), { value: m, textContent: m }));
  sel.appendChild(Object.assign(document.createElement('option'), { value: '__other', textContent: 'Other (type a model id)' }));
  sel.addEventListener('change', () => { $('llm-custom-wrap').hidden = sel.value !== '__other'; });
}

async function enableSmarter() {
  const btn = $('llm-btn');
  const note = $('llm-note');
  if (state.llm === 'ready') {
    disconnect();
    state.llm = 'off';
    $('llm-token').value = '';
    btn.textContent = 'Turn on smarter answers';
    note.textContent = 'Smarter answers are off. The simple rules are in use.';
    renderChatMeta();
    return;
  }
  if (navigator.onLine === false) {
    note.textContent = 'You appear to be offline. Smarter answers need internet, so the simple rules stay on.';
    return;
  }
  const choice = $('llm-model').value;
  const model = choice === '__other' ? $('llm-custom').value : choice;
  btn.disabled = true; btn.classList.add('loading');
  note.textContent = 'Checking your token and the model...';
  const r = await connect($('llm-token').value, model);
  btn.disabled = false; btn.classList.remove('loading');
  if (r.ok) {
    state.llm = 'ready';
    btn.textContent = 'Turn off smarter answers';
    note.textContent = `Smarter answers are on (${model}). If it fails on a question, the simple rules take over.`;
  } else {
    state.llm = 'off';
    note.textContent = `${r.reason} Still using the simple rules.`;
  }
  renderChatMeta();
}

// ---------------------------------------------------------------------------------------------
// Update data
// ---------------------------------------------------------------------------------------------
function say(text, cls = '') {
  const m = $('update-msg');
  m.hidden = false;
  m.className = `banner ${cls}`;
  m.textContent = text;
}

async function saveToCache(text) {
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    await cache.put(new URL(LOCAL_DATA_URL, location.href).href, new Response(text, { headers: { 'Content-Type': 'application/json' } }));
    return true;
  } catch (e) { return false; }
}

async function updateData() {
  const btn = $('update-btn');
  const keep = formatDate(state.data.meta.latest_data_date);
  btn.disabled = true; btn.classList.add('loading');
  say('Checking for newer data...');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPDATE_TIMEOUT_MS);
  try {
    if (navigator.onLine === false) throw new Error('offline');
    const res = await fetch(REMOTE_DATA_URL, { cache: 'no-store', signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const doc = JSON.parse(text);
    const v = validateSnapshot(doc, state.known, state.data);
    if (!v.ok) throw new Error(v.errors[0]);
    if (doc.meta.latest_data_date === state.data.meta.latest_data_date && doc.meta.downloaded === state.data.meta.downloaded) {
      say(`You already have the newest data (as of ${keep}).`);
    } else {
      state.data = doc;
      const saved = await saveToCache(text);
      buildControls();
      renderAll();
      say(`Updated. Now showing data as of ${formatDate(doc.meta.latest_data_date)}.${saved ? '' : ' It could not be saved for offline use.'}`, 'ok');
    }
  } catch (e) {
    say(`Could not update, still showing data from ${keep}.`, 'warn');
  } finally {
    clearTimeout(timer);
    btn.disabled = false; btn.classList.remove('loading');
  }
}

// ---------------------------------------------------------------------------------------------
wireStaticEvents();
fillModels();
boot();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* offline caching unavailable */ }); });
}
