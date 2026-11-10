# ml/: intent classifier (Phase 2)

Sorts each customer DM into one of 11 intents (price, size, COD/shipping, complaint, spam, …). Label definitions and tie-break rules: [LABELS.md](LABELS.md).

```bash
pip install -r ml/requirements.txt
python ml/generate_dataset.py     # synthetic data, split by template
python ml/train.py                # train + evaluate + export the model to the server
python ml/train.py --real ml/data/real/labelled.csv   # once you have real labels
```

Tools for real data (full workflow: [data/real/README.md](data/real/README.md)):
```bash
python ml/anonymize.py raw.csv -o ml/data/real/anonymised.csv        # strip phone/email/UPI/handles/order IDs/names
python ml/agreement.py sheet ml/data/real/anonymised.csv -n 50 -o ml/data/real/sheet.csv
python ml/agreement.py score ml/data/real/sheet.csv                   # % agreement + Cohen's kappa
python -m unittest discover -s ml/tests                               # 9 tests for these tools
```

`train.py` writes:
- `server/src/classifier/model.json`: the model the Node server runs (no Python at runtime)
- `server/test/fixtures/classifier_parity.json`: lets the JS tests check that Node gives the same probabilities as Python
- `ml/reports/phase2_evaluation.md`: the full evaluation, including the confusion matrix and error analysis

## Method in one paragraph
TF-IDF features (words, word pairs, and optionally character n-grams), plus "keyword rule matched" features, feed a logistic regression. The feature set and regularisation strength C are chosen by **5-fold cross-validation grouped by template, on training data only**. The confidence threshold is chosen from cross-validated training predictions (the lowest threshold with ≥ 90% precision). The test set is used **once**, for reporting. The server applies this policy: use the model if it's confident, otherwise the keyword rule, otherwise the model's guess flagged as low confidence.

## Results so far (synthetic data, so read the caveats)

| Approach (test) | Accuracy | Macro-F1 | Complaint recall |
|---|---|---|---|
| Keyword rules (leaked, see below) | 76.6% | 79.0% | 54% |
| Words + char n-grams model | 56.6% | 54.3% | 5% |
| **Server policy (words + rules model)** | **76.1%** | **73.9%** | **22%** |

What these numbers show, and what they don't:
1. **Splitting by template matters.** The test set only contains phrasings the model never saw. A random row split would leak near-duplicate sentences and produce misleadingly high scores.
2. **Too little variety in the training data.** About 125 synthetic templates are not enough for a bag-of-words model to handle new phrasings. Hand-written domain keywords help more than character n-grams.
3. **The keyword rules are leaked.** They were written by someone who had seen every template, including the test ones. Any number that uses the rules is optimistic. The only leak-free estimate is the grouped-CV score of the words + char n-grams model (about 50% macro-F1).
4. **Complaints are the weak spot**, and also the most costly class to miss. Complaints are phrased in very different ways.

## How to improve it (in order of value)
1. **Real data.** Agents correct labels in the dashboard, and corrections are stored next to the prediction, so the model's mistakes stay measurable. Export with `GET /api/labels.csv?corrected=1`, **anonymise** it, save it as `ml/data/real/labelled.csv`, then retrain and evaluate with `--real`.
2. **Pretrained multilingual sentence embeddings** (a small transformer) instead of TF-IDF. These generalise to synonyms such as damaged, torn and broken without needing examples of each.
3. **Cost-aware decisions for complaints.** For example, raise priority whenever P(complaint) is above a low threshold, tuned on real data.
