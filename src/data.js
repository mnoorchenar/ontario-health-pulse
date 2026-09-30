// Helpers for reading the snapshot. Pure functions, no DOM.

export const INDICATORS = ['pos', 'vax1', 'vax3'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Series for one region and indicator, trimmed to the first and last real values. */
export function getSeries(data, id, ind) {
  const key = String(id);
  const vals = data.series[key] && data.series[key][ind];
  if (!vals) return { dates: [], values: [] };
  let a = 0;
  let b = vals.length - 1;
  while (a <= b && vals[a] == null) a++;
  while (b >= a && vals[b] == null) b--;
  return { dates: data.dates.slice(a, b + 1), values: vals.slice(a, b + 1) };
}

/** Value at `weeksBack` weeks before the latest point (null if not available). */
export function valueBack(series, weeksBack) {
  const i = series.values.length - 1 - weeksBack;
  return i >= 0 ? series.values[i] : null;
}

export function latest(series) {
  const n = series.values.length;
  if (!n) return null;
  return { date: series.dates[n - 1], value: series.values[n - 1] };
}

/** Latest value minus the value `weeksBack` earlier. Null if either is missing. */
export function change(series, weeksBack) {
  const cur = latest(series);
  const prev = valueBack(series, weeksBack);
  if (!cur || cur.value == null || prev == null) return null;
  return cur.value - prev;
}

/** Same time last year: the point 52 weeks earlier (grid is weekly). */
export const YEAR_WEEKS = 52;

export function regionName(data, id) {
  if (String(id) === 'ON') return 'Ontario';
  const p = data.phus.find((x) => String(x.id) === String(id));
  return p ? p.name : String(id);
}

/** Round the way we display, so ranks and "same as" comparisons match what people see. */
export function roundTo(v, ind, data) {
  const dec = data.meta.indicators[ind].decimals;
  const f = 10 ** dec;
  return Math.round(v * f) / f;
}

export function formatValue(v, ind, data) {
  if (v == null || Number.isNaN(v)) return 'no data';
  const meta = data.meta.indicators[ind];
  const s = v.toLocaleString('en-CA', { minimumFractionDigits: meta.decimals, maximumFractionDigits: meta.decimals });
  return meta.unit === '%' ? `${s}%` : s;
}

export function formatChange(d, ind, data) {
  if (d == null) return 'n/a';
  const meta = data.meta.indicators[ind];
  const r = Math.abs(d).toLocaleString('en-CA', { minimumFractionDigits: meta.decimals, maximumFractionDigits: meta.decimals });
  const isZero = Number(r.replace(/,/g, '')) === 0;
  if (isZero) return 'no change';
  const sign = d > 0 ? '+' : '−';
  return meta.unit === '%' ? `${sign}${r} points` : `${sign}${r}`;
}

/** 'rising' | 'falling' | 'steady' using a tolerance that scales with the indicator. */
export function trendDirection(series, ind, data, weeks = 4) {
  const d = change(series, weeks);
  if (d == null) return null;
  const dec = data.meta.indicators[ind].decimals;
  const tol = Math.max(0.5 * 10 ** -dec, 0.03 * Math.abs(latest(series).value || 0));
  if (Math.abs(d) <= tol) return 'steady';
  return d > 0 ? 'rising' : 'falling';
}

/** Latest value of every region for an indicator, sorted high to low. Ontario excluded. */
export function rankRegions(data, ind) {
  const rows = [];
  for (const p of data.phus) {
    const s = getSeries(data, p.id, ind);
    const l = latest(s);
    if (l && l.value != null) rows.push({ id: p.id, name: p.name, value: l.value, date: l.date });
  }
  rows.sort((a, b) => b.value - a.value);
  return rows;
}

export function indicatorLabel(data, ind) {
  return data.meta.indicators[ind].label;
}

export function sourceFor(data, ind) {
  const src = data.meta.indicators[ind].source;
  const s = data.meta.sources.find((x) => x.id === src);
  return s ? s.name : 'Ontario open data';
}

/** Whole days between an ISO date and today (positive = in the past). */
export function daysOld(iso, now = new Date()) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor((now.getTime() - Date.UTC(y, m - 1, d)) / 86400000);
}

/** Lower-case a label for use inside a sentence, keeping COVID-19 capitalised. */
export function lc(text) {
  return text.toLowerCase().replace(/covid-19/g, 'COVID-19');
}
