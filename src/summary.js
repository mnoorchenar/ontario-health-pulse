// Plain-language summary written by code from the numbers. No numbers are invented here.
import {
  getSeries, latest, change, formatDate, formatValue, formatChange, trendDirection, rankRegions, regionName, roundTo, YEAR_WEEKS, valueBack, lc,
} from './data.js';

const ORD = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function describeChange(d, ind, data, unitWord = 'from last week') {
  if (d == null) return null;
  const txt = formatChange(d, ind, data);
  if (txt === 'no change') return `unchanged ${unitWord}`;
  return `${d > 0 ? 'up' : 'down'} ${txt.replace(/^[+−]/, '')} ${unitWord}`;
}

export function compareToOntario(v, ont, ind, data) {
  if (v == null || ont == null) return null;
  const a = roundTo(v, ind, data);
  const b = roundTo(ont, ind, data);
  if (a === b) return 'about the same as';
  return a > b ? 'higher than' : 'lower than';
}

export function summarize(data, regionId, ind, fc) {
  const meta = data.meta.indicators[ind];
  const name = regionName(data, regionId);
  const s = getSeries(data, regionId, ind);
  const l = latest(s);
  if (!l || l.value == null) return `${name} has no ${lc(meta.label)} values in this data.`;
  const ont = getSeries(data, 'ON', ind);
  const ontL = latest(ont);
  const parts = [];
  const wk = change(s, 1);
  let first = `In ${name}, ${lc(meta.label)} was ${formatValue(l.value, ind, data)} in the week of ${formatDate(l.date)}`;
  const wkTxt = describeChange(wk, ind, data);
  if (wkTxt) first += `, ${wkTxt}`;
  parts.push(first + '.');

  const cmp = ontL && compareToOntario(l.value, ontL.value, ind, data);
  if (cmp) parts.push(`That is ${cmp} the Ontario figure of ${formatValue(ontL.value, ind, data)}.`);

  const dir = trendDirection(s, ind, data, 4);
  if (dir) {
    const word = { rising: 'has been rising', falling: 'has been falling', steady: 'has stayed about the same' }[dir];
    parts.push(`Over the last 4 weeks it ${word}.`);
  }
  const yr = valueBack(s, YEAR_WEEKS);
  if (yr != null) {
    const d = l.value - yr;
    const t = describeChange(d, ind, data, 'compared with the same week last year');
    if (t) parts.push(`It is ${t}.`);
  }
  const ranks = rankRegions(data, ind);
  const pos = ranks.findIndex((r) => String(r.id) === String(regionId));
  if (pos >= 0 && String(regionId) !== 'ON') parts.push(`Among the ${ranks.length} public health units it ranks ${ORD(pos + 1)} from the top.`);

  if (fc && !fc.skipped) {
    const last = fc.mean[fc.mean.length - 1];
    const diff = last - l.value;
    const tol = 0.5 * 10 ** -meta.decimals;
    const word = Math.abs(diff) <= tol ? 'about the same' : diff > 0 ? 'higher values' : 'lower values';
    parts.push(`The estimate for the next ${fc.horizon} weeks points to ${word} (see the dashed line; this is an estimate, not a certainty).`);
  }
  return parts.join(' ');
}
