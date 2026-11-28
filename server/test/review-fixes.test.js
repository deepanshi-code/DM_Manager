// Regression tests for defects found in the pre-submission code review.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { initDb, getDb } from '../src/db.js';
import { config } from '../src/config.js';
import { setSender } from '../src/senders/index.js';
import {
  ingestInbound,
  ingestEcho,
  sendReply,
  getConversation,
  getStats,
  csvCell,
  exportLabelsCsv,
} from '../src/services/conversations.js';
import { conversationDetails, exportReportCsv } from '../src/services/workspace.js';
import { createAgent, login, resetLoginThrottle } from '../src/auth.js';

const uid = () => `rv_${crypto.randomUUID().slice(0, 8)}`;
const mid = () => `m_${crypto.randomUUID()}`;
const okSender = { send: async () => ({ mid: mid() }) };

before(async () => {
  await initDb({ dataDir: 'memory://' });
  setSender(okSender);
  config.auth = false;
});

test('a late (retried) customer message that was already answered does not reopen the chat or restart the timer', async () => {
  const igUserId = uid();
  const t0 = Date.now() - 60 * 60_000;
  // B arrives first (A's webhook failed and will be retried later)
  const b = await ingestInbound({ igUserId, mid: mid(), text: 'is size M available?', timestamp: t0 + 60_000 });
  await sendReply(b.conversationId, 'Yes, M is in stock', 'Asha'); // answered at "now"
  // Meta retries A, which was sent before our reply
  const late = await ingestInbound({ igUserId, mid: mid(), text: 'hi', timestamp: t0 });
  assert.equal(late.late, true);
  const conv = await getConversation(b.conversationId);
  assert.equal(conv.needs_reply_since, null);
  assert.equal(conv.status, 'WAITING_ON_CUSTOMER');
  assert.equal(new Date(conv.first_inbound_at).getTime(), t0); // first contact moves back to A
  assert.equal(conv.messages.filter((m) => m.direction === 'INBOUND').length, 2); // A is still stored
});

test('an older unanswered message arriving late moves the reply timer back', async () => {
  const igUserId = uid();
  const t0 = Date.now() - 30 * 60_000;
  const later = await ingestInbound({ igUserId, mid: mid(), text: 'hello??', timestamp: t0 + 10 * 60_000 });
  await ingestInbound({ igUserId, mid: mid(), text: 'price of the kurta?', timestamp: t0 });
  const conv = await getConversation(later.conversationId);
  assert.equal(new Date(conv.needs_reply_since).getTime(), t0);
});

test('a business-started chat does not set first_response_at (no negative first-reply times)', async () => {
  const igUserId = uid();
  const echo = await ingestEcho({ igUserId, mid: mid(), text: 'Thanks for following!', timestamp: Date.now() - 10 * 60_000 });
  let conv = await getConversation(echo.conversationId);
  assert.equal(conv.first_response_at, null);
  await ingestInbound({ igUserId, mid: mid(), text: 'price?', timestamp: Date.now() - 5 * 60_000 });
  await sendReply(echo.conversationId, 'It is 499', 'Rohan');
  conv = await getConversation(echo.conversationId);
  assert.ok(new Date(conv.first_response_at) >= new Date(conv.first_inbound_at));
  const report = await exportReportCsv();
  const row = report.split('\n').find((l) => l.startsWith(`${echo.conversationId},`));
  const firstReplySeconds = Number(row.split(',')[8]);
  assert.ok(firstReplySeconds >= 0, `first_reply_seconds was ${firstReplySeconds}`);
  assert.ok((await getStats()).medianFirstResponseSeconds >= 0);
});

test('when the echo of a dashboard reply is stored first, the activity log still credits the agent', async () => {
  const igUserId = uid();
  const { conversationId } = await ingestInbound({ igUserId, mid: mid(), text: 'COD?', timestamp: Date.now() - 60_000 });
  const sentMid = mid();
  setSender({ send: async ({ recipientId, text }) => { await ingestEcho({ igUserId: recipientId, mid: sentMid, text }); return { mid: sentMid }; } });
  try {
    await sendReply(conversationId, 'Yes, COD is available', 'Meera');
  } finally {
    setSender(okSender);
  }
  const activity = (await conversationDetails(conversationId)).activity;
  assert.ok(activity.some((e) => e.reason === 'reply_sent' && e.actor === 'Meera'));
  assert.ok(!activity.some((e) => e.reason === 'reply_in_instagram_app'));
});

test('CSV exports neutralise spreadsheet formulas in customer text', async () => {
  assert.equal(csvCell('=HYPERLINK("https://evil.example","x")'), `"'=HYPERLINK(""https://evil.example"",""x"")"`);
  assert.equal(csvCell('+91 call me'), "'+91 call me");
  assert.equal(csvCell('-5 off?'), "'-5 off?");
  assert.equal(csvCell('@riya'), "'@riya");
  assert.equal(csvCell('price?'), 'price?');
  assert.equal(csvCell(-5), '-5'); // numbers are not customer text
  await ingestInbound({ igUserId: uid(), mid: mid(), text: '=1+1' });
  const csv = await exportLabelsCsv();
  assert.ok(csv.includes(",'=1+1,"));
  assert.ok(!csv.includes(',=1+1,'));
});

test('parallel password guesses are throttled (attempts are reserved before checking the password)', async () => {
  resetLoginThrottle();
  await createAgent('Kiran', 'kiran-password-1');
  const tries = await Promise.allSettled(
    Array.from({ length: 30 }, (_, i) => login('Kiran', `guess-guess-${i}`, '10.0.0.9')),
  );
  const throttled = tries.filter((t) => t.status === 'rejected' && t.reason.status === 429).length;
  const wrong = tries.filter((t) => t.status === 'rejected' && t.reason.status === 401).length;
  assert.equal(wrong, 5); // only the first 5 were actually checked
  assert.equal(throttled, 25);
  resetLoginThrottle();
});

test('a successful login is not throttled and clears its own failures', async () => {
  resetLoginThrottle();
  await assert.rejects(login('Kiran', 'wrong-password-1', '10.0.0.8'), (e) => e.status === 401);
  const ok = await login('Kiran', 'kiran-password-1', '10.0.0.8');
  assert.equal(ok.agent, 'Kiran');
  resetLoginThrottle();
});

test('huge or random login names do not create unbounded throttle keys', async () => {
  resetLoginThrottle();
  const ip = '10.0.0.7';
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(login('x'.repeat(50_000) + i, 'whatever-1234', ip), (e) => e.status === 401);
  }
  // All invalid names share one key per address, so the 6th invalid attempt is throttled by name.
  await assert.rejects(login('y'.repeat(60_000), 'whatever-1234', ip), (e) => e.status === 401);
  await assert.rejects(login('z'.repeat(70_000), 'whatever-1234', ip), (e) => e.status === 401);
  await assert.rejects(login('w'.repeat(80_000), 'whatever-1234', ip), (e) => e.status === 429);
  resetLoginThrottle();
});

test('the demo-refresh marker table exists', async () => {
  const r = await getDb().query(`SELECT count(*)::int AS n FROM app_meta`);
  assert.ok(r.rows[0].n >= 0);
});
