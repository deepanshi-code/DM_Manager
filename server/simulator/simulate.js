// Replays synthetic DMs into the server as Instagram-style webhook events,
// so the whole system can be built and demoed before Meta App Review.
//
//   npm run simulate                        send every message, ~1.5s apart
//   npm run simulate -- --count 20          only the first 20 messages
//   npm run simulate -- --interval 300      faster
//   npm run simulate -- --dup-rate 0.2      re-deliver 20% of events (tests idempotency)
//   npm run simulate -- --burst             no delay: a "500 DMs at once" spike
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: `http://localhost:${process.env.PORT || 4000}/webhook/instagram` },
    file: { type: 'string', default: fileURLToPath(new URL('./data/synthetic_dms.json', import.meta.url)) },
    count: { type: 'string' },
    interval: { type: 'string', default: '1500' },
    'dup-rate': { type: 'string', default: '0.05' },
    burst: { type: 'boolean', default: false },
  },
});

const BUSINESS_ID = 'sim_business_account';
const secret = process.env.IG_APP_SECRET || '';
const interval = args.burst ? 0 : Number(args.interval);
const dupRate = Number(args['dup-rate']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { customers } = JSON.parse(await readFile(args.file, 'utf8'));

// Interleave customers like a real inbox: a customer's messages stay in order,
// but different customers' messages are mixed together.
const queues = customers.map((c) => c.messages.map((m) => ({ ...m, customer: c })));
const timeline = [];
while (queues.some((q) => q.length)) {
  const open = queues.filter((q) => q.length);
  timeline.push(open[Math.floor(Math.random() * open.length)].shift());
}
const toSend = args.count ? timeline.slice(0, Number(args.count)) : timeline;

function buildPayload(item) {
  const now = Date.now();
  return JSON.stringify({
    object: 'instagram',
    entry: [{
      id: BUSINESS_ID,
      time: now,
      messaging: [{
        // `username` is a simulator-only extra; real webhooks only give the ID.
        sender: { id: item.customer.igUserId, username: item.customer.username },
        recipient: { id: BUSINESS_ID },
        timestamp: now,
        message: { mid: `sim_${crypto.randomUUID()}`, text: item.text },
      }],
    }],
  });
}

async function deliver(body) {
  const headers = { 'content-type': 'application/json' };
  if (secret) headers['x-hub-signature-256'] = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  const res = await fetch(args.url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

console.log(`Sending ${toSend.length} DMs to ${args.url} (interval ${interval}ms, dup-rate ${dupRate})`);
let sent = 0, dups = 0;
for (const item of toSend) {
  const body = buildPayload(item);
  try {
    await deliver(body);
    sent += 1;
    console.log(`→ @${item.customer.username.padEnd(18)} ${item.text}`);
    if (Math.random() < dupRate) {
      const r = await deliver(body); // same mid: the server should ignore it
      dups += 1;
      console.log(`  ↺ re-delivered (server stored ${r.stored}, ignored ${r.duplicates} duplicate)`);
    }
  } catch (err) {
    console.error(`✖ failed: ${err.message}. Is the server running (npm run dev:server)?`);
    process.exit(1);
  }
  if (interval) await sleep(interval * (0.5 + Math.random()));
}
console.log(`Done: ${sent} messages sent, ${dups} duplicate deliveries.`);
