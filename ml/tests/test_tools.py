"""Run:  python -m unittest discover -s ml/tests -t ml
All personal data below is invented test data."""
import csv
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import agreement  # noqa: E402
from anonymize import anonymize  # noqa: E402
from features import features  # noqa: E402


class AnonymizeTest(unittest.TestCase):
    def check(self, text, must_not_contain, kind):
        out, found, _ = anonymize(text)
        for s in must_not_contain:
            self.assertNotIn(s, out)
        self.assertIn(kind, found)
        return out

    def test_phone_numbers(self):
        for t in ["call me 9876543210", "+91 98765 43210 pe whatsapp", "my no is 098765-43210"]:
            self.check(t, ["98765", "43210"], "phone")

    def test_email_url_upi_handle(self):
        self.check("mail test.user@example.com", ["test.user", "example.com"], "email")
        self.check("see https://shop.example.in/p/123", ["shop.example"], "url")
        self.check("paid to fakeuser@okaxis", ["fakeuser"], "upi")
        self.check("ask @fake.handle_01", ["fake.handle_01"], "handle")

    def test_order_ids_keep_feature_shape(self):
        original = "order #48213 kab aayega"
        out = self.check(original, ["48213"], "order")
        self.assertEqual(out, "order #00000 kab aayega")
        self.assertEqual(features(out), features(original), "classifier must see the same features")

    def test_names(self):
        out, found, _ = anonymize("Hi, my name is Testa Fakename, size M?")
        self.assertNotIn("Testa", out)
        self.assertIn("name", found)
        _, _, review = anonymize("my name is testa, price?")
        self.assertTrue(review, "lowercase name intro should be flagged for review")

    def test_address_is_flagged_not_silently_passed(self):
        _, _, review = anonymize("deliver to flat 12, sector 5 near the park")
        self.assertTrue(review)

    def test_plain_messages_untouched(self):
        for t in ["price?", "COD available?", "size M hai?", "received damaged kurta"]:
            out, found, review = anonymize(t)
            self.assertEqual(out, t)
            self.assertEqual(found, [])
            self.assertFalse(review)


def rows_of(path):
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


class AgreementTest(unittest.TestCase):
    def test_kappa_bands(self):
        self.assertEqual(agreement.interpret(0.80), "substantial")
        self.assertEqual(agreement.interpret(0.81), "almost perfect")
        self.assertEqual(agreement.interpret(-0.1), "no better than chance")

    def test_sheet_and_score(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            src = d / "anon.csv"
            with open(src, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=["text", "needs_review"])
                w.writeheader()
                for t in ["price?", "PRICE?", "cod?", "damaged", "hi", "??", "size M"]:
                    w.writerow({"text": t, "needs_review": ""})
            sheet = d / "sheet.csv"
            agreement.main(["sheet", str(src), "-n", "10", "-o", str(sheet)])
            rows = rows_of(sheet)
            self.assertEqual(len(rows), 6, "case-insensitive duplicates removed")

            gold = {"price?": "price", "cod?": "cod_shipping", "damaged": "complaint", "hi": "greeting",
                    "??": "follow_up", "size m": "size"}
            for r in rows:
                r["label_a"] = gold[r["text"].lower()]
                r["label_b"] = "follow_up" if r["text"] == "hi" else gold[r["text"].lower()]
            with open(sheet, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=["id", "text", "label_a", "label_b"])
                w.writeheader()
                w.writerows(rows)

            agreement.main(["score", str(sheet)])
            labelled = rows_of(d / "labelled.csv")
            disputed = rows_of(d / "disputed.csv")
            self.assertEqual(len(labelled), 5)
            self.assertEqual([r["text"] for r in disputed], ["hi"])
            self.assertIn("Cohen's kappa", (d / "agreement_report.md").read_text(encoding="utf-8"))

    def test_rejects_unreviewed_rows_and_bad_labels(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            src = d / "anon.csv"
            src.write_text("text,needs_review\nflat 12 sector 5,yes\n", encoding="utf-8")
            with self.assertRaises(SystemExit):
                agreement.main(["sheet", str(src), "-o", str(d / "s.csv")])
            bad = d / "bad.csv"
            bad.write_text("id,text,label_a,label_b\n1,price?,price,cost\n2,hi,greeting,greeting\n", encoding="utf-8")
            with self.assertRaises(SystemExit):
                agreement.main(["score", str(bad)])


if __name__ == "__main__":
    unittest.main()
