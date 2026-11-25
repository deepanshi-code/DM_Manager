// Load test: is the inbox correct and fast at (well above) the volume in the problem statement?
//
//   npm run loadtest                       5,000 DMs, 1,500 customers, 20 in parallel
//   npm run loadtest -- --messages 20000 --customers 4000 --concurrency 50
//
// Runs the real Express app + webhook + database in this process, on a throwaway in-memory
// PGlite database, so it never touches the demo data. Results are for PGlite on this machine;
// a hosted PostgreSQL behaves differently (usually faster for concurrent writes).
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { initDb, getDb } from '../src/db.js';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';

const { values: args } = parseArgs({
  options: {
    messages: { type: 'string', default: '5000' },
    customers: { type: 'string', default: '1500' },
    concurrency: { type: 'string', default: '20' },
    burst: { type: 'string', default: '500' },
    'burst-concurrency': { type: 'string', default: '50' },
    'dup-rate': { type: 'string', default: '0.1' },
  },
});
const N = Number(args.messages);
const CUSTOMERS = Number(args.customers);
const CONCURRENCY = Number(args.concurrency);
const BURST = Number(args.burst);
const BURST_CONCURRENCY = Number(args['burst-concurrency']);
const DUP_RATE = Number(args['dup-rate']);

config.appSecret = 'loadtest-secret';
config.auth = false;
await initDb({ dataDir: 'memory://' });
const server = createApp().listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const TEXTS = [
  'price?', 'Is size M available?', 'COD available for Pune?', 'Where is my order 48213?', 'hello??',
  'Received a torn kurta, very disappointed', 'exchange possible? need L', 'collab? 20k followers',
  'Earn 5000 daily, DM me', 'Please reply', 'Do you deliver to Jaipur?', 'restock kab hoga?',
];
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rand() * a.length)];

// Build the event list: inbound DMs, some echoes (phone replies), some re-deliveries.
const start = Date.now() - 10 * 86400_000;
const events = [];
for (let i = 0; i < N; i += 1) {
  const customer = `lt_${Math.floor(rand() * CUSTOMERS)}`;
  const at = start + Math.floor((i / N) * 10 * 86400_000);
  const echo = rand() < 0.15;
  events.push({ customer, mid: `lt_mid_${i}`, text: echo ? 'Thanks, sharing details now' : pick(TEXTS), at, echo });
  if (rand() < DUP_RATE) events.push({ ...events[events.length - 1], dup: true }); // Meta retry
}
const uniqueInbound = new Set(events.filter((e) => !e.echo).map((e) => e.mid)).size;
const uniqueEcho = new Set(events.filter((e) => e.echo).map((e) => e.mid)).size;

function payload(e) {
  return JSON.stringify({
    object: 'instagram',
    entry: [{
      id: 'biz', time: e.at,
      messaging: [{
        sender: { id: e.echo ? 'biz' : e.customer }, recipient: { id: e.echo ? e.customer : 'biz' }, timestamp: e.at,
        message: { mid: e.mid, text: e.text, ...(e.echo ? { is_echo: true } : {}) },
      }],
    }],
  });
}

const latencies = [];
let failures = 0;
let refused = 0; // connection refused at the network level (OS limit), not a server error
async function send(e) {
  const body = payload(e);
  const sig = `sha256=${crypto.createHmac('sha256', config.appSecret).update(body).digest('hex')}`;
  const t0 = performance.now();
  try {
    const res = await fetch(`${base}/webhook/instagram`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body,
    });
    latencies.push(performance.now() - t0);
    if (!res.ok) failures += 1;
    await res.arrayBuffer();
  } catch {
    refused += 1;
  }
}

async function runPool(items, concurrency) {
  let i = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (i < items.length) await send(items[i++]);
  });
  await Promise.all(workers);
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const ms = (x) => `${x.toFixed(1)} ms`;

console.log(`Sending ${events.length} webhook events (${uniqueInbound} unique DMs, ${uniqueEcho} phone replies, rest re-deliveries) from ${CUSTOMERS} customers, ${CONCURRENCY} at a time…`);
const t0 = performance.now();
await runPool(events, CONCURRENCY);
const elapsed = (performance.now() - t0) / 1000;

// Burst: N messages from new customers all at once (a viral post / giveaway).
const burst = Array.from({ length: BURST }, (_, i) => ({ customer: `burst_${i}`, mid: `burst_mid_${i}`, text: 'price?', at: Date.now() }));
const burstLat = latencies.length;
const tb = performance.now();
const refusedBefore = refused;
await runPool(burst, BURST_CONCURRENCY);
const burstRefused = refused - refusedBefore;
// Meta re-delivers anything that didn't get a 2xx; do the same for refused connections.
const storedMids = new Set((await getDb().query(`SELECT platform_message_id FROM messages WHERE platform_message_id LIKE 'burst_mid_%'`)).rows.map((r) => r.platform_message_id));
const retry = burst.filter((e) => !storedMids.has(e.mid));
if (retry.length) await runPool(retry, 10);
const burstSecs = (performance.now() - tb) / 1000;
const burstLatencies = latencies.slice(burstLat);

// ---- Correctness ----
const db = getDb();
const one = async (sql) => (await db.query(sql)).rows[0];
const stored = await one(`SELECT count(*) FILTER (WHERE direction = 'INBOUND')::int AS inbound,
                                 count(*) FILTER (WHERE direction = 'OUTBOUND')::int AS outbound
                            FROM messages`);
const dupMids = await one(`SELECT count(*)::int AS n FROM (SELECT platform_message_id FROM messages GROUP BY 1 HAVING count(*) > 1) d`);
const convs = await one(`SELECT count(*)::int AS n, count(DISTINCT contact_id)::int AS contacts FROM conversations`);
const expectedCustomers = new Set([...events, ...burst].map((e) => e.customer)).size;
// Every chat whose latest message is from the customer must be waiting for a reply.
const lost = await one(`
  SELECT count(*)::int AS n FROM conversations c
   WHERE c.needs_reply_since IS NULL AND c.status <> 'RESOLVED'
     AND (SELECT direction FROM messages m WHERE m.conversation_id = c.id ORDER BY sent_at DESC, id DESC LIMIT 1) = 'INBOUND'`);

// ---- Read performance with a full database ----
async function timeGet(path, runs = 20) {
  const t = [];
  for (let i = 0; i < runs; i += 1) {
    const s = performance.now();
    const r = await fetch(`${base}${path}`);
    await r.arrayBuffer();
    t.push(performance.now() - s);
  }
  return pct(t, 50);
}
const inboxMs = await timeGet('/api/conversations?filter=NEEDS_REPLY');
const searchMs = await timeGet('/api/conversations?filter=ALL&q=order');
const statsMs = await timeGet('/api/stats');
const anyId = (await one(`SELECT id FROM conversations ORDER BY id LIMIT 1`)).id;
const chatMs = await timeGet(`/api/conversations/${anyId}`);

const checks = [
  ['Every unique DM stored exactly once', stored.inbound === uniqueInbound + BURST, `${stored.inbound} stored / ${uniqueInbound + BURST} sent`],
  ['Every phone reply (echo) stored once', stored.outbound === uniqueEcho, `${stored.outbound} / ${uniqueEcho}`],
  ['No message stored twice (re-deliveries ignored)', dupMids.n === 0, `${dupMids.n} duplicates`],
  ['One conversation per customer', convs.n === expectedCustomers && convs.contacts === convs.n, `${convs.n} conversations / ${expectedCustomers} customers`],
  ['No unanswered chat hidden from "To reply"', lost.n === 0, `${lost.n} hidden`],
  ['No webhook answered with an error', failures === 0, `${failures} failed`],
];

console.log('\nCorrectness');
for (const [name, ok, detail] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
console.log('\nWebhook throughput (steady)');
console.log(`  ${events.length} events in ${elapsed.toFixed(1)} s = ${(events.length / elapsed).toFixed(0)} events/s`);
console.log(`  latency p50 ${ms(pct(latencies.slice(0, burstLat), 50))}, p95 ${ms(pct(latencies.slice(0, burstLat), 95))}, p99 ${ms(pct(latencies.slice(0, burstLat), 99))}`);
if (BURST) {
  console.log(`Burst: ${BURST} new DMs, ${BURST_CONCURRENCY} connections at once`);
  console.log(`  sent in ${burstSecs.toFixed(1)} s; latency p50 ${ms(pct(burstLatencies, 50))}, p95 ${ms(pct(burstLatencies, 95))}, max ${ms(Math.max(...burstLatencies))}`);
  console.log(`  connections refused by the OS: ${burstRefused}${burstRefused ? ` (re-delivered like Meta does: ${retry.length} retried)` : ''}`);
}
console.log(`\nDashboard reads with ${convs.n} conversations / ${stored.inbound + stored.outbound} messages (median of 20)`);
console.log(`  inbox list ${ms(inboxMs)}, search ${ms(searchMs)}, stats ${ms(statsMs)}, open a chat ${ms(chatMs)}`);
console.log(`\nFor scale: 500 DMs/day is about 1 every 3 minutes on average; peaks are much higher.`);

server.close();
await db.close();
process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
