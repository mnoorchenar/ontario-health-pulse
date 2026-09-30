import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, askModel, llmReady, disconnect } from '../src/llm.js';
import { buildFactsBlock } from '../src/chat.js';
import { getSeries, latest, formatValue } from '../src/data.js';
import { data } from './helpers.mjs';

const realFetch = globalThis.fetch;
const reply = (content, status = 200) => async () => ({ ok: status === 200, status, json: async () => ({ choices: [{ message: { content } }] }) });
test.afterEach(() => { globalThis.fetch = realFetch; disconnect(); });

test('connect needs a token and a model', async () => {
  assert.equal((await connect('', 'x/y')).ok, false);
  assert.equal((await connect('hf_x', '')).ok, false);
  assert.equal(llmReady(), false);
});

test('connect success sends the token only in the Authorization header', async () => {
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url, init }; return reply('OK')(); };
  const r = await connect('hf_secret', 'meta-llama/Llama-3.1-8B-Instruct');
  assert.equal(r.ok, true);
  assert.equal(llmReady(), true);
  assert.equal(seen.init.headers.Authorization, 'Bearer hf_secret');
  assert.ok(!seen.init.body.includes('hf_secret'));
  assert.match(seen.url, /router\.huggingface\.co/);
});

test('connect failures give friendly reasons and never throw', async () => {
  for (const [status, re] of [[401, /token was not accepted/], [429, /quota/], [404, /not available/], [500, /Could not reach/]]) {
    globalThis.fetch = reply('', status);
    const r = await connect('hf_x', 'a/b');
    assert.equal(r.ok, false);
    assert.match(r.reason, re);
  }
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const r = await connect('hf_x', 'a/b');
  assert.match(r.reason, /Could not reach/);
  assert.equal(llmReady(), false);
});

test('a grounded answer is returned; the model only sees the facts block', async () => {
  const l = latest(getSeries(data, 3895, 'pos'));
  globalThis.fetch = reply('OK');
  await connect('hf_x', 'a/b');
  let body;
  globalThis.fetch = async (u, init) => { body = JSON.parse(init.body); return reply(`It was ${formatValue(l.value, 'pos', data)}.`)(); };
  const r = await askModel('what is it?', data, 3895);
  assert.ok(r && r.text.includes(formatValue(l.value, 'pos', data)));
  assert.equal(body.messages[0].role, 'system');
  assert.ok(body.messages[0].content.includes(buildFactsBlock(data, 3895)));
  assert.match(body.messages[0].content, /I don't have that data/);
});

test('an answer with an invented number is discarded', async () => {
  globalThis.fetch = reply('OK');
  await connect('hf_x', 'a/b');
  globalThis.fetch = reply('It was 99.9% last week.');
  assert.equal(await askModel('q', data, 3895), null);
});

test('reasoning tags are stripped and errors return null', async () => {
  globalThis.fetch = reply('OK');
  await connect('hf_x', 'a/b');
  globalThis.fetch = reply("<think>hmm 12345</think>I don't have that data.");
  assert.equal((await askModel('q', data, 3895)).text, "I don't have that data.");
  globalThis.fetch = async () => { throw new Error('boom'); };
  assert.equal(await askModel('q', data, 3895), null);
  disconnect();
  assert.equal(await askModel('q', data, 3895), null);
});
