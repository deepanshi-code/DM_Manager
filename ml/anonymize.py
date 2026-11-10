"""Remove personal data from customer messages before they are used for training or evaluation.

    python ml/anonymize.py export.csv -o ml/data/real/anonymised.csv
    python ml/anonymize.py export.csv -o out.csv --names names.txt   # also mask known names

Input: any CSV with a `text` column (e.g. the dashboard export /api/labels.csv).
Output: the same columns with `text` anonymised, plus
  `pii_found`     what was replaced (e.g. "phone,order")
  `needs_review`  "yes" if something still looks personal (an address word, a possible name)

This is a FIRST PASS, not a guarantee. Regexes cannot find every name or address.
Read every row marked needs_review=yes (and spot-check the rest) before the file
leaves the business or goes anywhere near GitHub.

Design choice: numbers are replaced by zeros of the same length ("98765 43210" ->
"00000 00000"). The classifier already maps every digit run to "0", so this keeps
the model's features identical to the original message, while words like
"[email]" would add tokens the model never sees in real traffic.
"""
import argparse
import csv
import re
import sys
from pathlib import Path

ZEROS = lambda m: re.sub(r"[0-9]", "0", m.group(0))  # noqa: E731

# Order matters: emails/URLs before handles, phone numbers before generic long numbers.
PATTERNS = [
    ("email", re.compile(r"\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b"), lambda m: "[email]"),
    ("url", re.compile(r"\b(?:https?://|www\.)\S+", re.I), lambda m: "[link]"),
    ("upi", re.compile(r"\b[\w.-]{2,}@(?:ok\w+|ybl|paytm|upi|ibl|axl|apl|sbi|icici|hdfcbank)\b", re.I),
     lambda m: "[upi]"),
    ("handle", re.compile(r"(?<![\w@])@[A-Za-z0-9._]{2,30}"), lambda m: "@user"),
    # Indian mobile numbers: optional +91 / 0, then 10 digits starting 6-9, spaces or dashes allowed
    ("phone", re.compile(r"(?<!\d)(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)"), ZEROS),
    ("order", re.compile(r"#\s?\d{3,}|\b(?:order|ord|awb|tracking|track)\s*(?:id|no\.?|number)?\s*[:#-]?\s*\d{3,}", re.I),
     ZEROS),
    ("number", re.compile(r"\d{5,}"), ZEROS),  # pincodes, account numbers, anything long
]

_INTRO = r"\b(?i:my name is|i am|i'm|this is|mera naam|naam)\s+"
NAME_INTRO = re.compile(_INTRO + r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)")  # "my name is Riya Sharma"
INTRO_ANY = re.compile(r"\b(?:my name is|mera naam|naam)\s+\w+", re.I)  # "my name is riya" (lowercase)
ADDRESS_WORDS = re.compile(
    r"\b(?:flat|house no|h\.?\s?no|plot|sector|street|road|nagar|colony|apartment|apt|near|landmark|"
    r"gali|mohalla|village|district|address|pincode|pin code)\b",
    re.I,
)


def load_names(path):
    if not path:
        return None
    names = [n.strip() for n in Path(path).read_text(encoding="utf-8").splitlines() if n.strip()]
    if not names:
        return None
    return re.compile(r"\b(?:" + "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True)) + r")\b", re.I)


def anonymize(text, names_re=None):
    """Return (clean_text, found_kinds, needs_review)."""
    found = []
    out = text
    for kind, pattern, repl in PATTERNS:
        changed = []

        def sub(m, repl=repl, changed=changed):
            new = repl(m)
            if new != m.group(0):  # e.g. an order ID already zeroed is not "found" again
                changed.append(True)
            return new

        out = pattern.sub(sub, out)
        if changed:
            found.append(kind)
    out, n = NAME_INTRO.subn(lambda m: m.group(0).replace(m.group(1), "[name]"), out)
    if n:
        found.append("name")
    if names_re:
        out, n = names_re.subn("[name]", out)
        if n and "name" not in found:
            found.append("name")
    needs_review = (
        bool(ADDRESS_WORDS.search(out))
        or bool(re.search(r"\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b", out))  # "Riya Sharma"-like pairs
        or bool(INTRO_ANY.search(out.replace("[name]", "")) and "[name]" not in out)
    )
    return out, found, needs_review


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path)
    parser.add_argument("-o", "--output", type=Path, required=True)
    parser.add_argument("--names", help="text file with one known name per line (customers, staff)")
    args = parser.parse_args(argv)

    names_re = load_names(args.names)
    with open(args.input, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if "text" not in (reader.fieldnames or []):
            sys.exit(f"{args.input} has no 'text' column (found: {reader.fieldnames})")
        rows = list(reader)
        fields = list(reader.fieldnames)

    counts, review = {}, 0
    for row in rows:
        row["text"], found, flag = anonymize(row["text"], names_re)
        row["pii_found"] = ",".join(found)
        row["needs_review"] = "yes" if flag else ""
        review += flag
        for k in found:
            counts[k] = counts.get(k, 0) + 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields + ["pii_found", "needs_review"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"{len(rows)} messages -> {args.output}")
    print("replaced:", ", ".join(f"{k} in {v}" for k, v in sorted(counts.items())) or "nothing")
    print(f"{review} message(s) marked needs_review=yes: read them before using the file.")


if __name__ == "__main__":
    main()
