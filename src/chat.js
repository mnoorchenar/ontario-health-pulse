// Rules-based chat: keyword and intent matching over the loaded snapshot. Works fully offline.
// Every number in an answer is calculated by code from the data and listed in `numbers`.
import {
  getSeries, latest, change, formatDate, formatValue, formatChange, trendDirection, rankRegions, regionName,
  indicatorLabel, sourceFor, YEAR_WEEKS, valueBack, roundTo, lc,
} from './data.js';
import { compareToOntario, describeChange } from './summary.js';
import { forecast } from './forecast.js';

export const NO_DATA = "I don't have that data.";

export const EXAMPLES = [
  'What is the latest value here?',
  'How does this region compare with Ontario?',
  'Did it change from last week?',
  'Which region is highest?',
  'Is the trend going up or down?',
  'When was the data last updated?',
  'What does test positivity mean?',
];

const GENERIC = new Set(['public', 'health', 'unit', 'region', 'regional', 'of', 'the', 'and', 'district', 'department', 'services', 'paramedic', 'county', 'ontario']);
// Extra names people use. Old units that merged in 2025 point at today's unit.
const ALIASES = {
  brant: 7652, haldimand: 7652, norfolk: 7652, 'grand erie': 7652,
  peterborough: 7653, kawartha: 7653, haliburton: 7653, 'pine ridge': 7653,
  porcupine: 7654, timiskaming: 7654, timmins: 7654,
  kingston: 7655, frontenac: 7655, hastings: 7655, 'prince edward': 7655, leeds: 7655, grenville: 7655, lanark: 7655,
  oxford: 4913, elgin: 4913, 'st thomas': 4913, huron: 5183, perth: 5183,
  muskoka: 2260, simcoe: 2260, barrie: 2260, essex: 2268, windsor: 2268, london: 2244, middlesex: 2244,
  guelph: 2266, wellington: 2266, dufferin: 2266, bruce: 2233, grey: 2233, 'parry sound': 2247, 'north bay': 2247,
  'thunder bay': 2262, sudbury: 2261, kitchener: 2265, waterloo: 2265, cambridge: 2265, mississauga: 2253, brampton: 2253,
  peel: 2253, york: 2270, toronto: 3895, ottawa: 2251, hamilton: 2237, niagara: 2246, halton: 2236, durham: 2230,
  lambton: 2242, sarnia: 2242, 'chatham kent': 2240, chatham: 2240, algoma: 2226, 'sault ste marie': 2226,
  renfrew: 2257, 'eastern ontario': 2258, cornwall: 2258, northwestern: 2249, 'north western': 2249,
  northeastern: 7654, southeast: 7655, 'south east': 7655, southwestern: 4913, lakelands: 7653,
};

const norm = (s) => ` ${s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
const has = (q, re) => re.test(q);

class Answer {
  constructor() { this.parts = []; this.numbers = new Set(); this.ok = true; this.sourceInd = null; }
  say(text) { this.parts.push(text); return this; }
  num(text) { this.numbers.add(String(text)); return text; }
}

function findRegion(q, data, cities = []) {
  let best = null;
  const consider = (alias, id) => {
    if (q.includes(` ${alias} `) && (!best || alias.length > best.alias.length)) best = { alias, id };
  };
  for (const [alias, id] of Object.entries(ALIASES)) consider(alias, id);
  for (const p of data.phus) {
    const core = p.name.toLowerCase().replace(/[^a-z ]+/g, ' ').split(' ').filter((w) => w && !GENERIC.has(w)).join(' ');
    if (core) consider(core, p.id);
  }
  const before = best;
  for (const c of cities) consider(norm(c.name).trim(), c.phu);
  if (!best) return null;
  const cityHit = best !== before ? cities.find((c) => norm(c.name).trim() === best.alias) : null;
  const phu = data.phus.find((p) => p.id === best.id);
  if (!phu) return null;
  const mergedNote = phu.merged_from && phu.merged_from.length && ['brant', 'haldimand', 'norfolk', 'peterborough', 'kawartha', 'haliburton', 'porcupine', 'timiskaming', 'timmins', 'kingston', 'frontenac', 'hastings', 'leeds', 'grenville', 'lanark', 'prince edward', 'pine ridge'].includes(best.alias);
  if (cityHit && !phu.name.toLowerCase().includes(cityHit.name.toLowerCase())) return { id: phu.id, note: `${cityHit.name} is served by ${phu.name}, so I am using that unit.` };
  return { id: phu.id, note: mergedNote ? `${best.alias.replace(/\b\w/g, (c) => c.toUpperCase())} is now part of ${phu.name}, so I am using that unit.` : null };
}

function findIndicator(q, fallback) {
  if (has(q, /\b(flu|influenza|rsv|hospital|hospitali[sz]ation|icu|death|deaths|mortality|outbreak|cases?)\b/)) return { unsupported: true };
  if (has(q, /\b(booster|boosters|third dose|3 doses?|three doses?|3rd)\b/)) return { ind: 'vax3' };
  if (has(q, /\b(vaccin\w*|immuni[sz]\w*|shots?|doses?|coverage|jab)\b/)) return { ind: 'vax1' };
  if (has(q, /\b(positiv\w*|tests?|testing|covid|covid 19)\b/)) return { ind: 'pos' };
  return { ind: fallback };
}

const DEFINITIONS = [
  [/(positivity|percent positive|test positiv|positive rate)/, (d) => `${d.meta.indicators.pos.help} It reflects who gets tested, so it is not the share of all people who are infected.`],
  [/(booster|3 doses|three doses|third dose)/, (d) => d.meta.indicators.vax3.help],
  [/(coverage|vaccinated|at least one dose|dose)/, (d) => d.meta.indicators.vax1.help],
  [/(phu|public health unit|health unit)/, () => 'A public health unit (PHU) is a local public health agency responsible for one area of Ontario. This app shows 29 of them.'],
  [/(forecast|estimate|prediction)/, () => 'The forecast carries the recent pattern forward for a few weeks. It is an estimate, not a certainty, and the shaded band shows the likely range.'],
  [/(7 day|seven day)/, () => 'A 7-day average smooths out day-to-day ups and downs by averaging the last seven days.'],
  [/(merge|merged|lakelands|grand erie|northeastern|southeast)/, () => 'On 1 January 2025 nine public health units merged into four (Grand Erie, Lakelands, Northeastern, Southeast). Their history is combined here.'],
  [/(points|percentage point)/, () => 'A "point" here means one percentage point, for example going from 4.0% to 5.0% is a rise of 1 point.'],
];

/**
 * @param {string} question
 * @param {{data:object, regionId:number|string, indicator:string}} ctx
 * @returns {{text:string, numbers:string[], source:string, understood:boolean, examples:boolean, kind:string}}
 */
export function answerQuestion(question, ctx) {
  const { data } = ctx;
  const raw = String(question || '').trim();
  const q = norm(raw);
  const a = new Answer();
  const asOf = data.meta.latest_data_date;
  const finish = (kind, ind, understood = true, examples = false) => {
    const src = ind ? `${sourceFor(data, ind)}` : data.meta.sources.filter((s) => s.id !== 'boundaries').map((s) => s.name).join('; ');
    const dateNote = ind ? (data.meta.indicators[ind].latest_date || asOf) : asOf;
    return {
      text: a.parts.join(' '),
      numbers: [...a.numbers],
      source: `Data as of ${formatDate(dateNote)}. Source: ${src}.${data.meta.synthetic ? ' SAMPLE DATA, NOT REAL.' : ''}`,
      understood, examples, kind,
    };
  };

  if (!raw) { a.say('Type a question about the selected region, for example: "What is the latest value here?"'); return finish('empty', null, false, true); }

  // personal medical advice: decline politely
  if (has(q, /\b(should i|can i (take|get|give)|do i have|am i|my (child|kid|son|daughter|baby|symptoms?|doctor|family|mom|dad|mother|father)|diagnos\w*|treat\w*|medicat\w*|prescri\w*|symptoms?|is it safe|cure|dosage|side effects?)\b/)) {
    a.say('I can\'t give personal medical advice. For questions about your own health, please contact a health professional or your local public health unit.');
    return finish('medical', null, true, false);
  }

  if (has(q, /^ (hi|hello|hey|help|what can you do|how does this work) /) || has(q, /\bwhat can (i|you) ask\b/)) {
    a.say('I answer questions about the selected region using the data in this page: latest values, changes, comparisons with Ontario, trends, rankings and what terms mean.');
    return finish('help', null, true, true);
  }

  const region = findRegion(q, data, ctx.cities || []);
  const regionId = region ? region.id : ctx.regionId;
  const name = regionName(data, regionId);
  const indSel = findIndicator(q, ctx.indicator);
  if (indSel.unsupported) {
    a.say(`${NO_DATA} This demo has no influenza, RSV, hospital or case-count data. It covers ${Object.keys(data.meta.indicators).filter((k) => !data.meta.indicators[k].helper).map((k) => lc(indicatorLabel(data, k))).join(', ')}.`);
    return finish('unsupported', null, false, true);
  }
  const ind = indSel.ind;
  const label = lc(indicatorLabel(data, ind));
  const s = getSeries(data, regionId, ind);
  const l = latest(s);
  const ont = getSeries(data, 'ON', ind);
  const ontL = latest(ont);
  const pre = region && region.note ? `${region.note} ` : '';

  function changeAnswer(yearly) {
    const weeks = yearly ? YEAR_WEEKS : 1;
    const d = change(s, weeks);
    if (d == null) { a.say(`${NO_DATA} There is no value from ${yearly ? 'the same week last year' : 'last week'} for ${name}.`); return finish('change', ind, false, true); }
    const then = valueBack(s, weeks);
    const desc = describeChange(d, ind, data, yearly ? 'compared with the same week last year' : 'from last week');
    a.say(`${pre}${name}: ${label} was ${a.num(formatValue(l.value, ind, data))} in the week of ${a.num(formatDate(l.date))}, ${desc.replace(/(\d[\d.,]*)/, (m) => a.num(m))}. The earlier value was ${a.num(formatValue(then, ind, data))}.`);
    return finish('change', ind);
  }

  // when was the data updated
  if (has(q, /\b(updated|update|how old|how recent|fresh|data date|as of|latest data|when is the data)\b/) && !has(q, /\bupdate data\b/)) {
    a.say(`The data in this page runs to ${a.num(formatDate(asOf))} and was downloaded on ${a.num(formatDate(data.meta.downloaded))}.`);
    for (const k of Object.keys(data.meta.indicators)) {
      const im = data.meta.indicators[k];
      if (im.helper) continue;
      a.num(formatDate(im.latest_date));
    }
    a.say(`Each measure has its own latest week: ${Object.keys(data.meta.indicators).filter((k) => !data.meta.indicators[k].helper).map((k) => `${lc(indicatorLabel(data, k))} to ${formatDate(data.meta.indicators[k].latest_date)}`).join('; ')}.`);
    return finish('updated', null);
  }

  // definitions ("what does X mean", "what is a public health unit"), not "what is X in Peel"
  const term = '(positivity|test positivity|percent positive|positive rate|booster|coverage|vaccination coverage|dose|doses|phu|public health unit|health unit|forecast|estimate|7 day average|seven day average|point|points|percentage point|merger|mergers)';
  const askedMeaning = has(q, /\b(mean|meaning|define|definition|explain|stands for)\b/);
  const exactWhatIs = new RegExp(`^ (what (is|are|s|does)) (a |an |the )?${term}( mean| exactly)? $`).test(q);
  if (!region && (exactWhatIs || (askedMeaning && new RegExp(`\b${term}\b`).test(q)))) {
    for (const [re, fn] of DEFINITIONS) {
      if (re.test(q.trim())) {
        const t = fn(data);
        (t.match(/\d[\d.,]*/g) || []).forEach((n) => a.num(n));
        a.say(t);
        return finish('definition', null);
      }
    }
  }

  // ranking: highest / lowest
  const wantsHigh = has(q, /\b(highest|most|worst|top|largest|biggest|greatest|maximum|max)\b/);
  const wantsLow = has(q, /\b(lowest|least|best|smallest|fewest|minimum|min|bottom)\b/);
  if ((wantsHigh || wantsLow) && !region) {
    const rows = rankRegions(data, ind);
    if (!rows.length) { a.say(NO_DATA); return finish('ranking', ind, false, true); }
    const ordered = wantsHigh ? rows : rows.slice().reverse();
    const top = ordered.slice(0, 3);
    const word = wantsHigh ? 'highest' : 'lowest';
    a.say(`For ${label}, the ${word} public health unit is ${top[0].name} at ${a.num(formatValue(top[0].value, ind, data))} (week of ${a.num(formatDate(top[0].date))}).`);
    if (top.length > 1) a.say(`Next: ${top.slice(1).map((t) => `${t.name} (${a.num(formatValue(t.value, ind, data))})`).join(', ')}.`);
    return finish('ranking', ind);
  }

  if (!l || l.value == null) { a.say(`${NO_DATA} There are no ${label} values for ${name}.`); return finish('nodata', ind, false, true); }

  // same time last year (checked before "compare", since people say "compared to last year")
  if (has(q, /\b(last year|year ago|same time|same week|year over year|yearly)\b/)) return changeAnswer(true);

  // compare with Ontario
  if (has(q, /\b(compare|compared|comparison|versus|vs|than ontario|ontario average|provincial|province|average|typical|normal)\b/)) {
    if (!ontL || ontL.value == null) { a.say(NO_DATA); return finish('compare', ind, false, true); }
    const cmp = compareToOntario(l.value, ontL.value, ind, data);
    a.say(`${pre}${name} had ${label} of ${a.num(formatValue(l.value, ind, data))} in the week of ${a.num(formatDate(l.date))}. The Ontario figure was ${a.num(formatValue(ontL.value, ind, data))}, so ${name} was ${cmp} Ontario.`);
    return finish('compare', ind);
  }

  // forecast
  if (has(q, /\b(forecast|predict\w*|projection|expect\w*|next (week|weeks|month)|will it|going to)\b/)) {
    const fc = forecast(s.values, { horizon: 6, max: data.meta.indicators[ind].unit === '%' ? 100 : undefined });
    if (fc.skipped) { a.say(`${NO_DATA} ${fc.reason}`); return finish('forecast', ind, false, true); }
    const diff = fc.mean[fc.mean.length - 1] - l.value;
    const tol = 0.5 * 10 ** -data.meta.indicators[ind].decimals;
    const word = Math.abs(diff) <= tol ? 'stay about the same' : diff > 0 ? 'be higher' : 'be lower';
    a.say(`${pre}The estimate for ${name} is that ${label} may ${word} over the next ${a.num(String(fc.horizon))} weeks after ${a.num(formatDate(l.date))}. The dashed line and shaded band on the chart show the range. It is an estimate, not a certainty.`);
    return finish('forecast', ind);
  }

  // trend
  if (has(q, /\b(trend|trending|rising|falling|increasing|decreasing|direction|better|worse|getting|going up|going down|up or down)\b/)) {
    const dir = trendDirection(s, ind, data, 4);
    if (!dir) { a.say(NO_DATA); return finish('trend', ind, false, true); }
    const d = change(s, 4);
    const word = { rising: 'rising', falling: 'falling', steady: 'steady' }[dir];
    a.say(`${pre}Over the last ${a.num('4')} weeks, ${label} in ${name} has been ${word}: ${a.num(formatValue(valueBack(s, 4), ind, data))} then, ${a.num(formatValue(l.value, ind, data))} in the week of ${a.num(formatDate(l.date))}${d != null ? ` (${a.num(formatChange(d, ind, data))})` : ''}.`);
    return finish('trend', ind);
  }

  // change from last week
  if (has(q, /\b(change|changed|difference|last week|week before|previous week|increase\w*|decrease\w*|up|down|since)\b/)) return changeAnswer(false);

  // latest value
  if (has(q, /\b(latest|current|currently|now|value|level|rate|how (many|much|high|low|bad)|what is|what s|number|percent|percentage|show|tell)\b/) || region || indSel.ind !== ctx.indicator) {
    a.say(`${pre}${name}: ${label} was ${a.num(formatValue(l.value, ind, data))} in the week of ${a.num(formatDate(l.date))}.`);
    if (ontL && ontL.value != null && String(regionId) !== 'ON') a.say(`Ontario overall was ${a.num(formatValue(ontL.value, ind, data))}.`);
    return finish('latest', ind);
  }

  a.say(`${NO_DATA} I can help with the latest value, changes, comparisons, trends, rankings and what terms mean.`);
  return finish('unknown', null, false, true);
}

/** Facts block for the optional language model: only numbers that come from the data. */
export function buildFactsBlock(data, regionId) {
  const lines = [];
  lines.push(`Region: ${regionName(data, regionId)}`);
  lines.push(`Data as of: ${formatDate(data.meta.latest_data_date)}${data.meta.synthetic ? ' (SAMPLE DATA, NOT REAL)' : ''}`);
  for (const ind of ['pos', 'vax1', 'vax3']) {
    const s = getSeries(data, regionId, ind);
    const l = latest(s);
    if (!l) continue;
    const ont = latest(getSeries(data, 'ON', ind));
    const wk = change(s, 1);
    const yr = change(s, YEAR_WEEKS);
    const dir = trendDirection(s, ind, data, 4);
    let line = `${indicatorLabel(data, ind)}: ${formatValue(l.value, ind, data)} (week of ${formatDate(l.date)})`;
    if (ont) line += `; Ontario ${formatValue(ont.value, ind, data)}`;
    if (wk != null) line += `; change from last week ${formatChange(wk, ind, data)}`;
    if (yr != null) line += `; change from same week last year ${formatChange(yr, ind, data)}`;
    if (dir) line += `; last 4 weeks ${dir}`;
    lines.push(line);
  }
  return lines.join('\n');
}

/** True if every number in `text` also appears in `facts` (used to reject invented numbers from a model). */
export function numbersAreGrounded(text, facts) {
  const tokens = (text.match(/\d[\d,]*\.?\d*/g) || []).map((t) => t.replace(/[.,]$/, ''));
  const pool = new Set((facts.match(/\d[\d,]*\.?\d*/g) || []).map((t) => t.replace(/[.,]$/, '')));
  return tokens.every((t) => pool.has(t) || pool.has(t.replace(/,/g, '')));
}
