"""Generate a SYNTHETIC labelled DM dataset for developing the intent classifier.

    python ml/generate_dataset.py            -> ml/data/synthetic_train.csv, synthetic_test.csv

Why split by TEMPLATE, not by row:
  Each template ("{product} kitna ka hai") produces many near-identical rows.
  A random row split would put siblings of the same sentence in both train and
  test, so the model is tested on sentences it has effectively already seen
  (data leakage) and the score is inflated. Here every template goes entirely
  to train OR to test, so the test set measures generalisation to new phrasings.

Even so, synthetic data is cleaner and more predictable than real DMs. Use it
to compare approaches; report final accuracy on real, anonymised messages.
"""
import csv
import random
from pathlib import Path

SEED = 42
VARIANTS_PER_TEMPLATE = 10
TEST_FRACTION = 0.3

SLOTS = {
    "product": ["kurta", "co-ord set", "tote bag", "oversized tee", "palazzo", "jhumkas", "denim jacket",
                "saree", "dupatta", "crop top", "lehenga", "anarkali", "sling bag", "hoodie"],
    "color": ["black", "maroon", "mint green", "beige", "navy", "mustard", "pink", "white", "olive"],
    "size": ["XS", "S", "M", "L", "XL", "XXL"],
    "city": ["Dehradun", "Delhi", "Jaipur", "Pune", "Lucknow", "Haldwani", "Indore", "Mumbai", "Chandigarh"],
    "order": [str(n) for n in range(10000, 99999, 7919)],
    "price": ["500", "999", "1000", "1500", "2000"],
}

TEMPLATES = {
    "price": [
        "price?", "price pls", "pp", "pp?", "what is the price", "what's the price of the {product}",
        "how much for the {color} {product}", "{product} kitna ka hai", "iska price kya hai", "rate kya hai",
        "rate?", "price in dm", "dm price", "kitne ka hai ye", "cost of this {product}?",
        "is the {product} under {price}?", "how much is this one", "price batao",
        "what does the {color} one cost", "any discount on the {product}?", "price of {product} in {size}?",
    ],
    "size": [
        "is the {product} available in {size}", "{size} size hai?", "size chart pls", "send size chart",
        "will {size} fit a 32 waist?", "do you have plus sizes", "what size should i take, height 5'4",
        "is it true to size?", "kya {size} mein milega", "bust size for {size}?", "{product} ka length kitna hai",
        "does {size} run small?", "{size} available?", "size guide please", "my size is {size}, which one fits",
        "kaunsa size lu",
    ],
    "availability": [
        "is this back in stock", "{product} available hai", "when will the {color} one restock",
        "is the {color} {product} sold out", "stock hai?", "available?", "is this still available",
        "do you have this in {color}", "{color} colour milega?", "when is the next drop", "restock kab hoga",
        "can i still order the {product}", "is this item available now", "out of stock kyu dikha raha hai",
        "any more pieces left of the {product}?",
    ],
    "cod_shipping": [
        "cod available?", "cash on delivery hai kya", "do you deliver to {city}", "delivery charges for {city}?",
        "how many days for delivery to {city}", "shipping free hai?", "do you ship internationally",
        "cod option hai?", "can i pay on delivery", "kitne din mein aayega {city} mein",
        "is shipping free above {price}?", "do you deliver to pincode 248001", "express delivery available?",
        "{city} delivery possible?", "payment options kya hai",
    ],
    "order_status": [
        "order #{order} kab aayega", "where is my order {order}", "tracking link not working for order {order}",
        "order {order} still not shipped", "my order hasn't arrived yet", "when will my order be dispatched",
        "it's been a week, where is my parcel", "order status for {order}?", "track my order pls",
        "mera order kab tak aayega", "shipped or not? order {order}", "tracking id bhejo",
        "parcel stuck at {city} hub", "order placed on monday, no update", "did my order {order} go out today?",
    ],
    "return_exchange": [
        "how do i return the {product}", "exchange possible hai?", "refund status for order {order}",
        "want to exchange {product} for {size}", "size doesn't fit, can i exchange", "return policy kya hai",
        "how many days for refund", "i want a refund", "can i return if i don't like it",
        "exchange ka process batao", "return pickup kab hoga", "refund not received yet for {order}",
        "want to swap for {color}", "is there a return window?", "returning the {product}, how?",
    ],
    "complaint": [
        "received a damaged {product}, very disappointed", "wrong colour bheja hai, i ordered {color}",
        "paid 3 days ago, no confirmation yet!!", "quality is not like the pictures. not happy",
        "this is so bad, the stitching came off", "worst experience ever", "the {product} is torn",
        "you sent the wrong size and nobody is replying", "fake product, not what was shown",
        "very poor quality, waste of money", "colour faded after one wash", "item missing from my parcel",
        "bahut ganda quality hai", "i want to complain about my order {order}", "reporting your page if no reply",
        "cheated, paisa gaya", "packaging was opened when it arrived",
    ],
    "collab": [
        "hi! i'm a creator with 20k followers, open to collab?", "collab?", "pr package bhej sakte ho?",
        "interested in a paid promotion?", "let's collaborate", "i make reels, can we work together",
        "barter collab possible?", "i'm an influencer from {city}, dm for collab",
        "would love to feature your {product} in my reel", "are you open to ugc content?",
        "brand ambassador program hai?", "we are a marketing agency, can we talk",
        "can you share your collab terms", "affiliate program available?",
    ],
    "spam": [
        "get 10k followers in 1 day!! click link in bio", "promote your page at cheap price", "check my page",
        "you won a giveaway! claim now", "earn 5000 daily from home", "dm for crypto investment tips",
        "buy followers cheap", "your account will be suspended, verify here", "free iphone giveaway click link",
        "increase your reach, 100% real followers", "follow for follow?", "f4f", "send this to 10 friends",
        "make money online, no investment",
    ],
    "greeting": [
        "hi", "hello", "hey", "hii", "good morning", "love this", "beautiful collection!", "amazing work",
        "your page is so pretty", "namaste", "hey there", "wow", "so cute", "nice", "obsessed with your stuff",
        "thank you",
    ],
    "follow_up": [
        "??", "hello??", "please reply", "anyone there?", "still waiting for a reply", "reply?", "hellooo",
        "why no reply", "ji?", "waiting", "plz answer", "seen karke reply nahi kiya", "reply kab karoge",
        "ping", "any update??", "bhai reply karo", "sir?",
    ],
}

PREFIXES = ["hi ", "hello ", "hey ", "hii ", "mam ", "sir "]
SUFFIXES = [" pls", " plz", " please", " ji", " bhai", " yaar", " thanks", " asap"]
EMOJIS = [" 😍", " 🙏", " ❤️", " 🔥", " 😭", " 🥺"]


def noisy(text: str, rng: random.Random, intent: str) -> str:
    """Make a template look like a real, messy DM."""
    t = text
    if intent not in ("greeting", "follow_up") and rng.random() < 0.25:
        t = rng.choice(PREFIXES) + t
    if rng.random() < 0.2:
        t = t.rstrip("?!.") + rng.choice(SUFFIXES)
    if rng.random() < 0.3:
        t = t.rstrip("?!.")
    if rng.random() < 0.1:
        words = t.split()
        i = rng.randrange(len(words))
        w = words[i]
        if len(w) > 3 and w.isalpha():  # swap two letters: a realistic typo
            j = rng.randrange(len(w) - 1)
            words[i] = w[:j] + w[j + 1] + w[j] + w[j + 2:]
            t = " ".join(words)
    if t.endswith("?") and rng.random() < 0.15:
        t += "??"
    if rng.random() < 0.12:
        t += rng.choice(EMOJIS)
    case = rng.random()
    if case < 0.5:
        t = t.lower()
    elif case < 0.6:
        t = t.upper()
    elif case < 0.85:
        t = t[:1].upper() + t[1:]
    return t


def fill(template: str, rng: random.Random) -> str:
    out = template
    for key, values in SLOTS.items():
        while "{" + key + "}" in out:
            out = out.replace("{" + key + "}", rng.choice(values), 1)
    return out


def main() -> None:
    rng = random.Random(SEED)
    train, test = [], []
    for intent, templates in TEMPLATES.items():
        ids = [f"{intent}:{i:02d}" for i in range(len(templates))]
        order = list(range(len(templates)))
        rng.shuffle(order)
        n_test = max(2, round(len(templates) * TEST_FRACTION))
        test_idx = set(order[:n_test])
        for i, template in enumerate(templates):
            target = test if i in test_idx else train
            seen = set()
            for _ in range(VARIANTS_PER_TEMPLATE):
                text = noisy(fill(template, rng), rng, intent)
                if text not in seen:
                    seen.add(text)
                    target.append({"text": text, "intent": intent, "template_id": ids[i]})

    # Safety net: drop any test row whose exact text also occurs in train.
    train_texts = {r["text"].lower() for r in train}
    before = len(test)
    test = [r for r in test if r["text"].lower() not in train_texts]

    out_dir = Path(__file__).parent / "data"
    out_dir.mkdir(exist_ok=True)
    for name, rows in (("synthetic_train.csv", train), ("synthetic_test.csv", test)):
        rng.shuffle(rows)
        with open(out_dir / name, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["text", "intent", "template_id"])
            writer.writeheader()
            writer.writerows(rows)
    print(f"train: {len(train)} rows from {len({r['template_id'] for r in train})} templates")
    print(f"test:  {len(test)} rows from {len({r['template_id'] for r in test})} templates "
          f"({before - len(test)} exact-duplicate rows removed)")


if __name__ == "__main__":
    main()
