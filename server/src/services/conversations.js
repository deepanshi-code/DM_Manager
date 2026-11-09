import { getDb } from '../db.js';
import { config } from '../config.js';
import { getSender } from '../senders/index.js';
import {
  STATUS,
  ALL_STATUSES,
  allowedTransitions,
  canTransition,
  statusAfterInbound,
  statusAfterReply,
  replyWindow,
} from '../stateMachine.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function logStatus(q, conversationId, from, to, actor, reason) {
  if (from === to) return;
  await q.query(
    `INSERT INTO status_events (conversation_id, from_status, to_status, actor, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [conversationId, from, to, actor, reason],
  );
}

async function lockConversation(q, id) {
  const { rows } = await q.query(
    `SELECT c.*, ct.ig_user_id, ct.username
       FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.id = $1
      FOR UPDATE OF c`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'Conversation not found');
  return rows[0];
}

/**
 * Store one incoming customer message. Safe to call twice with the same `mid`
 * (Meta retries webhooks), the second call is a no-op.
 */
export async function ingestInbound({ igUserId, username, mid, text, timestamp }) {
  if (!igUserId || !mid || typeof text !== 'string') {
    throw new HttpError(400, 'igUserId, mid and text are required');
  }
  const ts = new Date(timestamp ?? Date.now()).toISOString();

  return getDb().tx(async (q) => {
    const contact = (
      await q.query(
        `INSERT INTO contacts (ig_user_id, username) VALUES ($1, $2)
         ON CONFLICT (ig_user_id) DO UPDATE SET username = COALESCE(EXCLUDED.username, contacts.username)
         RETURNING id`,
        [igUserId, username ?? null],
      )
    ).rows[0];

    await q.query(
      `INSERT INTO conversations (contact_id) VALUES ($1) ON CONFLICT (contact_id) DO NOTHING`,
      [contact.id],
    );
    const conv = (
      await q.query(`SELECT * FROM conversations WHERE contact_id = $1 FOR UPDATE`, [contact.id])
    ).rows[0];

    const inserted = await q.query(
      `INSERT INTO messages (conversation_id, platform_message_id, direction, body, sent_at, delivery_status)
       VALUES ($1, $2, 'INBOUND', $3, $4, 'RECEIVED')
       ON CONFLICT (platform_message_id) DO NOTHING
       RETURNING id`,
      [conv.id, mid, text, ts],
    );
    if (inserted.rows.length === 0) return { duplicate: true, conversationId: conv.id };

    const next = statusAfterInbound(conv.status);
    await q.query(
      `UPDATE conversations SET
          status = $2,
          needs_reply_since = COALESCE(needs_reply_since, $3),
          first_inbound_at = COALESCE(first_inbound_at, $3),
          last_customer_message_at = GREATEST(last_customer_message_at, $3),
          last_message_preview = CASE WHEN last_message_at IS NULL OR $3 >= last_message_at
                                      THEN $4 ELSE last_message_preview END,
          last_message_at = GREATEST(last_message_at, $3),
          unread_count = unread_count + 1,
          updated_at = now()
        WHERE id = $1`,
      [conv.id, next, ts, text.slice(0, 140)],
    );
    await logStatus(q, conv.id, conv.status, next, 'customer', 'inbound_message');
    return { duplicate: false, conversationId: conv.id, messageId: inserted.rows[0].id, status: next };
  });
}

/**
 * Send an agent reply. Three steps so we never hold a DB lock during a network call
 * and never lose track of a message:
 *   1. record it as PENDING   2. call the sender   3. mark SENT (or FAILED)
 * The conversation only moves to WAITING_ON_CUSTOMER once delivery succeeded.
 */
export async function sendReply(conversationId, text, agent) {
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) throw new HttpError(400, 'Reply text is required');
  if (body.length > 1000) throw new HttpError(400, 'Reply is too long (max 1000 characters)');
  const db = getDb();

  const pending = await db.tx(async (q) => {
    const conv = await lockConversation(q, conversationId);
    const window = replyWindow(conv.last_customer_message_at, new Date(), config.replyWindowHours);
    if (!window.open) {
      throw new HttpError(
        409,
        `Reply window closed: the customer's last message was over ${config.replyWindowHours}h ago`,
      );
    }
    const msg = (
      await q.query(
        `INSERT INTO messages (conversation_id, direction, body, sent_at, delivery_status, sent_by)
         VALUES ($1, 'OUTBOUND', $2, now(), 'PENDING', $3) RETURNING id`,
        [conversationId, body, agent ?? null],
      )
    ).rows[0];
    return { messageId: msg.id, igUserId: conv.ig_user_id };
  });

  let delivery;
  try {
    delivery = await getSender().send({ recipientId: pending.igUserId, text: body });
  } catch (err) {
    await db.query(`UPDATE messages SET delivery_status = 'FAILED', error = $2 WHERE id = $1`, [
      pending.messageId,
      String(err.message).slice(0, 500),
    ]);
    // Conversation is untouched, so it still shows as "needs reply".
    throw new HttpError(502, `Reply could not be delivered: ${err.message}`);
  }

  return db.tx(async (q) => {
    const conv = await lockConversation(q, conversationId);
    const responseSeconds = conv.needs_reply_since
      ? Math.round((Date.now() - new Date(conv.needs_reply_since).getTime()) / 1000)
      : null;
    await q.query(
      `UPDATE messages SET delivery_status = 'SENT', platform_message_id = $2, sent_at = now(),
              response_seconds = $3
        WHERE id = $1`,
      [pending.messageId, delivery.mid, responseSeconds],
    );
    const next = statusAfterReply(conv.status);
    await q.query(
      `UPDATE conversations SET
          status = $2,
          needs_reply_since = NULL,
          is_overdue = false,
          first_response_at = COALESCE(first_response_at, now()),
          last_message_at = now(),
          last_message_preview = $3,
          unread_count = 0,
          assignee = COALESCE(assignee, $4),
          updated_at = now()
        WHERE id = $1`,
      [conversationId, next, `You: ${body}`.slice(0, 140), agent ?? null],
    );
    await logStatus(q, conversationId, conv.status, next, agent ?? 'agent', 'reply_sent');
    return { messageId: pending.messageId, status: next, responseSeconds };
  });
}

export async function updateStatus(conversationId, to, actor) {
  if (!ALL_STATUSES.includes(to)) throw new HttpError(400, `Unknown status: ${to}`);
  return getDb().tx(async (q) => {
    const conv = await lockConversation(q, conversationId);
    if (conv.status === to) return { status: to };
    if (!canTransition(conv.status, to)) {
      throw new HttpError(409, `Cannot move a conversation from ${conv.status} to ${to}`);
    }
    // Resolving means "nothing left to reply to" (e.g. spam, or the customer said thanks).
    const clearTimer = to === STATUS.RESOLVED;
    await q.query(
      `UPDATE conversations SET
          status = $2,
          needs_reply_since = CASE WHEN $3::boolean THEN NULL ELSE needs_reply_since END,
          is_overdue = CASE WHEN $3::boolean THEN false ELSE is_overdue END,
          updated_at = now()
        WHERE id = $1`,
      [conversationId, to, clearTimer],
    );
    await logStatus(q, conversationId, conv.status, to, actor ?? 'agent', 'manual');
    return { status: to };
  });
}

export async function assignConversation(conversationId, assignee) {
  if (assignee !== null && !config.agents.includes(assignee)) {
    throw new HttpError(400, `Unknown agent: ${assignee}`);
  }
  const { rows } = await getDb().query(
    `UPDATE conversations SET assignee = $2, updated_at = now() WHERE id = $1 RETURNING id`,
    [conversationId, assignee],
  );
  if (!rows[0]) throw new HttpError(404, 'Conversation not found');
  return { assignee };
}

/** Agent opened the chat: clear the unread badge and move NEW → OPEN. */
export async function markRead(conversationId, actor) {
  return getDb().tx(async (q) => {
    const conv = await lockConversation(q, conversationId);
    const next = conv.status === STATUS.NEW ? STATUS.OPEN : conv.status;
    await q.query(
      `UPDATE conversations SET unread_count = 0, status = $2, updated_at = now() WHERE id = $1`,
      [conversationId, next],
    );
    await logStatus(q, conversationId, conv.status, next, actor ?? 'agent', 'opened');
    return { status: next };
  });
}

const FILTERS = ['ALL', 'NEEDS_REPLY', 'OVERDUE', ...ALL_STATUSES];

/**
 * Inbox ordering is a design decision: overdue first, then the customer who has
 * been waiting longest. Newest-first (like Instagram) is exactly what buries old chats.
 */
export async function listConversations({ filter = 'NEEDS_REPLY', search, assignee } = {}) {
  if (!FILTERS.includes(filter)) throw new HttpError(400, `Unknown filter: ${filter}`);
  const status = ALL_STATUSES.includes(filter) ? filter : null;
  const { rows } = await getDb().query(
    `SELECT c.id, c.status, c.assignee, c.needs_reply_since, c.is_overdue, c.overdue_at,
            c.last_message_at, c.last_message_preview, c.unread_count, c.last_customer_message_at,
            ct.username, ct.ig_user_id
       FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
      WHERE ($1::text IS NULL OR c.status = $1)
        AND ($2::boolean IS NOT TRUE OR c.is_overdue)
        AND ($3::boolean IS NOT TRUE OR c.needs_reply_since IS NOT NULL)
        AND ($4::text IS NULL OR ct.username ILIKE '%' || $4 || '%'
                              OR c.last_message_preview ILIKE '%' || $4 || '%')
        AND ($5::text IS NULL OR c.assignee = $5)
      ORDER BY c.is_overdue DESC, c.needs_reply_since ASC NULLS LAST, c.last_message_at DESC
      LIMIT 200`,
    [status, filter === 'OVERDUE', filter === 'NEEDS_REPLY', search || null, assignee || null],
  );
  return rows;
}

export async function getConversation(conversationId) {
  const db = getDb();
  const conv = (
    await db.query(
      `SELECT c.*, ct.username, ct.ig_user_id
         FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
        WHERE c.id = $1`,
      [conversationId],
    )
  ).rows[0];
  if (!conv) throw new HttpError(404, 'Conversation not found');
  const messages = (
    await db.query(
      `SELECT id, direction, body, sent_at, delivery_status, sent_by, response_seconds, error
         FROM messages WHERE conversation_id = $1
        ORDER BY sent_at ASC, id ASC`,
      [conversationId],
    )
  ).rows;
  return {
    ...conv,
    messages,
    allowedTransitions: allowedTransitions(conv.status),
    replyWindow: replyWindow(conv.last_customer_message_at, new Date(), config.replyWindowHours),
  };
}

/** The numbers you will report in the capstone evaluation. */
export async function getStats() {
  const db = getDb();
  const counts = (
    await db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'NEW')::int AS "NEW",
              count(*) FILTER (WHERE status = 'OPEN')::int AS "OPEN",
              count(*) FILTER (WHERE status = 'WAITING_ON_CUSTOMER')::int AS "WAITING_ON_CUSTOMER",
              count(*) FILTER (WHERE status = 'RESOLVED')::int AS "RESOLVED",
              count(*) FILTER (WHERE needs_reply_since IS NOT NULL)::int AS "NEEDS_REPLY",
              count(*) FILTER (WHERE is_overdue)::int AS "OVERDUE",
              min(needs_reply_since) AS oldest_unanswered_since
         FROM conversations`,
    )
  ).rows[0];
  const replies = (
    await db.query(
      `SELECT count(*)::int AS replies,
              count(*) FILTER (WHERE response_seconds <= $1)::int AS within_sla,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY response_seconds)::float8 AS median_response_seconds
         FROM messages
        WHERE direction = 'OUTBOUND' AND delivery_status = 'SENT' AND response_seconds IS NOT NULL`,
      [config.slaSeconds],
    )
  ).rows[0];
  const first = (
    await db.query(
      `SELECT percentile_cont(0.5) WITHIN GROUP (
                ORDER BY extract(epoch FROM first_response_at - first_inbound_at))::float8
                AS median_first_response_seconds
         FROM conversations WHERE first_response_at IS NOT NULL`,
    )
  ).rows[0];
  return {
    counts,
    replies: replies.replies,
    repliesWithinSlaPct: replies.replies ? Math.round((100 * replies.within_sla) / replies.replies) : null,
    medianResponseSeconds: replies.median_response_seconds,
    medianFirstResponseSeconds: first.median_first_response_seconds,
    slaSeconds: config.slaSeconds,
  };
}
