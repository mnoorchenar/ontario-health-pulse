// Browser-side validation of a data snapshot, used at start-up and by the "Update data" button.
// It mirrors the checks in scripts/build_data.py: structure, known PHU names, plausible numbers, dates.

const INDS = ['pos', 'vol', 'vax1', 'vax3'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {object} doc      candidate snapshot (parsed JSON)
 * @param {{ids:number[], names:Record<string,string>}} known  known PHUs from the boundary file
 * @param {object|null} current  snapshot currently in use (for the "newer or equal" date rule)
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateSnapshot(doc, known, current = null) {
  const errors = [];
  const fail = (m) => errors.push(m);
  if (!doc || typeof doc !== 'object') return { ok: false, errors: ['not a JSON object'] };
  const { meta, phus, dates, series } = doc;
  if (!meta || !Array.isArray(phus) || !Array.isArray(dates) || !series || typeof series !== 'object') {
    return { ok: false, errors: ['missing meta, phus, dates or series'] };
  }
  if (meta.schema !== 1) fail('unsupported schema version');
  if (typeof meta.synthetic !== 'boolean') fail('meta.synthetic must be true or false');
  if (!ISO.test(meta.latest_data_date || '')) fail('meta.latest_data_date is not a date');
  if (!meta.indicators || !meta.indicators.pos || !meta.indicators.vax1 || !meta.indicators.vax3) fail('indicator definitions missing');
  if (!Array.isArray(meta.sources) || meta.sources.length === 0) fail('source list is missing');

  // known PHU list
  const ids = phus.map((p) => p && p.id);
  if (ids.length !== known.ids.length || !known.ids.every((i) => ids.includes(i))) fail('the list of public health units is not the expected one');
  for (const p of phus) {
    if (!p || known.names[String(p.id)] !== p.name) { fail(`unexpected public health unit name: ${p && p.name}`); break; }
  }

  // dates
  if (dates.length < 8) fail('too few dates');
  let prev = '';
  for (const d of dates) {
    if (typeof d !== 'string' || !ISO.test(d) || Number.isNaN(Date.parse(d)) || d <= prev) { fail('dates are invalid or not increasing'); break; }
    prev = d;
  }

  // series
  const wanted = ['ON', ...known.ids.map(String)];
  if (Object.keys(series).length !== wanted.length || !wanted.every((k) => k in series)) fail('series do not match the public health unit list');
  let points = 0;
  outer: for (const k of wanted) {
    const s = series[k];
    if (!s) continue;
    for (const ind of INDS) {
      const v = s[ind];
      if (!Array.isArray(v) || v.length !== dates.length) { fail(`series ${k}.${ind} has the wrong length`); break outer; }
      for (const x of v) {
        if (x === null) continue;
        if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) { fail(`series ${k}.${ind} has a negative or invalid number`); break outer; }
        if (ind !== 'vol' && x > 100) { fail(`series ${k}.${ind} has a percentage above 100`); break outer; }
        if (ind === 'vol' && (x > 200000 || (x > 0 && x < 5))) { fail(`series ${k}.vol is implausible or an unmasked small count`); break outer; }
        points++;
      }
    }
  }
  if (points < 1000) fail('suspiciously little data');

  // never silently swap real data for sample data
  if (current && !errors.length) {
    if (meta.latest_data_date < current.meta.latest_data_date) fail(`the new data (${meta.latest_data_date}) is older than what is shown (${current.meta.latest_data_date})`);
    if (meta.synthetic && !current.meta.synthetic) fail('sample data cannot replace real data');
  }
  return { ok: errors.length === 0, errors };
}

/** Build the known-PHU lookup from the GeoJSON boundary file. */
export function knownFromBoundaries(geojson) {
  const ids = [];
  const names = {};
  for (const f of geojson.features) {
    ids.push(f.properties.id);
    names[String(f.properties.id)] = f.properties.name;
  }
  return { ids, names };
}
