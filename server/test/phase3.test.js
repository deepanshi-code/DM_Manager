// Phase 3: saved replies, suggested by message type, with usage tracked for evaluation.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { initDb } from '../src/db.js';
import { setSender } from '../src/senders/index.js';
import {
  ingestInbound,
  sendReply,
  getConversation,
  getStats,
  correctIntent,
} from '../src/services/conversations.js';
import {
  DEFAULT_SAVED_REPLIES,
  seedSavedReplies,
  listSavedReplies,
  createSavedReply,
  updateSavedReply,
  deleteSavedReply,
  renderSavedReply,
} from '../src/services/savedReplies.js';

const uid = () => `p3_${crypto.randomUUID().slice(0, 8)}`;
const mid = () => `m_${crypto.randomUUID()}`;

before(async () => {
  await initDb({ dataDir: 'memory://' });
  setSender({ send: async () => ({ mid: mid() }) });
});

test('the starter set is added once', async () => {
  assert.equal(await seedSavedReplies(), DEFAULT_SAVED_REPLIES.length);
  assert.equal(await seedSavedReplies(), 0);
  assert.equal((await listSavedReplies()).length, DEFAULT_SAVED_REPLIES.length);
});

test('{name} becomes the customer\'s handle; [brackets] are left for the agent', () => {
  assert.equal(renderSavedReply('Hi {name}! It is ₹[price].', 'riya_78'), 'Hi @riya_78! It is ₹[price].');
  assert.equal(renderSavedReply('Hi {name}!', null), 'Hi there!');
});

test('suggestions match the conversation\'s message type first', async () => {
  const { conversationId } = await ingestInbound({ igUserId: uid(), username: 'kabir', mid: mid(), text: 'COD available?' });
  const conv = await getConversation(conversationId);
  assert.equal(conv.intent, 'cod_shipping');
  assert.ok(conv.suggestedReplies.length >= 1 && conv.suggestedReplies.length <= 3);
  assert.equal(conv.suggestedReplies[0].intent, 'cod_shipping');
  assert.match(conv.suggestedReplies[0].text, /^Hi @kabir!/);
  // General replies fill the remaining slots; other types never appear.
  assert.ok(conv.suggestedReplies.every((r) => r.intent === 'cod_shipping' || r.intent === null));

  // Correcting the type changes the suggestions.
  const inbound = conv.messages.find((m) => m.direction === 'INBOUND');
  await correctIntent(inbound.id, 'complaint', 'Asha');
  const after = await getConversation(conversationId);
  assert.equal(after.suggestedReplies[0].intent, 'complaint');
});

test('sending a saved reply records it, counts its use, and notices edits', async () => {
  const replies = await listSavedReplies();
  const price = replies.find((r) => r.intent === 'price');

  const a = await ingestInbound({ igUserId: uid(), username: 'neha', mid: mid(), text: 'price?' });
  await sendReply(a.conversationId, renderSavedReply(price.body, 'neha'), 'Asha', { savedReplyId: price.id });
  const b = await ingestInbound({ igUserId: uid(), username: 'tanya', mid: mid(), text: 'price plz' });
  await sendReply(b.conversationId, 'Hi @tanya! This one is ₹799.', 'Asha', { savedReplyId: price.id });
  const c = await ingestInbound({ igUserId: uid(), username: 'arjun', mid: mid(), text: 'hello' });
  await sendReply(c.conversationId, 'Hi! How can I help?', 'Asha'); // typed by hand

  const outA = (await getConversation(a.conversationId)).messages.find((m) => m.direction === 'OUTBOUND');
  assert.equal(outA.saved_reply_id, price.id);
  assert.equal(outA.saved_reply_edited, false);
  const usage = (await listSavedReplies()).find((r) => r.id === price.id).use_count;
  assert.equal(usage, 2);

  const stats = await getStats();
  assert.equal(stats.templates.repliesWithTemplate, 2);
  assert.equal(stats.templates.editedPct, 50); // one sent as-is, one with the price filled in
  assert.ok(stats.templates.medianResponseWithTemplate != null);
  assert.ok(stats.templates.medianResponseWithout != null);
  // Team view: all three replies were sent by Asha in the last 24 hours.
  const asha = stats.team.find((t) => t.agent === 'Asha');
  assert.equal(asha.replies, 3);
  assert.equal(stats.inboundByHour.length, 12);
  assert.ok(stats.inboundByHour[11] >= 3); // this hour's customer messages

  await assert.rejects(
    sendReply(c.conversationId, 'x', 'Asha', { savedReplyId: 999999 }),
    (err) => err.status === 400,
  );
});

test('saved replies can be added, edited and deleted, with validation', async () => {
  const r = await createSavedReply({ title: 'Bulk order', body: 'Hi {name}! For 10+ pieces we offer [discount].', intent: 'price' }, 'Meera');
  assert.equal(r.use_count, 0);
  const edited = await updateSavedReply(r.id, { title: 'Bulk orders', body: r.body, intent: '' });
  assert.equal(edited.intent, null);
  await deleteSavedReply(r.id);
  assert.ok(!(await listSavedReplies()).some((x) => x.id === r.id));
  await assert.rejects(deleteSavedReply(r.id), (err) => err.status === 404);

  await assert.rejects(createSavedReply({ title: '', body: 'x' }), (err) => err.status === 400);
  await assert.rejects(createSavedReply({ title: 'x', body: 'y', intent: 'weather' }), (err) => err.status === 400);
  await assert.rejects(createSavedReply({ title: 'x', body: 'y'.repeat(1001) }), (err) => err.status === 400);
});
