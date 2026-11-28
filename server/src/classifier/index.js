// Runs the model trained in ml/train.py inside Node. No Python needed at runtime:
// the model is just numbers (vocabulary, idf weights, coefficients) in model.json.
//
//   TF-IDF:  x_j = (1 + ln count_j) * idf_j, then scale x to unit length
//   LogReg:  score_k = coef_k · x + intercept_k,   proba = softmax(score)
import { readFileSync } from 'node:fs';
import { ANALYZERS, keywordIntent } from './features.js';

let model = null;
let loadError = null;

function load() {
  if (model || loadError) return;
  try {
    const raw = JSON.parse(readFileSync(new URL('./model.json', import.meta.url), 'utf8'));
    if (raw.format !== 'tfidf-logreg-v1' || !ANALYZERS[raw.analyzer]) {
      throw new Error(`Unsupported model format/analyzer: ${raw.format}/${raw.analyzer}`);
    }
    model = {
      ...raw,
      analyze: ANALYZERS[raw.analyzer],
      index: new Map(raw.features.map((f, i) => [f, i])),
    };
  } catch (err) {
    loadError = err;
    console.warn(`[classifier] model unavailable, using keyword rules only: ${err.message}`);
  }
}

export function modelInfo() {
  load();
  if (!model) return { available: false, error: loadError?.message };
  return {
    available: true,
    analyzer: model.analyzer,
    threshold: model.threshold,
    trainedAt: model.trained_at,
    classes: model.classes,
    testMetrics: model.test_metrics,
  };
}

/** Class probabilities for one message, or null if no model is loaded. */
export function predictProba(text) {
  load();
  if (!model) return null;
  const counts = new Map();
  for (const f of model.analyze(text)) {
    const j = model.index.get(f);
    if (j !== undefined) counts.set(j, (counts.get(j) ?? 0) + 1);
  }
  const x = new Map();
  let norm = 0;
  for (const [j, c] of counts) {
    const v = (1 + Math.log(c)) * model.idf[j];
    x.set(j, v);
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  const scores = model.coef.map((row, k) => {
    let s = model.intercept[k];
    for (const [j, v] of x) s += row[j] * (v / norm);
    return s;
  });
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - max));
  const total = exps.reduce((a, b) => a + b, 0);
  return { classes: model.classes, proba: exps.map((e) => e / total) };
}

/**
 * The decision policy (evaluated in ml/train.py as "Server policy"):
 *   1. model, if its confidence >= threshold
 *   2. otherwise the keyword rule, if one matches
 *   3. otherwise the model's best guess, flagged lowConfidence
 * Returns { intent, confidence, source, lowConfidence }.
 */
export function classify(text) {
  const rule = keywordIntent(text);
  const p = predictProba(text);
  if (!p) {
    return rule
      ? { intent: rule, confidence: null, source: 'rules', lowConfidence: false }
      : { intent: 'unclassified', confidence: null, source: 'none', lowConfidence: true };
  }
  let best = 0;
  for (let k = 1; k < p.proba.length; k++) if (p.proba[k] > p.proba[best]) best = k;
  const confidence = p.proba[best];
  // A matching complaint keyword always wins (same rule as policy_decide in ml/train.py):
  // a missed complaint loses URGENT priority, the costliest mistake this classifier can make.
  if (rule === 'complaint') return { intent: 'complaint', confidence, source: 'rules', lowConfidence: false };
  if (confidence >= model.threshold) {
    return { intent: p.classes[best], confidence, source: 'model', lowConfidence: false };
  }
  if (rule) return { intent: rule, confidence, source: 'rules', lowConfidence: false };
  return { intent: p.classes[best], confidence, source: 'model', lowConfidence: true };
}
