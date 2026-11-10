// Text -> feature strings. MUST match ml/features.py exactly.
// test/classifier.test.js compares this against probabilities exported by Python.
import { readFileSync } from 'node:fs';

const DIGITS = /[0-9]+/g;
const REPEAT = /(.)\1{2,}/gu; // `u` = code points, like Python strings
const TOKEN = /[a-z0]+|\?+|!+/g;
const WORD = /^[a-z]+$/;

export function preprocess(text) {
  return String(text).toLowerCase().replace(DIGITS, '0').replace(REPEAT, '$1$1');
}

export function tokens(text) {
  return preprocess(text).match(TOKEN) ?? [];
}

export function ngramFeatures(text) {
  const toks = tokens(text);
  if (toks.length === 0) return ['w:<empty>'];
  const feats = toks.map((t) => `w:${t}`);
  for (let i = 0; i + 1 < toks.length; i++) feats.push(`b:${toks[i]} ${toks[i + 1]}`);
  for (const t of toks) {
    if (!WORD.test(t)) continue;
    const padded = ` ${t} `;
    for (const n of [3, 4]) {
      for (let i = 0; i + n <= padded.length; i++) feats.push(`c:${padded.slice(i, i + n)}`);
    }
  }
  return feats;
}

const RULES_SPEC = JSON.parse(readFileSync(new URL('./keyword_rules.json', import.meta.url), 'utf8'));
export const RULES = RULES_SPEC.rules.map((r) => ({
  intent: r.intent,
  patterns: r.patterns.map((p) => new RegExp(p)),
}));

/** Every intent whose keyword rule matches. */
export function ruleHits(text) {
  const t = preprocess(text);
  return RULES.filter((r) => r.patterns.some((p) => p.test(t))).map((r) => r.intent);
}

/** The keyword baseline: first matching rule wins. */
export function keywordIntent(text) {
  return ruleHits(text)[0] ?? null;
}

export const ANALYZERS = {
  ngram: ngramFeatures,
  hybrid: (text) => [...ngramFeatures(text), ...ruleHits(text).map((i) => `k:${i}`)],
  word_hybrid: (text) => [
    ...ngramFeatures(text).filter((f) => !f.startsWith('c:')),
    ...ruleHits(text).map((i) => `k:${i}`),
  ],
};
