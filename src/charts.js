// Trend chart (Chart.js, bundled in vendor/). Shows the region, the Ontario line and an optional forecast band.
import { formatDate, addDays, formatValue } from './data.js';

let chart = null;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const withAlpha = (rgb, a) => (rgb.startsWith('#') ? `${rgb}${Math.round(a * 255).toString(16).padStart(2, '0')}` : rgb);

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{dates:string[], region:(number|null)[], ontario:(number|null)[], regionName:string, showOntario:boolean,
 *          forecast:null|{mean:number[],lo:number[],hi:number[]}, ind:string, data:object}} o
 */
export function renderTrend(canvas, o) {
  if (typeof Chart === 'undefined') return false;
  const primary = css('--primary');
  const accent = css('--accent');
  const muted = css('--muted');
  const grid = css('--border');
  const n = o.dates.length;
  const fc = o.forecast;
  const futureDates = fc ? fc.mean.map((_, k) => addDays(o.dates[n - 1], 7 * (k + 1))) : [];
  const labels = [...o.dates, ...futureDates];
  const pad = (arr) => [...arr, ...futureDates.map(() => null)];
  const lead = (arr) => [...o.dates.slice(0, n - 1).map(() => null), o.region[n - 1], ...arr];
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const datasets = [];
  if (fc) {
    datasets.push({
      label: 'lo', data: lead(fc.lo), borderWidth: 0, pointRadius: 0, fill: false, order: 5, spanGaps: false,
    });
    datasets.push({
      label: 'Likely range (about 4 in 5)', data: lead(fc.hi), borderWidth: 0, pointRadius: 0, fill: '-1', order: 4,
      backgroundColor: withAlpha(primary, 0.2), spanGaps: false,
    });
    datasets.push({
      label: 'Estimate (not a certainty)', data: lead(fc.mean), borderColor: primary, borderDash: [7, 5], borderWidth: 2.5,
      pointRadius: 0, order: 2, spanGaps: false,
    });
  }
  if (o.showOntario) {
    datasets.push({
      label: 'Ontario', data: pad(o.ontario), borderColor: accent, backgroundColor: accent, borderWidth: 2, pointRadius: 0,
      tension: 0.25, order: 3, spanGaps: false,
    });
  }
  datasets.push({
    label: o.regionName, data: pad(o.region), borderColor: primary, backgroundColor: primary, borderWidth: 3, pointRadius: 0,
    pointHoverRadius: 5, tension: 0.25, order: 1, spanGaps: false,
  });

  const cfg = {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: reduce ? 0 : 450 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: muted, font: { size: 14 }, usePointStyle: true, boxWidth: 10, filter: (i) => i.text !== 'lo' },
        },
        tooltip: {
          filter: (i) => i.dataset.label !== 'lo' && i.parsed.y != null,
          titleFont: { size: 14 }, bodyFont: { size: 14 },
          callbacks: {
            title: (items) => (items[0] ? `Week of ${formatDate(items[0].label)}` : ''),
            label: (i) => `${i.dataset.label}: ${formatValue(i.parsed.y, o.ind, o.data)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: muted, font: { size: 13 }, maxTicksLimit: 7, maxRotation: 0,
            callback(v) { const s = this.getLabelForValue(v); return formatDate(s).replace(/^\d+ /, ''); },
          },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: muted, font: { size: 13 }, callback: (v) => formatValue(v, o.ind, o.data).replace(/\.0+(?=%|$)/, '') },
          grid: { color: grid },
        },
      },
    },
  };
  if (chart) chart.destroy();
  chart = new Chart(canvas, cfg);
  return true;
}

export function destroyChart() {
  if (chart) { chart.destroy(); chart = null; }
}

let ageChart = null;

/** Grouped bars by age group for the region, with the Ontario "at least one dose" value as markers. */
export function renderAgeVax(canvas, o) {
  if (typeof Chart === 'undefined') return false;
  const primary = css('--primary');
  const accent = css('--accent');
  const muted = css('--muted');
  const text = css('--text');
  const grid = css('--border');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const datasets = [
    { type: 'bar', label: 'At least one dose', data: o.region.dose1, backgroundColor: withAlpha(primary, 0.4), borderColor: primary, borderWidth: 1.5, order: 2 },
    { type: 'bar', label: 'Fully vaccinated', data: o.region.full, backgroundColor: withAlpha(primary, 0.85), borderColor: primary, borderWidth: 1.5, order: 2 },
    { type: 'bar', label: '3 or more doses', data: o.region.dose3, backgroundColor: accent, borderColor: accent, borderWidth: 1.5, order: 2 },
  ];
  if (!o.isOntario) {
    datasets.push({ type: 'line', label: 'Ontario: at least one dose', data: o.ontario.dose1, showLine: false, pointStyle: 'rectRot', pointRadius: 6, pointBorderWidth: 2, borderColor: text, backgroundColor: css('--surface'), order: 1 });
  }
  const cfg = {
    type: 'bar',
    data: { labels: o.groups, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: reduce ? 0 : 450 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: muted, font: { size: 13 }, boxWidth: 12 } },
        tooltip: {
          titleFont: { size: 14 }, bodyFont: { size: 14 },
          callbacks: {
            title: (items) => (items[0] ? `Ages ${items[0].label}` : ''),
            label: (i) => `${i.dataset.label}: ${i.parsed.y == null ? 'no data' : `${i.parsed.y.toFixed(1)}%`}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: muted, font: { size: 13 } }, grid: { display: false }, title: { display: true, text: 'Age group', color: muted } },
        y: { beginAtZero: true, max: 100, ticks: { color: muted, font: { size: 13 }, callback: (v) => `${v}%` }, grid: { color: grid } },
      },
    },
  };
  if (ageChart) ageChart.destroy();
  ageChart = new Chart(canvas, cfg);
  return true;
}
