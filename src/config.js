// Single place for configuration. No secrets belong here: everything in this project is public.

// Raw GitHub URL of the newest snapshot. Repository name taken from the git remote (mnoorchenar/ontario-health-pulse).
// If you fork or rename the repository, change this one constant.
export const REMOTE_DATA_URL =
  'https://raw.githubusercontent.com/mnoorchenar/ontario-health-pulse/main/data/data.json';

export const LOCAL_DATA_URL = 'data/data.json';
export const CITIES_URL = 'data/cities.json';
export const BOUNDARIES_URL = 'data/phu_boundaries.geojson';
export const DATA_CACHE_NAME = 'ohp-data';
export const UPDATE_TIMEOUT_MS = 15000;

export const DISCLAIMER =
  'Independent demo built on public, aggregated data. Not an official tool and not medical advice.';

// Optional "smarter answers": Hugging Face Inference Providers (OpenAI-compatible). The user pastes their own free
// token in the page; it is kept in memory only. Edit the model list here (ids as shown on huggingface.co/models).
export const LLM = {
  endpoint: 'https://router.huggingface.co/v1/chat/completions',
  models: [
    'meta-llama/Llama-3.1-8B-Instruct',
    'openai/gpt-oss-20b',
    'Qwen/Qwen3-4B-Instruct-2507',
    'google/gemma-3-4b-it',
  ],
};

export const FORECAST_HORIZON = 6;
export const STALE_AFTER_DAYS = 60;
