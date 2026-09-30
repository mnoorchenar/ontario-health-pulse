import { readFileSync } from 'node:fs';

export const data = JSON.parse(readFileSync(new URL('../data/data.json', import.meta.url), 'utf8'));
export const boundaries = JSON.parse(readFileSync(new URL('../data/phu_boundaries.geojson', import.meta.url), 'utf8'));
export const clone = (x) => JSON.parse(JSON.stringify(x));
