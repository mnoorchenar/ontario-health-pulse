// Optional "smarter answers" through the Hugging Face Inference Providers API (free-tier token supplied by the user).
// The token lives only in this module's memory: never saved, never written to the page, never in the project.
// Every failure returns null / false so the chat falls back to rules mode. Nothing here throws.
import { LLM } from './config.js';
import { buildFactsBlock, numbersAreGrounded, NO_DATA } from './chat.js';

let session = null; // { token, model }

export const llmReady = () => session !== null;
export const disconnect = () => { session = null; };

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

function clean(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

async function chat(token, model, messages, maxTokens, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(LLM.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0, stream: false }),
      signal: ctl.signal,
    });
    if (!res.ok) return { ok: false, status: res.status };
    const json = await res.json();
    const msg = json && json.choices && json.choices[0] && json.choices[0].message;
    const text = clean(msg && msg.content);
    return text ? { ok: true, text } : { ok: false, status: 0 };
  } catch (err) {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Check the token and model with a tiny request. Returns {ok, reason}; reason is a short friendly sentence. */
export async function connect(token, model) {
  const t = String(token || '').trim();
  const m = String(model || '').trim();
  if (!t || !m) return { ok: false, reason: 'Please paste a token and choose a model.' };
  const r = await chat(t, m, [{ role: 'user', content: 'Reply with the word OK.' }], 200, 30000);
  if (r.ok) { session = { token: t, model: m }; return { ok: true, reason: '' }; }
  session = null;
  if (r.status === 401 || r.status === 403) return { ok: false, reason: 'That token was not accepted. Check it can call Inference Providers.' };
  if (r.status === 402 || r.status === 429) return { ok: false, reason: 'The free quota for this token is used up right now. Try later or pick another model.' };
  if (r.status === 400 || r.status === 404) return { ok: false, reason: 'That model is not available through your providers. Pick another model.' };
  return { ok: false, reason: 'Could not reach the service. Check your internet connection.' };
}

/** Returns {text} or null when unavailable, failed, or the answer contains numbers that are not in the facts. */
export async function askModel(question, data, regionId, timeoutMs = 45000) {
  if (!session) return null;
  const facts = buildFactsBlock(data, regionId);
  const r = await chat(session.token, session.model, [
    { role: 'system', content: systemPrompt(facts) },
    { role: 'user', content: String(question).slice(0, 300) },
  ], 400, timeoutMs);
  if (!r.ok || !numbersAreGrounded(r.text, facts)) return null;
  return { text: r.text };
}
