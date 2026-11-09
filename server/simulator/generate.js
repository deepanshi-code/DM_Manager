// Generates SYNTHETIC Instagram DMs for a fictional small clothing brand.
// No real customer data. Seeded, so every run produces the same file.
//
//   npm run generate-data            -> simulator/data/synthetic_dms.json
//   npm run generate-data -- 80 7    -> 80 customers, seed 7
//
// Each message carries an `intent` label. These labels are for trying out the
// Phase 2 classifier only; report final accuracy on REAL (anonymised) messages.
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const customers = Number(process.argv[2] ?? 40);
let seed = Number(process.argv[3] ?? 42);

// mulberry32: tiny deterministic PRNG
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const fill = {
  product: ['kurta', 'co-ord set', 'tote bag', 'oversized tee', 'palazzo', 'jhumkas', 'denim jacket', 'saree'],
  color: ['black', 'maroon', 'mint green', 'beige', 'navy', 'mustard'],
  size: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  city: ['Dehradun', 'Delhi', 'Jaipur', 'Pune', 'Lucknow', 'Haldwani', 'Indore'],
  order: () => String(10000 + Math.floor(rand() * 89999)),
};
const render = (template) =>
  template.replace(/\{(\w+)\}/g, (_, key) => (typeof fill[key] === 'function' ? fill[key]() : pick(fill[key])));

// Mix of English, Hinglish and Instagram shorthand, which is what real inboxes look like.
const TEMPLATES = {
  price: [
    'price?', 'Price plz', 'pp', "What's the price of the {product}?", '{product} kitna ka hai?',
    'rate kya hai iska', 'Price for the {color} {product}?', 'price in dm pls',
  ],
  size: [
    'Is the {product} available in {size}?', '{size} size hai?', 'size chart bhejo pls',
    'Will {size} fit a 32 waist?', 'Do you have plus sizes?',
  ],
  availability: [
    'Is this back in stock?', '{product} available hai?', 'When will the {color} one restock?',
    'is the {color} {product} sold out??',
  ],
  cod_shipping: [
    'COD available?', 'cash on delivery hai kya', 'Do you deliver to {city}?',
    'Delivery charges for {city}?', 'How many days for delivery to {city}?',
  ],
  order_status: [
    'Order #{order} kab aayega?', "Where is my order {order}? It's been 6 days",
    'tracking link not working for order {order}', 'Order {order} still not shipped',
  ],
  return_exchange: [
    'How do I return the {product}? wrong size', 'exchange possible hai? size {size} chahiye',
    'Refund status for order {order}?', 'Want to exchange {product} for {size}',
  ],
  complaint: [
    'Received a damaged {product}, very disappointed', 'Wrong colour bheja hai, I ordered {color}',
    'Paid 3 days ago, no confirmation yet!!', 'Quality is not like the pictures. Not happy.',
  ],
  collab: [
    "Hi! I'm a fashion creator with 20k followers, open to a collab?", 'Collab? DM for rates',
    'PR package bhej sakte ho? Will post a reel', 'Interested in a paid promotion?',
  ],
  spam: [
    'Get 10k followers in 1 day!! click link in bio', 'Promote your page at cheap price',
    '🔥🔥🔥 check my page', 'You won a giveaway! claim now',
  ],
  greeting: ['Hi', 'hello', 'hey 👋', '😍😍 love this', 'Beautiful collection!'],
};
// What forgotten customers send next: the exact problem this project solves.
const FOLLOW_UPS = ['??', 'hello??', 'Please reply', 'Anyone there?', 'Still waiting for a reply...'];

const INTENT_WEIGHTS = [
  ['price', 22], ['size', 12], ['availability', 10], ['cod_shipping', 12], ['order_status', 12],
  ['return_exchange', 7], ['complaint', 6], ['collab', 7], ['spam', 6], ['greeting', 6],
];
const totalWeight = INTENT_WEIGHTS.reduce((s, [, w]) => s + w, 0);
function pickIntent() {
  let r = rand() * totalWeight;
  for (const [intent, w] of INTENT_WEIGHTS) if ((r -= w) < 0) return intent;
  return 'price';
}

const FIRST = ['riya', 'aman', 'priya', 'kabir', 'sneha', 'arjun', 'isha', 'dev', 'tanya', 'rohit', 'neha', 'yash', 'anya', 'kunal', 'meher', 'zoya'];
const STYLE = (name) => pick([`${name}_${Math.floor(rand() * 999)}`, `${name}.styles`, `the.${name}`, `${name}${Math.floor(rand() * 99)}`, `its_${name}`]);

const out = [];
for (let i = 0; i < customers; i++) {
  const messages = [];
  const intent = pickIntent();
  if (intent === 'greeting' && rand() < 0.7) {
    messages.push({ text: render(pick(TEMPLATES.greeting)), intent: 'greeting' });
    const real = pickIntent();
    messages.push({ text: render(pick(TEMPLATES[real])), intent: real });
  } else {
    messages.push({ text: render(pick(TEMPLATES[intent])), intent });
  }
  if (intent !== 'spam' && rand() < 0.35) messages.push({ text: pick(FOLLOW_UPS), intent: 'follow_up' });
  out.push({
    igUserId: String(17840000000000000 + Math.floor(rand() * 9_999_999_999)),
    username: STYLE(pick(FIRST)),
    messages,
  });
}

const file = new URL('./data/synthetic_dms.json', import.meta.url);
await mkdir(new URL('./data/', import.meta.url), { recursive: true });
await writeFile(
  file,
  JSON.stringify(
    {
      note: 'SYNTHETIC data generated by simulator/generate.js. Not real customer messages.',
      customers: out,
    },
    null,
    2,
  ),
);
const n = out.reduce((s, c) => s + c.messages.length, 0);
console.log(`Wrote ${out.length} customers / ${n} messages to ${fileURLToPath(file)}`);
