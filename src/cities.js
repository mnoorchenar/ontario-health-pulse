// City and town search. data/cities.json maps each place to the public health unit it falls in.

export const normalizePlace = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\bsaint\b/g, 'st').replace(/\bste\b/g, 'ste').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Find what the user typed: an exact city, else a unique city that starts with it, else a public health unit name.
 * @returns {{city:object}|{phu:object}|null}
 */
export function findPlace(query, cities, phus) {
  const q = normalizePlace(query);
  if (q.length < 2) return null;
  const exact = cities.find((c) => normalizePlace(c.name) === q);
  if (exact) return { city: exact };
  const starts = cities.filter((c) => normalizePlace(c.name).startsWith(q));
  if (starts.length === 1) return { city: starts[0] };
  const unit = phus.find((p) => normalizePlace(p.name) === q) || phus.filter((p) => normalizePlace(p.name).includes(q))[0];
  if (unit && q.length >= 4) return { phu: unit };
  if (starts.length > 1) return { city: starts.sort((a, b) => a.name.length - b.name.length)[0] };
  return null;
}
