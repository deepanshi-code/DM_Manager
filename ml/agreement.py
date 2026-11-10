"""Two people label the same messages; measure how much they agree.

Why: if two careful humans agree on only 80% of messages, no model can honestly be
expected to beat ~80%, and the disagreements show which label definitions in
LABELS.md are unclear. Report this number next to your model's accuracy.

1) Make a blank labelling sheet (random sample, shuffled):
    python ml/agreement.py sheet ml/data/real/anonymised.csv -n 50 -o ml/data/real/sheet.csv

2) Copy the sheet. Person A fills `label_a`, person B fills `label_b`, WITHOUT discussing.
   Merge both columns into one file (or fill both columns in the same file).

3) Score it:
    python ml/agreement.py score ml/data/real/sheet.csv

   Prints percent agreement and Cohen's kappa, writes
     agreement_report.md   per-label disagreements, examples to discuss
     labelled.csv          rows where A and B agree  -> ready for train.py --real
     disputed.csv          rows to discuss; add the agreed label and append to labelled.csv
"""
import argparse
import csv
import random
import sys
from collections import Counter
from pathlib import Path

from sklearn.metrics import cohen_kappa_score

VALID = {
    "price", "size", "availability", "cod_shipping", "order_status", "return_exchange",
    "complaint", "collab", "spam", "greeting", "follow_up",
}


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path, rows, fields):
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def make_sheet(args):
    rows = read_csv(args.input)
    flagged = [r for r in rows if r.get("needs_review") == "yes"]
    if flagged:
        sys.exit(f"{len(flagged)} row(s) still marked needs_review=yes. Check them, clear the column, then retry.")
    rng = random.Random(args.seed)
    seen, unique = set(), []
    for r in rows:  # skip exact duplicates so both people don't label "price?" five times
        key = r["text"].strip().lower()
        if key and key not in seen:
            seen.add(key)
            unique.append(r)
    sample = rng.sample(unique, min(args.n, len(unique)))
    out = [{"id": i + 1, "text": r["text"], "label_a": "", "label_b": ""} for i, r in enumerate(sample)]
    write_csv(args.output, out, ["id", "text", "label_a", "label_b"])
    print(f"wrote {len(out)} messages to {args.output}")
    print("Allowed labels:", ", ".join(sorted(VALID)))


def interpret(kappa):
    # Landis & Koch (1977) bands, the usual rough guide: <=0.20 slight, 0.21-0.40 fair,
    # 0.41-0.60 moderate, 0.61-0.80 substantial, 0.81-1.00 almost perfect
    if kappa <= 0:
        return "no better than chance"
    for limit, word in [(0.2, "slight"), (0.4, "fair"), (0.6, "moderate"), (0.8, "substantial")]:
        if kappa <= limit + 1e-9:
            return word
    return "almost perfect"


def score(args):
    rows = read_csv(args.sheet)
    problems = []
    for r in rows:
        for col in ("label_a", "label_b"):
            r[col] = (r.get(col) or "").strip().lower()
            if r[col] not in VALID:
                problems.append(f"row id={r.get('id')}: {col}={r[col]!r}")
    if problems:
        sys.exit("Fix these labels first (blank or not in LABELS.md):\n  " + "\n  ".join(problems[:20]))
    if len(rows) < 2:
        sys.exit("Need at least 2 labelled rows.")

    a = [r["label_a"] for r in rows]
    b = [r["label_b"] for r in rows]
    agree = [r for r in rows if r["label_a"] == r["label_b"]]
    disputed = [r for r in rows if r["label_a"] != r["label_b"]]
    pct = len(agree) / len(rows)
    kappa = cohen_kappa_score(a, b)
    pairs = Counter(tuple(sorted((r["label_a"], r["label_b"]))) for r in disputed)

    out_dir = args.sheet.parent
    write_csv(out_dir / "labelled.csv", [{"text": r["text"], "intent": r["label_a"]} for r in agree], ["text", "intent"])
    write_csv(out_dir / "disputed.csv",
              [{"id": r.get("id"), "text": r["text"], "label_a": r["label_a"], "label_b": r["label_b"], "agreed": ""}
               for r in disputed],
              ["id", "text", "label_a", "label_b", "agreed"])

    md = [
        "# Labelling agreement",
        "",
        f"- Messages: **{len(rows)}**",
        f"- Percent agreement: **{100 * pct:.1f}%**",
        f"- Cohen's kappa: **{kappa:.2f}** ({interpret(kappa)} agreement; kappa corrects for agreement by chance)",
        "",
        "Interpretation: treat percent agreement as a rough ceiling for model accuracy on this data. "
        "If kappa is below ~0.6, improve LABELS.md before collecting more labels.",
        "",
        "## Most common disagreements",
        "",
        "| Label pair | Count |",
        "|---|---|",
        *[f"| {x} vs {y} | {n} |" for (x, y), n in pairs.most_common()],
        "",
        "## Messages to discuss",
        "",
        "| Message | A | B |",
        "|---|---|---|",
        *[f"| {r['text'].replace('|', '/')} | {r['label_a']} | {r['label_b']} |" for r in disputed],
        "",
    ]
    (out_dir / "agreement_report.md").write_text("\n".join(md), encoding="utf-8")
    print(f"{len(rows)} messages: agreement {100 * pct:.1f}%, Cohen's kappa {kappa:.2f} ({interpret(kappa)})")
    print(f"wrote {out_dir / 'labelled.csv'} ({len(agree)} agreed), {out_dir / 'disputed.csv'} ({len(disputed)}), "
          f"{out_dir / 'agreement_report.md'}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sheet", help="make a blank labelling sheet")
    s.add_argument("input", type=Path)
    s.add_argument("-n", type=int, default=50)
    s.add_argument("-o", "--output", type=Path, required=True)
    s.add_argument("--seed", type=int, default=1)
    s.set_defaults(func=make_sheet)
    c = sub.add_parser("score", help="score a filled sheet")
    c.add_argument("sheet", type=Path)
    c.set_defaults(func=score)
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
