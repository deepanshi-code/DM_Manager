// Team workspace features around a conversation: private notes, follow-up reminders,
// customer details, activity timeline, "also viewing" presence, bulk actions, CSV report.
import { getDb } from '../db.js';
import { config } from '../config.js';
import { HttpError, updateStatus, assignConversation, correctIntent } from './conversations.js';

const MAX_NOTE = 2000;
const MAX_REMINDER_DAYS = 30;

// ---------- Notes ----------

export async function addNote(conversationId, body, author) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text || text.length > MAX_NOTE) throw new HttpError(400, `Note text is required (max ${MAX_NOTE} characters)`);
  const db = getDb();
  const exists = (await db.query(`SELECT 1 FROM conversations WHERE id = $1`, [conversationId])).rows[0];
  if (!exists) throw new HttpError(404, 'Conversation not found');
  return (
    await db.query(
      `INSERT INTO conversation_notes (conversation_id, author, body) VALUES ($1, $2, $3)
       RETURNING id, author, body, created_at`,
      [conversationId, author ?? null, text],
    )
  ).rows[0];
}

export async function deleteNote(noteId, agent) {
  const db = getDb();
  const note = (await db.query(`SELECT author FROM conversation_notes WHERE id = $1`, [noteId])).rows[0];
  if (!note) throw new HttpError(404, 'Note not found');
  // With login on, only the author can delete their note.
  if (config.auth && note.author !== agent) throw new HttpError(403, 'Only the author can delete this note');
  await db.query(`DELETE FROM conversation_notes WHERE id = $1`, [noteId]);
  return { id: noteId };
}

// ---------- Follow-up reminders ----------

/** Set (or clear, with `remindAt = null`) a reminder to follow up with the customer. */
export async function setReminder(conversationId, remindAt, agent, now = Date.now()) {
  let at = null;
  if (remindAt != null) {
    at = new Date(remindAt);
    if (Number.isNaN(at.getTime())) throw new HttpError(400, 'Invalid reminder time');
    if (at.getTime() <= now) throw new HttpError(400, 'Reminder time must be in the future');
    if (at.getTime() > now + MAX_REMINDER_DAYS * 86400_000) {
      throw new HttpError(400, `Reminders can be at most ${MAX_REMINDER_DAYS} days ahead`);
    }
  }
  return getDb().tx(async (q) => {
    const conv = (await q.query(`SELECT id, status FROM conversations WHERE id = $1 FOR UPDATE`, [conversationId])).rows[0];
    if (!conv) throw new HttpError(404, 'Conversation not found');
    if (at && conv.status === 'RESOLVED') throw new HttpError(409, 'Reopen the conversation before setting a reminder');
    await q.query(
      `UPDATE conversations SET remind_at = $2, remind_set_by = $3, updated_at = now() WHERE id = $1`,
      [conversationId, at?.toISOString() ?? null, at ? agent ?? null : null],
    );
    // Logged directly (logStatus skips "no status change") so it appears in the activity timeline.
    await q.query(
      `INSERT INTO status_events (conversation_id, from_status, to_status, actor, reason) VALUES ($1, $2, $2, $3, $4)`,
      [conversationId, conv.status, agent ?? 'agent', at ? 'reminder_set' : 'reminder_cleared'],
    );
    return { remindAt: at?.toISOString() ?? null };
  });
}

// ---------- Customer details + activity ----------

// "order 86721", "order no. 86721", "order #86721", "#86721"
const ORDER_RE = /(?:\border\b(?:\s*(?:no\.?|number|id))?\s*#?\s*|#)(\d{4,10})\b/gi;

export function extractOrderNumbers(texts) {
  const found = new Set();
  for (const t of texts) for (const m of String(t).matchAll(ORDER_RE)) found.add(m[1]);
  return [...found];
}

/** Everything the side panel shows next to a conversation. */
export async function conversationDetails(conversationId) {
  const db = getDb();
  const base = (
    await db.query(
      `SELECT c.id, c.remind_at, c.remind_set_by, ct.created_at AS first_seen
         FROM conversations c JOIN contacts ct ON ct.id = c.contact_id WHERE c.id = $1`,
      [conversationId],
    )
  ).rows[0];
  if (!base) throw new HttpError(404, 'Conversation not found');

  const [counts, inbound, notes, events] = await Promise.all([
    db.query(
      `SELECT count(*) FILTER (WHERE direction = 'INBOUND')::int AS received,
              count(*) FILTER (WHERE direction = 'OUTBOUND' AND delivery_status = 'SENT')::int AS sent
         FROM messages WHERE conversation_id = $1`,
      [conversationId],
    ),
    db.query(`SELECT body FROM messages WHERE conversation_id = $1 AND direction = 'INBOUND'`, [conversationId]),
    db.query(
      `SELECT id, author, body, created_at FROM conversation_notes WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC`,
      [conversationId],
    ),
    db.query(
      `SELECT from_status, to_status, actor, reason, created_at FROM status_events
        WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT 30`,
      [conversationId],
    ),
  ]);

  return {
    firstSeen: base.first_seen,
    messagesReceived: counts.rows[0].received,
    repliesSent: counts.rows[0].sent,
    orderNumbers: extractOrderNumbers(inbound.rows.map((r) => r.body)),
    reminder: base.remind_at ? { at: base.remind_at, setBy: base.remind_set_by } : null,
    notes: notes.rows,
    activity: events.rows,
  };
}

// ---------- "Also viewing" presence (in memory; fine for one server process) ----------

const VIEW_TTL_MS = 15_000; // the dashboard polls every 3 s, so 15 s means "has it open now"
const viewers = new Map(); // conversationId -> Map(agent -> lastSeenMs)

export function markViewing(conversationId, agent, now = Date.now()) {
  if (!agent) return;
  if (!viewers.has(conversationId)) viewers.set(conversationId, new Map());
  viewers.get(conversationId).set(agent, now);
}

export function viewersOf(conversationId, now = Date.now()) {
  const m = viewers.get(conversationId);
  if (!m) return [];
  for (const [agent, at] of m) if (now - at > VIEW_TTL_MS) m.delete(agent);
  if (m.size === 0) viewers.delete(conversationId);
  return [...m.keys()];
}

export function stopViewing(conversationId, agent) {
  viewers.get(conversationId)?.delete(agent);
}

// ---------- Bulk actions ----------

const BULK_MAX = 100;

/**
 * Apply one action to many conversations. Each one is done on its own, so one failure
 * (e.g. already resolved) doesn't undo the rest; the result says what happened to each.
 *   resolve | assign (with `assignee`) | spam (label unanswered messages as spam, then resolve)
 */
export async function bulkAction({ ids, action, assignee }, agent, validAgents) {
  if (!Array.isArray(ids) || ids.length === 0) throw new HttpError(400, 'Select at least one conversation');
  if (ids.length > BULK_MAX) throw new HttpError(400, `At most ${BULK_MAX} conversations at a time`);
  const clean = [...new Set(ids.map(Number))];
  if (clean.some((id) => !Number.isInteger(id) || id <= 0)) throw new HttpError(400, 'Invalid conversation id');
  if (!['resolve', 'assign', 'spam'].includes(action)) throw new HttpError(400, `Unknown bulk action: ${action}`);

  const results = [];
  for (const id of clean) {
    try {
      if (action === 'assign') {
        await assignConversation(id, assignee ?? null, validAgents);
      } else {
        if (action === 'spam') {
          // Corrections, not overwrites: these become labelled training data for the classifier.
          const { rows } = await getDb().query(
            `SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation_id
              WHERE m.conversation_id = $1 AND m.direction = 'INBOUND'
                AND (c.needs_reply_since IS NULL OR m.sent_at >= c.needs_reply_since)`,
            [id],
          );
          for (const m of rows) await correctIntent(m.id, 'spam', agent);
        }
        const { rows } = await getDb().query(`SELECT status FROM conversations WHERE id = $1`, [id]);
        if (!rows[0]) throw new HttpError(404, 'Conversation not found');
        if (rows[0].status !== 'RESOLVED') await updateStatus(id, 'RESOLVED', agent);
      }
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err.message });
    }
  }
  return { action, done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

// ---------- Report (CSV) ----------

const csvCell = (v) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * One row per conversation with its reply-time facts, for the evaluation (spreadsheet,
 * pandas). Usernames are included; message text is not.
 */
export async function exportReportCsv() {
  const { rows } = await getDb().query(
    `SELECT c.id, ct.username, c.status, c.intent, c.priority, c.assignee,
            c.first_inbound_at, c.first_response_at,
            extract(epoch FROM c.first_response_at - c.first_inbound_at)::int AS first_response_seconds,
            (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'INBOUND')::int AS messages_received,
            (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'OUTBOUND' AND m.delivery_status = 'SENT')::int AS replies_sent,
            (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY m.response_seconds) FROM messages m
              WHERE m.conversation_id = c.id AND m.response_seconds IS NOT NULL)::int AS median_response_seconds,
            (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.saved_reply_id IS NOT NULL)::int AS saved_replies_used,
            c.needs_reply_since IS NOT NULL AS waiting_now, c.is_overdue AS overdue_now
       FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
      ORDER BY c.id`,
  );
  const header = [
    'id', 'username', 'status', 'intent', 'priority', 'assignee', 'first_message_at', 'first_reply_at',
    'first_reply_seconds', 'messages_received', 'replies_sent', 'median_reply_seconds', 'saved_replies_used',
    'waiting_now', 'overdue_now',
  ];
  const lines = rows.map((r) =>
    [r.id, r.username, r.status, r.intent, r.priority, r.assignee, r.first_inbound_at, r.first_response_at,
      r.first_response_seconds, r.messages_received, r.replies_sent, r.median_response_seconds, r.saved_replies_used,
      r.waiting_now, r.overdue_now].map(csvCell).join(','),
  );
  return [header.join(','), ...lines].join('\n') + '\n';
}
