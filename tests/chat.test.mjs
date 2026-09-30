import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion, NO_DATA, buildFactsBlock, numbersAreGrounded } from '../src/chat.js';
import { getSeries, latest, formatValue, change } from '../src/data.js';
import { data } from './helpers.mjs';

const TORONTO = 3895;
const ask = (q, extra = {}) => answerQuestion(q, { data, regionId: TORONTO, indicator: 'pos', ...extra });
const tokens = (t) => t.match(/\d[\d,]*\.?\d*/g) || [];

test('latest value comes straight from the data', () => {
  const a = ask('What is the latest value here?');
  const l = latest(getSeries(data, TORONTO, 'pos'));
  assert.equal(a.kind, 'latest');
  assert.ok(a.text.includes(formatValue(l.value, 'pos', data)));
  assert.match(a.source, /Data as of \d+ \w+ \d{4}\. Source: Ontario COVID-19 testing/);
});

test('change from last week is computed, not invented', () => {
  const a = ask('Did it change from last week?');
  const d = change(getSeries(data, TORONTO, 'pos'), 1);
  assert.equal(a.kind, 'change');
  assert.ok(a.text.includes(Math.abs(d).toFixed(1)), a.text);
});

test('year-over-year question uses the 52-week value', () => {
  const a = ask('how is it compared to the same time last year?');
  assert.equal(a.kind, 'change');
  assert.match(a.text, /same week last year/);
});

test('compare with Ontario mentions both numbers', () => {
  const a = ask('How does this compare with Ontario?');
  assert.equal(a.kind, 'compare');
  const ont = latest(getSeries(data, 'ON', 'pos'));
  assert.ok(a.text.includes(formatValue(ont.value, 'pos', data)));
  assert.match(a.text, /(higher than|lower than|about the same as) Ontario/);
});

test('highest and lowest region', () => {
  const hi = ask('Which region is highest?');
  const lo = ask('which region has the lowest positivity?');
  assert.equal(hi.kind, 'ranking');
  assert.notEqual(hi.text, lo.text);
  assert.match(hi.text, /highest/);
  assert.match(lo.text, /lowest/);
});

test('trend direction', () => {
  const a = ask('Is the trend going up or down?');
  assert.equal(a.kind, 'trend');
  assert.match(a.text, /rising|falling|steady/);
});

test('data date question', () => {
  const a = ask('When was the data last updated?');
  assert.equal(a.kind, 'updated');
  assert.match(a.text, /Jul 2024|Nov 2024/);
});

test('definitions', () => {
  const a = ask('What does test positivity mean?');
  assert.equal(a.kind, 'definition');
  assert.match(a.text, /lab tests/i);
  assert.equal(ask('what is a public health unit').kind, 'definition');
});

test('switching indicator and region from the question text', () => {
  const a = ask('What is the booster coverage in Peel?');
  assert.match(a.text, /Peel Public Health/);
  assert.match(a.text, /3 or more doses/i);
});

test('old unit names point to the merged unit', () => {
  const a = ask('latest test positivity in Peterborough');
  assert.match(a.text, /Lakelands Public Health/);
  assert.match(a.text, /now part of/);
});

test('unsupported topics say I do not have that data and offer examples', () => {
  for (const q of ['How many flu cases are there?', 'RSV hospital admissions?']) {
    const a = ask(q);
    assert.ok(a.text.startsWith(NO_DATA), a.text);
    assert.equal(a.examples, true);
    assert.equal(a.understood, false);
  }
});

test('nonsense is not understood', () => {
  const a = ask('purple monkey dishwasher');
  assert.equal(a.understood, false);
  assert.equal(a.examples, true);
  assert.ok(a.text.startsWith(NO_DATA));
});

test('empty question is handled', () => {
  assert.equal(ask('   ').examples, true);
  assert.doesNotThrow(() => ask(undefined));
});

test('personal medical advice is declined', () => {
  for (const q of ['Should I get a booster?', 'I have symptoms, what should I do?', 'Can I take this if my child is sick?', 'do I have covid']) {
    const a = ask(q);
    assert.equal(a.kind, 'medical', q);
    assert.match(a.text, /health professional|public health unit/);
    assert.equal(tokens(a.text).length, 0);
  }
});

test('"what can I ask" is help, not medical', () => {
  assert.equal(ask('what can I ask').kind, 'help');
});

test('forecast question gives a direction without inventing numbers', () => {
  const a = ask('What is the forecast for next weeks?');
  assert.equal(a.kind, 'forecast');
  assert.match(a.text, /estimate, not a certainty/);
});

test('every number in an answer is declared by the code that calculated it', () => {
  const questions = [
    'What is the latest value here?', 'Did it change from last week?', 'How does this compare with Ontario?',
    'Which region is highest?', 'lowest vaccination coverage', 'Is the trend going up or down?',
    'When was the data last updated?', 'What is the forecast?', 'booster in Ottawa', 'same time last year in York',
    'what does 7 day average mean', 'what is a public health unit',
  ];
  for (const q of questions) {
    const a = ask(q);
    const declared = a.numbers.join(' | ');
    for (const t of tokens(a.text.replace(/COVID-19|3 or more|ages 5\+?|7-day/gi, ''))) {
      const bare = t.replace(/[.,]$/, '');
      assert.ok(declared.includes(bare), `"${q}" -> token ${t} not declared in [${declared}]\n${a.text}`);
    }
  }
});

test('answers never throw for odd inputs', () => {
  const odd = ['???', '<script>alert(1)</script>', 'a'.repeat(5000), 'toronto toronto toronto', '0', 'null', 'undefined'];
  for (const q of odd) assert.doesNotThrow(() => ask(q), q);
});

test('facts block and grounding check for the optional model', () => {
  const facts = buildFactsBlock(data, TORONTO);
  assert.match(facts, /Region: Toronto Public Health/);
  const l = latest(getSeries(data, TORONTO, 'pos'));
  assert.ok(facts.includes(formatValue(l.value, 'pos', data)));
  assert.equal(numbersAreGrounded('It was ' + formatValue(l.value, 'pos', data), facts), true);
  assert.equal(numbersAreGrounded('It was 77.7%', facts), false);
});
