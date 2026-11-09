// End-to-end behaviour against a real (in-memory) PostgreSQL via PGlite.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { initDb } from '../src/db.js';
import { setSender } from '../src/senders/index.js';
import {
  ingestInbound,
  sendReply,
  updateStatus,
  markRead,
  getConversation,
  listConversations,
  getStats,
} from '../src/services/conversations.js';
import { markOverdue } from '../src/scheduler.js';
import { parseInstagramWebhook, verifySignature } from '../src/routes/webhook.js';

let counter = 0;
const uid = () => `u${++counter}_${crypto.randomUUID().slice(0, 6)}`;
const mid = () => `m_${crypto.randomUUID()}`;
const okSender = { send: async () => ({ mid: mid() }) };

before(async () => {
  await initDb({ dataDir: 'memory://' });
  setSender(okSender);
});

test('webhook retries do not create duplicate messages', async () => {
  const msg = { igUserId: uid(), username: 'riya', mid: mid(), text: 'price?' };
  const first = await ingestInbound(msg);
  const second = await ingestInbound(msg);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  const conv = await getConversation(first.conversationId);
  assert.equal(conv.messages.length, 1);
  assert.equal(conv.status, 'NEW');
  assert.ok(conv.needs_reply_since);
});

test('two messages from the same customer share one conversation and keep the oldest wait time', async () => {
  const igUserId = uid();
  const t0 = Date.now() - 60_000;
  const a = await ingestInbound({ igUserId, mid: mid(), text: 'hi', timestamp: t0 });
  const b = await ingestInbound({ igUserId, mid: mid(), text: 'hello??', timestamp: t0 + 30_000 });
  assert.equal(a.conversationId, b.conversationId);
  const conv = await getConversation(a.conversationId);
  assert.equal(new Date(conv.needs_reply_since).getTime(), t0);
  assert.equal(conv.unread_count, 2);
});

test('opening, replying and a follow-up move through the lifecycle', async () => {
  const igUserId = uid();
  const { conversationId } = await ingestInbound({ igUserId, mid: mid(), text: 'COD available?' });

  assert.equal((await markRead(conversationId, 'Asha')).status, 'OPEN');

  const reply = await sendReply(conversationId, 'Yes, COD is available!', 'Asha');
  assert.equal(reply.status, 'WAITING_ON_CUSTOMER');
  assert.ok(reply.responseSeconds >= 0);
  let conv = await getConversation(conversationId);
  assert.equal(conv.needs_reply_since, null);
  assert.equal(conv.assignee, 'Asha');
  assert.ok(conv.first_response_at);

  await ingestInbound({ igUserId, mid: mid(), text: 'ok thanks, size M?' });
  conv = await getConversation(conversationId);
  assert.equal(conv.status, 'OPEN');
  assert.ok(conv.needs_reply_since);

  await updateStatus(conversationId, 'RESOLVED', 'Asha');
  conv = await getConversation(conversationId);
  assert.equal(conv.status, 'RESOLVED');
  assert.equal(conv.needs_reply_since, null);

  await ingestInbound({ igUserId, mid: mid(), text: 'one more question' });
  assert.equal((await getConversation(conversationId)).status, 'OPEN');
});

test('invalid manual transitions are rejected', async () => {
  const { conversationId } = await ingestInbound({ igUserId: uid(), mid: mid(), text: 'hi' });
  await assert.rejects(updateStatus(conversationId, 'WAITING_ON_CUSTOMER'), { status: 409 });
  await assert.rejects(updateStatus(conversationId, 'BANANA'), { status: 400 });
});

test('the scheduler flags unanswered chats once the SLA passes, and a reply clears it', async () => {
  const twoHoursAgo = Date.now() - 2 * 3600_000;
  const { conversationId } = await ingestInbound({
    igUserId: uid(), mid: mid(), text: 'where is my order??', timestamp: twoHoursAgo,
  });
  const flagged = await markOverdue(new Date(), 3600);
  assert.ok(flagged.includes(conversationId));
  assert.ok(!(await markOverdue(new Date(), 3600)).includes(conversationId), 'flag only once');

  const overdue = await listConversations({ filter: 'OVERDUE' });
  assert.ok(overdue.some((c) => c.id === conversationId));

  await sendReply(conversationId, 'Shipped today, here is the tracking link', 'Rohan');
  const conv = await getConversation(conversationId);
  assert.equal(conv.is_overdue, false);
});

test('replies are blocked once the 24h messaging window has closed', async () => {
  const { conversationId } = await ingestInbound({
    igUserId: uid(), mid: mid(), text: 'old message', timestamp: Date.now() - 25 * 3600_000,
  });
  await assert.rejects(sendReply(conversationId, 'sorry for the delay'), { status: 409 });
});

test('a failed delivery is recorded and the chat still needs a reply', async () => {
  const { conversationId } = await ingestInbound({ igUserId: uid(), mid: mid(), text: 'price?' });
  setSender({ send: async () => { throw new Error('network down'); } });
  try {
    await assert.rejects(sendReply(conversationId, '₹799'), { status: 502 });
  } finally {
    setSender(okSender);
  }
  const conv = await getConversation(conversationId);
  assert.ok(conv.needs_reply_since, 'still needs reply');
  assert.equal(conv.messages.at(-1).delivery_status, 'FAILED');
});

test('needs-reply inbox lists the longest-waiting customer first', async () => {
  const older = await ingestInbound({ igUserId: uid(), mid: mid(), text: 'a', timestamp: Date.now() - 50_000 });
  const newer = await ingestInbound({ igUserId: uid(), mid: mid(), text: 'b', timestamp: Date.now() - 10_000 });
  const ids = (await listConversations({ filter: 'NEEDS_REPLY' })).map((c) => c.id);
  assert.ok(ids.indexOf(older.conversationId) < ids.indexOf(newer.conversationId));
});

test('stats report response times', async () => {
  const stats = await getStats();
  assert.ok(stats.replies >= 2);
  assert.equal(typeof stats.medianResponseSeconds, 'number');
  assert.ok(stats.counts.NEEDS_REPLY >= 1);
});

test('webhook parser ignores echoes and keeps attachments', () => {
  const events = parseInstagramWebhook({
    object: 'instagram',
    entry: [{
      messaging: [
        { sender: { id: '1' }, timestamp: 1, message: { mid: 'a', text: 'hi' } },
        { sender: { id: '2' }, timestamp: 2, message: { mid: 'b', text: 'ours', is_echo: true } },
        { sender: { id: '3' }, timestamp: 3, message: { mid: 'c', attachments: [{ type: 'image' }] } },
        { sender: { id: '4' }, timestamp: 4, read: { mid: 'x' } },
      ],
    }],
  });
  assert.deepEqual(events.map((e) => e.text), ['hi', '[attachment]']);
  assert.deepEqual(parseInstagramWebhook({ object: 'page' }), []);
});

test('webhook signature check', () => {
  const body = Buffer.from('{"object":"instagram"}');
  const sig = 'sha256=' + crypto.createHmac('sha256', 's3cret').update(body).digest('hex');
  assert.ok(verifySignature(body, sig, 's3cret'));
  assert.ok(!verifySignature(body, sig, 'wrong'));
  assert.ok(!verifySignature(body, undefined, 's3cret'));
  assert.ok(!verifySignature(body, 'sha256=abc', 's3cret'));
});
