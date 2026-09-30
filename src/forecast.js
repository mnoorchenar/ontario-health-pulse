// Explainable forecasting: exponential smoothing.
//  - "holt": damped-trend exponential smoothing (level + slowly fading trend).
//  - "hw":   Holt-Winters additive seasonal smoothing (adds a repeating yearly pattern), used only when the
//            series holds at least two full years and it beats "holt" on a hold-out test.
// The uncertainty band is empirical: it uses how far off the chosen method was, at each horizon, in the past.

export const MIN_POINTS = 12;
const SEASON = 52;
const Z80 = 1.2816; // 80% band

function fillGaps(values) {
  const v = values.slice();
  for (let i = 0; i < v.length; i++) {
    if (v[i] != null) continue;
    let j = i;
    while (j < v.length && v[j] == null) j++;
    const left = i > 0 ? v[i - 1] : null;
    const right = j < v.length ? v[j] : null;
    for (let k = i; k < j; k++) {
      if (left != null && right != null) v[k] = left + ((right - left) * (k - i + 1)) / (j - i + 1);
      else v[k] = left != null ? left : right;
    }
    i = j;
  }
  return v;
}

/** Run the smoother over `y`; returns final state and one-step-ahead errors. */
function filter(y, p, seasonal) {
  const { alpha, beta, phi, gamma } = p;
  const n = y.length;
  let level;
  let trend = 0;
  let season = null;
  let start = 1;
  if (seasonal) {
    // initialise from the first two seasons
    const m = SEASON;
    const mean1 = y.slice(0, m).reduce((a, b) => a + b, 0) / m;
    const mean2 = y.slice(m, 2 * m).reduce((a, b) => a + b, 0) / m;
    level = mean1;
    trend = (mean2 - mean1) / m;
    season = y.slice(0, m).map((v) => v - mean1);
    start = m;
  } else {
    level = y[0];
    trend = y.length > 1 ? y[1] - y[0] : 0;
  }
  const errors = [];
  for (let t = start; t < n; t++) {
    const s = seasonal ? season[t % SEASON] : 0;
    const pred = level + phi * trend + s;
    const e = y[t] - pred;
    errors.push(e);
    const prevLevel = level;
    level = alpha * (y[t] - s) + (1 - alpha) * (prevLevel + phi * trend);
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
    if (seasonal) season[t % SEASON] = gamma * (y[t] - level) + (1 - gamma) * s;
  }
  return { level, trend, season, n, errors };
}

function project(state, p, seasonal, h) {
  const out = [];
  let damp = 0;
  let pw = 1;
  for (let k = 1; k <= h; k++) {
    pw *= p.phi;
    damp += pw;
    const s = seasonal ? state.season[(state.n + k - 1) % SEASON] : 0;
    out.push(state.level + damp * state.trend + s);
  }
  return out;
}

function sse(errors) {
  let s = 0;
  for (const e of errors) s += e * e;
  return s;
}

function fitParams(y, seasonal) {
  const alphas = [0.1, 0.2, 0.3, 0.5, 0.7, 0.9];
  const betas = [0.05, 0.1, 0.2, 0.4];
  const phis = [0.8, 0.9, 0.97];
  const gammas = seasonal ? [0.05, 0.2, 0.5] : [0];
  let best = null;
  for (const alpha of alphas) {
    for (const beta of betas) {
      for (const phi of phis) {
        for (const gamma of gammas) {
          const p = { alpha, beta, phi, gamma };
          const f = filter(y, p, seasonal);
          const score = sse(f.errors);
          if (best === null || score < best.score) best = { p, score };
        }
      }
    }
  }
  return best.p;
}

/** Mean absolute error of forecasting the last `h` points after fitting on the earlier ones. */
function holdoutMAE(y, seasonal, h) {
  const train = y.slice(0, y.length - h);
  const p = fitParams(train, seasonal);
  const f = project(filter(train, p, seasonal), p, seasonal, h);
  let s = 0;
  for (let i = 0; i < h; i++) s += Math.abs(f[i] - y[y.length - h + i]);
  return s / h;
}

/** Root-mean-square error at each horizon 1..h, measured over recent origins with fixed parameters. */
function horizonRMSE(y, p, seasonal, h) {
  const minTrain = seasonal ? 2 * SEASON : Math.max(8, Math.floor(y.length / 2));
  const first = Math.max(minTrain, y.length - h - 60);
  const sq = Array.from({ length: h }, () => []);
  for (let t = first; t + h <= y.length; t++) {
    const st = filter(y.slice(0, t), p, seasonal);
    const f = project(st, p, seasonal, h);
    for (let k = 0; k < h; k++) sq[k].push((f[k] - y[t + k]) ** 2);
  }
  const rmse = sq.map((a) => (a.length ? Math.sqrt(a.reduce((x, z) => x + z, 0) / a.length) : null));
  const fallback = Math.sqrt(sse(filter(y, p, seasonal).errors) / Math.max(1, y.length - 1));
  let prev = 0;
  return rmse.map((v, k) => {
    const val = Math.max(v == null ? fallback * Math.sqrt(k + 1) : v, fallback, prev);
    prev = val; // the band never narrows as we look further ahead
    return val;
  });
}

/**
 * @param {(number|null)[]} values weekly values, oldest first
 * @param {{horizon?: number, min?: number, max?: number}} opts
 * @returns {{skipped:true, reason:string} | {skipped:false, method:string, methodLabel:string, mean:number[], lo:number[], hi:number[], horizon:number, level:number}}
 */
export function forecast(values, opts = {}) {
  const horizon = opts.horizon || 6;
  const lo = opts.min == null ? 0 : opts.min;
  const hi = opts.max == null ? Infinity : opts.max;
  const clean = fillGaps((values || []).filter((v, i, a) => !(v == null && i === a.length - 1)));
  const y = clean.filter((v) => v != null);
  if (y.length < MIN_POINTS) {
    return {
      skipped: true,
      reason: `There is not enough history yet to make a fair estimate (${y.length} weeks of data; at least ${MIN_POINTS} are needed).`,
    };
  }
  if (y.some((v) => !Number.isFinite(v))) return { skipped: true, reason: 'The data contains values that cannot be used for an estimate.' };

  const h = Math.min(horizon, 8);
  let seasonal = false;
  if (y.length >= 2 * SEASON + h + 4) {
    const testH = Math.min(8, Math.floor(y.length / 10));
    seasonal = holdoutMAE(y, true, testH) < holdoutMAE(y, false, testH);
  }
  const p = fitParams(y, seasonal);
  const mean = project(filter(y, p, seasonal), p, seasonal, h);
  const rmse = horizonRMSE(y, p, seasonal, h);
  const clamp = (v) => Math.min(hi, Math.max(lo, v));
  return {
    skipped: false,
    method: seasonal ? 'hw' : 'holt',
    methodLabel: seasonal
      ? 'exponential smoothing with a yearly seasonal pattern'
      : 'exponential smoothing with a gently fading trend',
    horizon: h,
    level: 80,
    params: p,
    mean: mean.map(clamp),
    lo: mean.map((m, k) => clamp(m - Z80 * rmse[k])),
    hi: mean.map((m, k) => clamp(m + Z80 * rmse[k])),
  };
}

export const FORECAST_EXPLAINER =
  'This is an estimate, not a certainty. It carries forward the recent pattern of the data; the shaded band shows where the real value is likely to land about 4 times out of 5, judged by how far off this method has been before.';
