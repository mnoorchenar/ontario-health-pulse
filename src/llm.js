// Optional "smarter answers": a small open language model that runs in the browser (transformers.js).
// Nothing here loads until the user clicks "Enable smarter answers". Every failure falls back to rules mode.
import { LLM } from './config.js';
import { buildFactsBlock, numbersAreGrounded, NO_DATA } from './chat.js';

let generator = null;

export const llmReady = () => generator !== null;

/** Download and start the model. Resolves true on success, false on any failure (never throws). */
export async function loadModel(onProgress) {
  try {
    const lib = await import(/* @vite-ignore */ LLM.libraryUrl);
    const device = typeof navigator !== 'undefined' && navigator.gpu ? 'webgpu' : 'wasm';
    generator = await lib.pipeline('text-generation', LLM.modelId, {
      dtype: 'q4',
      device,
      progress_callback: (p) => {
        if (onProgress && p && p.status === 'progress' && typeof p.progress === 'number') onProgress(Math.round(p.progress));
      },
    });
    return true;
  } catch (err) {
    generator = null;
    return false;
  }
}

export function systemPrompt(facts) {
  return [
    'You answer questions about public health data for one Ontario region.',
    'Use ONLY the facts below. Never guess or invent numbers.',
    `If the facts do not contain the answer, reply exactly: ${NO_DATA}`,
    'Keep the answer to two short sentences in plain, simple language.',
    'Do not give medical advice.',
    '',
    'FACTS:',
    facts,
  ].join('\n');
}

/** Returns {text} or null when the model is unavailable, fails, times out, or is not grounded in the facts. */
export async function askModel(question, data, regionId, timeoutMs = 60000) {
  if (!generator) return null;
  const facts = buildFactsBlock(data, regionId);
  try {
    const run = generator(
      [{ role: 'system', content: systemPrompt(facts) }, { role: 'user', content: String(question).slice(0, 300) }],
      { max_new_tokens: 90, do_sample: false },
    );
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs));
    const out = await Promise.race([run, timeout]);
    const msg = out && out[0] && out[0].generated_text;
    const text = (Array.isArray(msg) ? msg[msg.length - 1].content : String(msg || '')).trim();
    if (!text || !numbersAreGrounded(text, facts)) return null;
    return { text };
  } catch (err) {
    return null;
  }
}
