// Single place for configuration. No secrets belong here: everything in this project is public.

// Raw GitHub URL of the newest snapshot. Repository name taken from the git remote (mnoorchenar/ontario-health-pulse).
// If you fork or rename the repository, change this one constant.
export const REMOTE_DATA_URL =
  'https://raw.githubusercontent.com/mnoorchenar/ontario-health-pulse/main/data/data.json';

export const LOCAL_DATA_URL = 'data/data.json';
export const BOUNDARIES_URL = 'data/phu_boundaries.geojson';
export const DATA_CACHE_NAME = 'ohp-data';
export const UPDATE_TIMEOUT_MS = 15000;

export const DISCLAIMER =
  'Independent demo built on public, aggregated data. Not an official tool and not medical advice.';

// Optional "smarter answers" model. Loaded only after the user clicks the button.
export const LLM = {
  libraryUrl: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js',
  modelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
};

export const FORECAST_HORIZON = 6;
export const STALE_AFTER_DAYS = 60;
