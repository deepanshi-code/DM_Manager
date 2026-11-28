"""Train, evaluate and export the DM intent classifier.

    python ml/train.py                        # synthetic train/test
    python ml/train.py --real ml/data/real/labelled.csv   # also evaluate on real messages

Steps
  1. Keyword baseline   : evaluate the hand-written rules (the number to beat).
  2. Model selection    : TF-IDF + logistic regression; choose C by GroupKFold
                          cross-validation on TRAIN only (groups = template), scored by macro-F1.
  3. Threshold          : choose the "unclassified" confidence cut-off from cross-validated
                          predictions on TRAIN (never from the test set: that would be leakage).
  4. Test evaluation    : report everything once on the held-out test templates.
  5. Export            : model.json for the Node server + parity samples for the JS test.
"""
import argparse
import csv
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GridSearchCV, GroupKFold, cross_val_predict
from sklearn.pipeline import Pipeline

from features import features, hybrid_features, preprocess, word_hybrid_features, compile_rule

ANALYZERS = {"ngram": features, "hybrid": hybrid_features, "word_hybrid": word_hybrid_features}
ANALYZER_NAME = {fn: name for name, fn in ANALYZERS.items()}

ROOT = Path(__file__).resolve().parent
SERVER_CLASSIFIER = ROOT.parent / "server" / "src" / "classifier"
REPORTS = ROOT / "reports"
UNCLASSIFIED = "unclassified"
TARGET_PRECISION = 0.90  # when the model is confident, it should be right at least this often


def load(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


# ---------- keyword baseline (same semantics as server/src/classifier/keywords.js) ----------
FEATURE_DESCRIPTIONS = {
    "ngram": "word unigrams/bigrams + char 3-4-grams",
    "hybrid": "word unigrams/bigrams + char 3-4-grams + keyword-rule features",
    "word_hybrid": "word unigrams/bigrams + keyword-rule features, no char n-grams",
}


def load_rules():
    spec = json.loads((SERVER_CLASSIFIER / "keyword_rules.json").read_text(encoding="utf-8"))
    return [(r["intent"], [compile_rule(p) for p in r["patterns"]]) for r in spec["rules"]]


def keyword_predict(rules, text: str) -> str:
    t = preprocess(text)
    for intent, patterns in rules:
        if any(p.search(t) for p in patterns):
            return intent
    return UNCLASSIFIED


def policy_decide(proba_row, classes, threshold, rule_intent):
    """Mirror of classify() in server/src/classifier/index.js. Returns (intent, source, low_confidence).

    A matching complaint keyword always wins: a missed complaint is the costliest error (it loses
    URGENT priority), and a low-confidence model must not override clear words like "damaged"."""
    i = int(np.argmax(proba_row))
    if rule_intent == "complaint":
        return "complaint", "rules", False
    if proba_row[i] >= threshold:
        return classes[i], "model", False
    if rule_intent != UNCLASSIFIED:
        return rule_intent, "rules", False
    return classes[i], "model", True


# ---------- helpers ----------
def build_pipeline() -> Pipeline:
    return Pipeline([
        ("tfidf", TfidfVectorizer(analyzer=features, sublinear_tf=True, min_df=2)),
        ("clf", LogisticRegression(max_iter=3000, class_weight="balanced")),
    ])


def apply_threshold(proba: np.ndarray, classes: np.ndarray, threshold: float) -> list[str]:
    best = proba.argmax(axis=1)
    conf = proba.max(axis=1)
    return [classes[i] if c >= threshold else UNCLASSIFIED for i, c in zip(best, conf)]


def coverage_and_precision(y_true, y_pred):
    covered = [(t, p) for t, p in zip(y_true, y_pred) if p != UNCLASSIFIED]
    coverage = len(covered) / len(y_true)
    precision = sum(t == p for t, p in covered) / len(covered) if covered else 0.0
    return coverage, precision


def summarise(name, y_true, y_pred, labels):
    coverage, precision = coverage_and_precision(y_true, y_pred)
    return {
        "name": name,
        "accuracy": accuracy_score(y_true, y_pred),           # unclassified counts as wrong
        "macro_f1": f1_score(y_true, y_pred, labels=labels, average="macro", zero_division=0),
        "coverage": coverage,                                  # share NOT sent to human review
        "precision_when_answered": precision,
        "complaint_recall": sum(t == p == "complaint" for t, p in zip(y_true, y_pred))
                            / max(1, sum(t == "complaint" for t in y_true)),
        "report": classification_report(y_true, y_pred, labels=labels, zero_division=0, output_dict=True),
    }


def fmt_pct(x):
    return f"{100 * x:.1f}%"


def markdown_confusion(y_true, y_pred, labels):
    cols = labels + [UNCLASSIFIED]
    cm = confusion_matrix(y_true, y_pred, labels=cols)
    short = {c: c[:6] for c in cols}
    lines = ["| true \\ predicted | " + " | ".join(short[c] for c in cols) + " |",
             "|---|" + "---|" * len(cols)]
    for i, label in enumerate(labels):
        cells = [f"**{v}**" if j == i else (str(v) if v else "·") for j, v in enumerate(cm[i])]
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", default=ROOT / "data" / "synthetic_train.csv", type=Path)
    parser.add_argument("--test", default=ROOT / "data" / "synthetic_test.csv", type=Path)
    parser.add_argument("--real", type=Path, help="optional CSV (text,intent) of real, anonymised messages")
    args = parser.parse_args()

    train, test = load(args.train), load(args.test)
    X_train = [r["text"] for r in train]
    y_train = np.array([r["intent"] for r in train])
    groups = [r["template_id"] for r in train]
    X_test = [r["text"] for r in test]
    y_test = [r["intent"] for r in test]
    labels = sorted(set(y_train))

    # 1. baseline
    rules = load_rules()
    base_pred = [keyword_predict(rules, t) for t in X_test]
    baseline = summarise("Keyword rules", y_test, base_pred, labels)

    # 2. model selection with grouped CV on train only
    cv = GroupKFold(n_splits=5)
    grid = {"tfidf__analyzer": list(ANALYZERS.values()), "clf__C": [0.3, 1, 3, 10, 30, 100]}
    search = GridSearchCV(build_pipeline(), grid, cv=cv, scoring="f1_macro", n_jobs=1)
    search.fit(X_train, y_train, groups=groups)
    best_c = search.best_params_["clf__C"]
    best_analyzer = ANALYZER_NAME[search.best_params_["tfidf__analyzer"]]

    # Best CV score per feature set, so the report can show both variants.
    variant_cv = {}
    for params, score in zip(search.cv_results_["params"], search.cv_results_["mean_test_score"]):
        name = ANALYZER_NAME[params["tfidf__analyzer"]]
        if score > variant_cv.get(name, (-1, None))[0]:
            variant_cv[name] = (score, params["clf__C"])

    # 3. threshold from cross-validated probabilities on train
    cv_proba = cross_val_predict(build_pipeline().set_params(**search.best_params_), X_train, y_train,
                                 groups=groups, cv=cv, method="predict_proba")
    classes = np.array(sorted(set(y_train)))
    threshold_table = []
    for t in [0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]:
        cov, prec = coverage_and_precision(list(y_train), apply_threshold(cv_proba, classes, t))
        threshold_table.append({"threshold": t, "coverage": cov, "precision": prec})
    meeting = [row for row in threshold_table if row["precision"] >= TARGET_PRECISION]
    threshold = meeting[0]["threshold"] if meeting else 0.5

    # 4. test evaluation (done once)
    model = search.best_estimator_
    proba = model.predict_proba(X_test)
    model_classes = model.classes_
    pred_raw = list(model_classes[proba.argmax(axis=1)])
    pred_thr = apply_threshold(proba, model_classes, threshold)
    ml_raw = summarise(f"Model [{best_analyzer}] (always answers)", y_test, pred_raw, labels)
    ml_thr = summarise(f"Model [{best_analyzer}] (threshold {threshold})", y_test, pred_thr, labels)

    # The policy the server actually runs (see server/src/classifier/index.js: decide()).
    policy_pred = [
        policy_decide(row, model_classes, threshold, keyword_predict(rules, text))[0]
        for row, text in zip(proba, X_test)
    ]
    policy = summarise("Server policy: complaint keyword -> model if confident -> rules -> model guess", y_test, policy_pred, labels)

    # For transparency, also test the feature sets that were NOT selected.
    other_rows = []
    for name, (_, c) in variant_cv.items():
        if name == best_analyzer:
            continue
        other = build_pipeline().set_params(tfidf__analyzer=ANALYZERS[name], clf__C=c).fit(X_train, y_train)
        other_rows.append(summarise(f"Model [{name}] (always answers, not selected)", y_test,
                                    list(other.predict(X_test)), labels))

    errors = sorted(
        [(proba[i].max(), X_test[i], y_test[i], pred_raw[i]) for i in range(len(X_test)) if pred_raw[i] != y_test[i]],
        reverse=True,
    )

    real_results = None
    if args.real:
        real = load(args.real)
        Xr, yr = [r["text"] for r in real], [r["intent"] for r in real]
        pr = model.predict_proba(Xr)
        real_results = [
            summarise("Keyword rules (real)", yr, [keyword_predict(rules, t) for t in Xr], labels),
            summarise(f"TF-IDF + LogReg, threshold {threshold} (real)", yr, apply_threshold(pr, model_classes, threshold), labels),
            summarise("Server policy (real)", yr,
                      [policy_decide(row, model_classes, threshold, keyword_predict(rules, t))[0] for row, t in zip(pr, Xr)],
                      labels),
        ]

    # 5. export for the Node server
    vec: TfidfVectorizer = model.named_steps["tfidf"]
    clf: LogisticRegression = model.named_steps["clf"]
    vocab = sorted(vec.vocabulary_.items(), key=lambda kv: kv[1])
    trained_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    export = {
        "format": "tfidf-logreg-v1",
        "trained_at": trained_at,
        "sklearn_version": sklearn.__version__,
        "data": {"train_rows": len(train), "test_rows": len(test), "source": "synthetic"},
        "analyzer": best_analyzer,
        "hyperparameters": {"C": best_c, "sublinear_tf": True, "min_df": 2, "class_weight": "balanced"},
        "threshold": threshold,
        "classes": list(clf.classes_),
        "features": [f for f, _ in vocab],
        "idf": [round(float(x), 6) for x in vec.idf_],
        "coef": [[round(float(x), 6) for x in row] for row in clf.coef_],
        "intercept": [round(float(x), 6) for x in clf.intercept_],
        "test_metrics": {k: round(v, 4) for k, v in ml_thr.items() if isinstance(v, float)},
    }
    (SERVER_CLASSIFIER / "model.json").write_text(json.dumps(export, separators=(",", ":")), encoding="utf-8")

    # Parity samples: the JS test must reproduce these probabilities.
    parity_texts = X_test[:60] + ["", "😍😍", "PRICE???", "hiiiii", "order 12345 kab aayega bhai",
                                  "सर ??", "भाई??", "éxl", "ping\n", "size xl\n", "kurta का price?", "hello\nprice?"]
    parity_proba = model.predict_proba(parity_texts)
    parity = [{"text": t, "proba": [round(float(p), 6) for p in row]} for t, row in zip(parity_texts, parity_proba)]
    (ROOT.parent / "server" / "test" / "fixtures").mkdir(exist_ok=True)
    (ROOT.parent / "server" / "test" / "fixtures" / "classifier_parity.json").write_text(
        json.dumps({"classes": list(clf.classes_), "samples": parity}, ensure_ascii=False, indent=1), encoding="utf-8")

    # Report
    REPORTS.mkdir(exist_ok=True)
    rows = [baseline] + other_rows + [ml_raw, ml_thr, policy] + (real_results or [])
    md = [
        "# Phase 2: intent classifier evaluation",
        "",
        f"_Generated by `ml/train.py` on {trained_at}. Data: {len(train)} train / {len(test)} test rows, "
        f"**synthetic**, split by template (test phrasings never seen in training)._",
        "",
        "> ⚠️ **Read before quoting any number.** (1) Synthetic data is cleaner than real DMs. "
        "(2) The keyword rules were written by someone who had seen *all* templates, including the test "
        "templates, so the keyword baseline and the hybrid model (which uses the rules as features) are "
        "**leaked and optimistic** on this test set. (3) The `ngram` model's grouped-CV score is the "
        "only leak-free estimate here. Use these results to compare approaches and find failure modes; "
        "report final performance on real, anonymised messages (`--real`).",
        "",
        "## Summary (test set)",
        "",
        "| Approach | Accuracy | Macro-F1 | Coverage | Precision when answered | Complaint recall |",
        "|---|---|---|---|---|---|",
    ]
    for r in rows:
        md.append(f"| {r['name']} | {fmt_pct(r['accuracy'])} | {fmt_pct(r['macro_f1'])} | {fmt_pct(r['coverage'])} | "
                  f"{fmt_pct(r['precision_when_answered'])} | {fmt_pct(r['complaint_recall'])} |")
    md += [
        "",
        "- **Coverage** = share of messages the system labels itself (the rest become `unclassified` → human review).",
        "- **Accuracy** counts `unclassified` as wrong, so it is lower than *precision when answered*.",
        "- **Complaint recall** is tracked separately because a missed complaint is the costliest error.",
        "",
        "## Model selection",
        "",
        "- Grouped 5-fold CV on train (groups = template), selecting feature set and C by macro-F1:",
        *[f"  - `{name}`: best C = {c}, CV macro-F1 {fmt_pct(score)}" for name, (score, c) in variant_cv.items()],
        f"- **Selected: `{best_analyzer}`, C = {best_c}.**",
        f"- Vocabulary: {len(vocab)} features ({FEATURE_DESCRIPTIONS[best_analyzer]}, min_df=2).",
        "",
        "## Confidence threshold (chosen on cross-validated TRAIN predictions)",
        "",
        "| Threshold | Coverage | Precision |",
        "|---|---|---|",
    ]
    for row in threshold_table:
        mark = " ← chosen" if row["threshold"] == threshold else ""
        md.append(f"| {row['threshold']} | {fmt_pct(row['coverage'])} | {fmt_pct(row['precision'])}{mark} |")
    md += [
        "",
        f"Rule: lowest threshold whose precision ≥ {fmt_pct(TARGET_PRECISION)}.",
        "",
        "## Per-class results: model with threshold (test)",
        "",
        "| Intent | Precision | Recall | F1 | Support |",
        "|---|---|---|---|---|",
    ]
    for label in labels:
        s = ml_thr["report"][label]
        md.append(f"| {label} | {fmt_pct(s['precision'])} | {fmt_pct(s['recall'])} | {fmt_pct(s['f1-score'])} | {int(s['support'])} |")
    md += ["", "## Confusion matrix: model with threshold (test)", "", markdown_confusion(y_test, pred_thr, labels), "",
           "## Confident mistakes (error analysis)", "",
           "Wrong predictions sorted by model confidence. These show what the model has *learned wrongly*, "
           "which is more useful than the low-confidence ones.", "",
           "| Confidence | Message | True | Predicted |", "|---|---|---|---|"]
    for conf, text, true, pred in errors[:20]:
        md.append(f"| {conf:.2f} | {text.replace('|', '/')} | {true} | {pred} |")
    md.append("")
    (REPORTS / "phase2_evaluation.md").write_text("\n".join(md), encoding="utf-8")

    for r in rows:
        print(f"{r['name']:<42} acc {fmt_pct(r['accuracy']):>6}  macroF1 {fmt_pct(r['macro_f1']):>6}  "
              f"coverage {fmt_pct(r['coverage']):>6}  complaint-recall {fmt_pct(r['complaint_recall']):>6}")
    print(f"best C={best_c}, threshold={threshold}, features={len(vocab)}")
    print(f"wrote {SERVER_CLASSIFIER / 'model.json'} and {REPORTS / 'phase2_evaluation.md'}")


if __name__ == "__main__":
    main()
