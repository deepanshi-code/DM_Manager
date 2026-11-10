# Real messages: workflow

Everything in this folder except this README is **git-ignored**, because it contains customer text.

## You need
- A seller who agrees to share messages for your project. Get their permission in writing (a WhatsApp or email "yes" is enough for a student project), and agree that the data stays private and is deleted after the project.
- 100–200 messages. They can come from the dashboard export (once Instagram is connected) or be copied from their inbox into a CSV with a `text` column.
- A second person to label alongside you (a classmate is fine).

## Steps
```bash
# 1. Remove personal data (phone, email, UPI, @handles, order IDs, introduced names)
python ml/anonymize.py raw.csv -o ml/data/real/anonymised.csv
#    Then open anonymised.csv and READ every row marked needs_review=yes.
#    Fix anything personal by hand, then clear the needs_review cell.
#    Delete raw.csv once you're done.

# 2. Make a labelling sheet (50 random, de-duplicated messages)
python ml/agreement.py sheet ml/data/real/anonymised.csv -n 50 -o ml/data/real/sheet.csv

# 3. You fill label_a, your partner fills label_b, separately, using ../../LABELS.md

# 4. Measure agreement -> labelled.csv, disputed.csv, agreement_report.md
python ml/agreement.py score ml/data/real/sheet.csv

# 5. Discuss disputed.csv, append the agreed rows to labelled.csv,
#    label the remaining messages yourself, and evaluate:
python ml/train.py --real ml/data/real/labelled.csv
```

## What to report
- Percent agreement and Cohen's kappa between the two labellers. This is the human ceiling.
- Model accuracy, macro-F1 and **complaint recall** on the real set, next to the synthetic numbers.
- The 10 most confident mistakes, with your explanation of each.

If real-data results are much worse than synthetic ones, that's an expected and reportable finding, not a failure. It shows why the synthetic evaluation was not enough.
