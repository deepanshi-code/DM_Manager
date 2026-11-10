"""Text -> feature strings. MUST stay identical to server/src/classifier/features.js.

The parity test (server/test/classifier.test.js) checks that Python and JS give
the same probabilities, so a mismatch here fails the build instead of silently
making the live model worse.

Features per message:
  w:<token>         word unigrams        "w:price"
  b:<tok> <tok>     word bigrams         "b:kitna ka"
  c:<3-4 chars>     character n-grams    "c: pl", "c:plz "  -> robust to pls/plz/plzz, typos
  k:<intent>        keyword-rule hits    "k:complaint"   (hybrid model only)

The k: features let the model use hand-written domain knowledge (keyword_rules.json)
while learning from data how much to trust each rule.
"""
import json
import re
from pathlib import Path

_RULES_PATH = Path(__file__).resolve().parent.parent / "server" / "src" / "classifier" / "keyword_rules.json"
_RULES = [
    (r["intent"], [re.compile(p) for p in r["patterns"]])
    for r in json.loads(_RULES_PATH.read_text(encoding="utf-8"))["rules"]
]

_DIGITS = re.compile(r"[0-9]+")          # order numbers, prices -> "0" (ASCII only, same as JS)
_REPEAT = re.compile(r"(.)\1{2,}")      # "hiiii" -> "hii", "????" -> "??"
_TOKEN = re.compile(r"[a-z0]+|\?+|!+")  # Latin words, numbers, runs of ? and !
_WORD = re.compile(r"[a-z]+")


def preprocess(text: str) -> str:
    t = text.lower()
    t = _DIGITS.sub("0", t)
    t = _REPEAT.sub(r"\1\1", t)
    return t


def tokens(text: str) -> list[str]:
    return _TOKEN.findall(preprocess(text))


def features(text: str) -> list[str]:
    toks = tokens(text)
    if not toks:
        return ["w:<empty>"]
    feats = [f"w:{t}" for t in toks]
    feats += [f"b:{a} {b}" for a, b in zip(toks, toks[1:])]
    for t in toks:
        if _WORD.fullmatch(t):
            padded = f" {t} "
            for n in (3, 4):
                feats += [f"c:{padded[i:i + n]}" for i in range(len(padded) - n + 1)]
    return feats


def rule_hits(text: str) -> list[str]:
    """Every intent whose keyword rule matches (not just the first)."""
    t = preprocess(text)
    return [intent for intent, patterns in _RULES if any(p.search(t) for p in patterns)]


def hybrid_features(text: str) -> list[str]:
    return features(text) + [f"k:{intent}" for intent in rule_hits(text)]


def word_hybrid_features(text: str) -> list[str]:
    """Words + bigrams + rule hits, no char n-grams (so rule features are not drowned out)."""
    return [f for f in features(text) if not f.startswith("c:")] + [f"k:{intent}" for intent in rule_hits(text)]
