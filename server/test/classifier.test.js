import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, predictProba, modelInfo } from '../src/classifier/index.js';
import { keywordIntent, preprocess, tokens } from '../src/classifier/features.js';
import { conversationIntent, isChasing, priorityFor } from '../src/intents.js';

const parity = JSON.parse(readFileSync(new URL('./fixtures/classifier_parity.json', import.meta.url), 'utf8'));

test('model loads', () => {
  const info = modelInfo();
  assert.equal(info.available, true, info.error);
  assert.deepEqual(info.classes, parity.classes);
});

test('JS inference matches the Python model (parity)', () => {
  let worst = 0;
  for (const sample of parity.samples) {
    const { proba } = predictProba(sample.text);
    proba.forEach((p, k) => {
      worst = Math.max(worst, Math.abs(p - sample.proba[k]));
    });
    const argmax = (arr) => arr.indexOf(Math.max(...arr));
    assert.equal(argmax(proba), argmax(sample.proba), `different top class for "${sample.text}"`);
  }
  assert.ok(worst < 1e-4, `max probability difference ${worst}`);
});

test('preprocessing normalises numbers, repeats and case', () => {
  assert.equal(preprocess('PRICE???? Order 12345'), 'price?? order 0');
  assert.deepEqual(tokens('hiiiii, kitna ka hai?'), ['hii', 'kitna', 'ka', 'hai', '?']);
  assert.deepEqual(tokens('😍😍'), []);
});

test('keyword rules: first matching rule wins', () => {
  assert.equal(keywordIntent('received a damaged order'), 'complaint'); // complaint beats order
  assert.equal(keywordIntent('COD available?'), 'cod_shipping');
  assert.equal(keywordIntent('qwerty'), null);
});

test('classify always returns a label with its source', () => {
  for (const text of ['price?', 'order 12345 kab aayega', 'asdfgh', '']) {
    const r = classify(text);
    assert.ok(typeof r.intent === 'string' && r.intent.length > 0);
    assert.ok(['model', 'rules', 'none'].includes(r.source));
    assert.equal(typeof r.lowConfidence, 'boolean');
  }
  assert.equal(classify('price?').intent, 'price');
});

test('an unanswered complaint stays the conversation topic', () => {
  const unanswered = [{ intent: 'complaint' }, { intent: 'price' }];
  assert.equal(conversationIntent([...unanswered].reverse(), unanswered), 'complaint');
  assert.equal(conversationIntent([{ intent: 'follow_up' }, { intent: 'size' }], []), 'size');
  assert.equal(conversationIntent([{ intent: 'greeting' }], []), 'greeting');
  assert.equal(conversationIntent([], []), null);
});

test('chasing = a nudge after an earlier unanswered message', () => {
  assert.equal(isChasing([{ intent: 'price' }, { intent: 'follow_up' }]), true);
  assert.equal(isChasing([{ intent: 'price' }, { intent: 'greeting' }]), true);
  assert.equal(isChasing([{ intent: 'follow_up' }]), false);
  assert.equal(isChasing([{ intent: 'price' }, { intent: 'size' }]), false);
});

test('priority', () => {
  assert.equal(priorityFor('complaint', false), 'URGENT');
  assert.equal(priorityFor('price', true), 'URGENT');
  assert.equal(priorityFor('spam', false), 'LOW');
  assert.equal(priorityFor('price', false), 'NORMAL');
});
