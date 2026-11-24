// Team workspace: notes, follow-up reminders, customer details, presence, bulk actions, report.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { initDb, getDb } from '../src/db.js';
import { config } from '../src/config.js';
import { setSender } from '../src/senders/index.js';
import {
  ingestInbound,
  sendReply,
  updateStatus,
  getConversation,
  listConversations,
  getStats,
  assignConversation,
} from '../src/services/conversations.js';
import {
  addNote,
  deleteNote,
  setReminder,
  conversationDetails,
  extractOrderNumbers,
  markViewing,
  viewersOf,
  bulkAction,
  exportReportCsv,
} from '../src/services/workspace.js';

const uid = () => `ws_${crypto.randomUUID().slice(0, 8)}`;
const mid = () => `m_${crypto.randomUUID()}`;
const newChat = (text = 'price?', extra = {}) => ingestInbound({ igUserId: uid(), username: uid(), mid: mid(), text, ...extra });

before(async () => {
  await initDb({ dataDir: 'memory://' });
  setSender({ send: async () => ({ mid: mid() }) });
  config.auth = false;
});

test('notes are private to the team and listed newest first', async () => {
  const { conversationId } = await newChat();
  await addNote(conversationId, 'Refund approved by owner', 'Asha');
  await addNote(conversationId, 'Courier pickup booked for Monday', 'Rohan');
  const d = await conversationDetails(conversationId);
  assert.deepEqual(d.notes.map((n) => n.author), ['Rohan', 'Asha']);
  // Notes are never customer messages.
  const conv = await getConversation(conversationId);
  assert.ok(conv.messages.every((m) => !/Refund approved/.test(m.body)));

  await assert.rejects(addNote(conversationId, '   ', 'Asha'), (e) => e.status === 400);
  await assert.rejects(addNote(999999, 'x', 'Asha'), (e) => e.status === 404);
  await deleteNote(d.notes[0].id, 'Rohan');
  assert.equal((await conversationDetails(conversationId)).notes.length, 1);
});

test('with login on, only the author can delete a note', async () => {
  const { conversationId } = await newChat();
  const note = await addNote(conversationId, 'Mine', 'Asha');
  config.auth = true;
  try {
    await assert.rejects(deleteNote(note.id, 'Rohan'), (e) => e.status === 403);
    await deleteNote(note.id, 'Asha');
  } finally {
    config.auth = false;
  }
});

test('a due reminder brings the chat back in "Follow-ups"; replying or a new message clears it', async () => {
  const { conversationId } = await newChat('COD available?');
  await sendReply(conversationId, 'Yes! Shall I book it?', 'Asha'); // now waiting on the customer
  const now = Date.now();
  await setReminder(conversationId, new Date(now + 60_000).toISOString(), 'Asha', now);
  // Not due yet.
  assert.ok(!(await listConversations({ filter: 'FOLLOW_UP' })).some((c) => c.id === conversationId));
  // Make it due (as if time passed).
  await getDb().query(`UPDATE conversations SET remind_at = now() - interval '1 second' WHERE id = $1`, [conversationId]);
  assert.ok((await listConversations({ filter: 'FOLLOW_UP' })).some((c) => c.id === conversationId));
  assert.ok((await getStats()).counts.FOLLOW_UP >= 1);

  // The customer writes back: no need to chase them any more.
  const conv = await getConversation(conversationId);
  await ingestInbound({ igUserId: conv.ig_user_id, mid: mid(), text: 'yes please' });
  assert.equal((await getConversation(conversationId)).remind_at, null);

  // Activity shows who set it.
  const activity = (await conversationDetails(conversationId)).activity;
  assert.ok(activity.some((e) => e.reason === 'reminder_set' && e.actor === 'Asha'));
});

test('reminders must be in the future, within 30 days, and not on resolved chats', async () => {
  const { conversationId } = await newChat();
  const now = Date.now();
  await assert.rejects(setReminder(conversationId, new Date(now - 1000).toISOString(), 'A', now), (e) => e.status === 400);
  await assert.rejects(setReminder(conversationId, new Date(now + 31 * 86400_000).toISOString(), 'A', now), (e) => e.status === 400);
  await assert.rejects(setReminder(conversationId, 'not a date', 'A', now), (e) => e.status === 400);
  await updateStatus(conversationId, 'RESOLVED', 'A');
  await assert.rejects(setReminder(conversationId, new Date(now + 3600_000).toISOString(), 'A', now), (e) => e.status === 409);
  // Clearing always works.
  assert.deepEqual(await setReminder(conversationId, null, 'A', now), { remindAt: null });
});

test('resolving clears a pending reminder', async () => {
  const { conversationId } = await newChat();
  const now = Date.now();
  await setReminder(conversationId, new Date(now + 3600_000).toISOString(), 'Asha', now);
  await updateStatus(conversationId, 'RESOLVED', 'Asha');
  assert.equal((await getConversation(conversationId)).remind_at, null);
});

test('order numbers are picked out of customer messages', () => {
  assert.deepEqual(
    extractOrderNumbers(['Where is my order 86721?', 'order no. 12345 and #55501', 'call me at 9876543210', 'Order #86721 again']),
    ['86721', '12345', '55501'],
  );
});

test('customer details count messages and find order numbers', async () => {
  const { conversationId } = await newChat('Order #40112 still not shipped');
  await sendReply(conversationId, 'Checking now', 'Meera');
  const d = await conversationDetails(conversationId);
  assert.equal(d.messagesReceived, 1);
  assert.equal(d.repliesSent, 1);
  assert.deepEqual(d.orderNumbers, ['40112']);
  assert.ok(d.firstSeen);
});

test('"also viewing" shows agents who opened the chat in the last 15 seconds', () => {
  const now = Date.now();
  markViewing(7, 'Asha', now);
  markViewing(7, 'Rohan', now - 20_000); // stale
  assert.deepEqual(viewersOf(7, now), ['Asha']);
  assert.deepEqual(viewersOf(7, now + 16_000), []);
});

test('"Mine" lists my open chats', async () => {
  const a = await newChat();
  const b = await newChat();
  await assignConversation(a.conversationId, 'Meera');
  await assignConversation(b.conversationId, 'Meera');
  await updateStatus(b.conversationId, 'RESOLVED', 'Meera');
  const mine = await listConversations({ filter: 'MINE', agent: 'Meera' });
  assert.ok(mine.some((c) => c.id === a.conversationId));
  assert.ok(!mine.some((c) => c.id === b.conversationId));
  assert.ok((await getStats({ agent: 'Meera' })).counts.MINE >= 1);
});

test('bulk actions: resolve, assign, and spam (which also labels the messages)', async () => {
  const spamA = await newChat('Earn 5000 daily from home, DM me');
  const spamB = await newChat('follow for follow?');
  const r = await bulkAction({ ids: [spamA.conversationId, spamB.conversationId], action: 'spam' }, 'Asha', config.agents);
  assert.equal(r.done, 2);
  const conv = await getConversation(spamA.conversationId);
  assert.equal(conv.status, 'RESOLVED');
  assert.ok(conv.messages.filter((m) => m.direction === 'INBOUND').every((m) => m.intent_corrected === 'spam'));

  const x = await newChat();
  const assigned = await bulkAction({ ids: [x.conversationId, 999999], action: 'assign', assignee: 'Rohan' }, 'Asha', config.agents);
  assert.equal(assigned.done, 1); // one bad id doesn't stop the rest
  assert.equal(assigned.failed, 1);
  assert.equal((await getConversation(x.conversationId)).assignee, 'Rohan');

  await assert.rejects(bulkAction({ ids: [], action: 'resolve' }, 'A', []), (e) => e.status === 400);
  await assert.rejects(bulkAction({ ids: [1], action: 'delete' }, 'A', []), (e) => e.status === 400);
});

test('report CSV has one row per conversation and no message text', async () => {
  const { conversationId } = await newChat('My secret address is 12 MG Road');
  await sendReply(conversationId, 'Thanks!', 'Asha');
  const csv = await exportReportCsv();
  const [header, ...rows] = csv.trim().split('\n');
  assert.match(header, /^id,username,status,intent,priority,assignee,first_message_at,first_reply_at,first_reply_seconds/);
  assert.ok(rows.some((r) => r.startsWith(`${conversationId},`)));
  assert.ok(!csv.includes('MG Road'));
});
