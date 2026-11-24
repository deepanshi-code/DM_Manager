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

test('webhook parser keeps attachments and maps echoes to the customer', () => {
  const events = parseInstagramWebhook({
    object: 'instagram',
    entry: [{
      messaging: [
        { sender: { id: '1' }, recipient: { id: 'biz' }, timestamp: 1, message: { mid: 'a', text: 'hi' } },
        { sender: { id: 'biz' }, recipient: { id: '2' }, timestamp: 2, message: { mid: 'b', text: 'ours', is_echo: true } },
        { sender: { id: '3' }, recipient: { id: 'biz' }, timestamp: 3, message: { mid: 'c', attachments: [{ type: 'image' }] } },
        { sender: { id: '4' }, timestamp: 4, read: { mid: 'x' } },
        { sender: { id: '5' }, timestamp: 5, message: { mid: 'd', text: 'gone', is_deleted: true } },
      ],
    }],
  });
  assert.deepEqual(
    events.map((e) => [e.kind, e.igUserId, e.text]),
    [['inbound', '1', 'hi'], ['echo', '2', 'ours'], ['inbound', '3', '[attachment]']],
  );
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

// ---------- Phase 2: intents, priority, corrections ----------
import { correctIntent, exportLabelsCsv, backfillIntents } from '../src/services/conversations.js';
import { getDb } from '../src/db.js';

test('incoming messages are labelled and a complaint makes the chat urgent', async () => {
  const { conversationId, intent } = await ingestInbound({
    igUserId: uid(), mid: mid(), text: 'received a damaged kurta, very disappointed',
  });
  assert.equal(intent, 'complaint');
  const conv = await getConversation(conversationId);
  assert.equal(conv.intent, 'complaint');
  assert.equal(conv.priority, 'URGENT');
  assert.equal(conv.messages[0].intent, 'complaint');
  assert.ok(['model', 'rules'].includes(conv.messages[0].intent_source));
});

test('a nudge keeps the topic, marks the customer as chasing, and a reply clears it', async () => {
  const igUserId = uid();
  const { conversationId } = await ingestInbound({ igUserId, mid: mid(), text: 'price?', timestamp: Date.now() - 5000 });
  let conv = await getConversation(conversationId);
  assert.equal(conv.intent, 'price');
  assert.equal(conv.priority, 'NORMAL');

  await ingestInbound({ igUserId, mid: mid(), text: 'hello??' });
  conv = await getConversation(conversationId);
  assert.equal(conv.intent, 'price', 'follow-up does not replace the topic');
  assert.equal(conv.customer_chasing, true);
  assert.equal(conv.priority, 'URGENT');

  await sendReply(conversationId, '₹899', 'Asha');
  conv = await getConversation(conversationId);
  assert.equal(conv.customer_chasing, false);
  assert.equal(conv.priority, 'NORMAL');
});

test('urgent chats are listed before normal ones that waited longer (when neither is overdue)', async () => {
  const normal = await ingestInbound({ igUserId: uid(), mid: mid(), text: 'cod available?', timestamp: Date.now() - 20_000 });
  const urgent = await ingestInbound({ igUserId: uid(), mid: mid(), text: 'wrong size sent, worst experience' });
  const ids = (await listConversations({ filter: 'NEEDS_REPLY' })).map((c) => c.id);
  assert.ok(ids.indexOf(urgent.conversationId) < ids.indexOf(normal.conversationId));
});

test('likely spam does not jump the queue even when overdue, but is still flagged', async () => {
  const spam = await ingestInbound({
    igUserId: uid(), mid: mid(), text: 'get 10k followers click link', timestamp: Date.now() - 3 * 3600_000,
  });
  const fresh = await ingestInbound({ igUserId: uid(), mid: mid(), text: 'size chart pls' });
  await markOverdue(new Date(), 3600);
  const spamConv = await getConversation(spam.conversationId);
  assert.equal(spamConv.priority, 'LOW');
  assert.equal(spamConv.is_overdue, true);
  const ids = (await listConversations({ filter: 'NEEDS_REPLY' })).map((c) => c.id);
  assert.ok(ids.indexOf(fresh.conversationId) < ids.indexOf(spam.conversationId));
  assert.ok((await listConversations({ filter: 'OVERDUE' })).some((c) => c.id === spam.conversationId));
});

test('an agent correction overrides the prediction without erasing it', async () => {
  const { conversationId, messageId } = await ingestInbound({ igUserId: uid(), mid: mid(), text: 'asdfgh qwerty' });
  const result = await correctIntent(messageId, 'complaint', 'Meera');
  assert.equal(result.conversation.priority, 'URGENT');
  const msg = (await getConversation(conversationId)).messages[0];
  assert.equal(msg.intent_corrected, 'complaint');
  assert.ok(msg.intent, 'original prediction kept');
  await assert.rejects(correctIntent(messageId, 'banana'), { status: 400 });

  const csv = await exportLabelsCsv({ correctedOnly: true });
  assert.match(csv, /^id,text,intent,predicted/);
  assert.match(csv, /asdfgh qwerty,complaint,/);
});

test('intent filter and backfill of unlabelled messages', async () => {
  const { conversationId, messageId } = await ingestInbound({ igUserId: uid(), mid: mid(), text: 'COD available?' });
  await getDb().query(`UPDATE messages SET intent = NULL WHERE id = $1`, [messageId]);
  const result = await backfillIntents();
  assert.ok(result.messages >= 1);
  const listed = await listConversations({ filter: 'ALL', intent: 'cod_shipping' });
  assert.ok(listed.some((c) => c.id === conversationId));
  await assert.rejects(listConversations({ intent: 'banana' }), { status: 400 });
});

test('URGENT filter lists only urgent chats that still need a reply', async () => {
  const urgent = await ingestInbound({ igUserId: uid(), mid: mid(), text: 'received damaged, worst quality' });
  const normal = await ingestInbound({ igUserId: uid(), mid: mid(), text: 'cod available?' });
  const ids = (await listConversations({ filter: 'URGENT' })).map((c) => c.id);
  assert.ok(ids.includes(urgent.conversationId));
  assert.ok(!ids.includes(normal.conversationId));
  await updateStatus(urgent.conversationId, 'RESOLVED');
  assert.ok(!(await listConversations({ filter: 'URGENT' })).some((c) => c.id === urgent.conversationId));
});

test('reopening a resolved chat (Undo) brings back its reply timer and overdue flag', async () => {
  const igUserId = uid();
  const twoHoursAgo = Date.now() - 2 * 3600_000;
  const { conversationId } = await ingestInbound({ igUserId, mid: mid(), text: 'price?', timestamp: twoHoursAgo });
  await ingestInbound({ igUserId, mid: mid(), text: 'hello??', timestamp: twoHoursAgo + 60_000 });
  await markOverdue(new Date(), 3600);
  await updateStatus(conversationId, 'RESOLVED');
  let conv = await getConversation(conversationId);
  assert.equal(conv.needs_reply_since, null);

  await updateStatus(conversationId, 'OPEN');
  conv = await getConversation(conversationId);
  assert.equal(new Date(conv.needs_reply_since).getTime(), twoHoursAgo, 'oldest unanswered message again');
  assert.equal(conv.is_overdue, true);
  assert.equal(conv.customer_chasing, true);

  // After a real reply, reopening finds nothing unanswered.
  await sendReply(conversationId, 'It is ₹799', 'Asha');
  await updateStatus(conversationId, 'RESOLVED');
  await updateStatus(conversationId, 'OPEN');
  conv = await getConversation(conversationId);
  assert.equal(conv.needs_reply_since, null);
  assert.equal(conv.is_overdue, false);
});
