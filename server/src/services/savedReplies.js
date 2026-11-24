// Saved replies (Phase 3): reusable answers, suggested by the conversation's message type.
//
// Deliberately rule-based, not generated text: the agent always sees and can edit what is sent,
// nothing can invent prices or policies, and usage is measurable (which template, edited or not).
import { getDb } from '../db.js';
import { HttpError } from './conversations.js';
import { INTENTS } from '../intents.js';

const MAX_TITLE = 60;
const MAX_BODY = 1000;

// Starter set for a generic small online clothing store. Every business should edit these:
// placeholders like [price] are meant to be replaced with the shop's own details.
export const DEFAULT_SAVED_REPLIES = [
  { intent: 'price', title: 'Price', body: 'Hi {name}! This one is ₹[price]. Want me to share the link to order?' },
  { intent: 'size', title: 'Size chart', body: 'Hi {name}! Sizes go from XS to XXL. Here is our size chart: [link]. Tell me your usual size and I will check stock.' },
  { intent: 'availability', title: 'In stock?', body: 'Hi {name}! Let me check stock for you. Which colour and size would you like?' },
  { intent: 'cod_shipping', title: 'COD & delivery', body: 'Hi {name}! Yes, cash on delivery is available. Delivery usually takes [3–5] working days.' },
  { intent: 'order_status', title: 'Order status', body: 'Hi {name}, sorry for the wait! Please share your order number and I will check where it is right away.' },
  { intent: 'return_exchange', title: 'Return / exchange', body: 'Hi {name}! You can exchange within [7] days of delivery. Please share your order number and the size you need.' },
  { intent: 'complaint', title: 'Apology + fix', body: 'Hi {name}, I am really sorry about this. Please share your order number and a photo, and I will sort it out for you today.' },
  { intent: 'collab', title: 'Collab', body: 'Hi {name}, thanks for reaching out! Please email your profile and rates to [email] and our team will get back to you.' },
  { intent: null, title: 'Thanks', body: 'Thank you {name}! Let me know if there is anything else I can help with.' },
];

function clean({ title, body, intent }) {
  const t = typeof title === 'string' ? title.trim() : '';
  const b = typeof body === 'string' ? body.trim() : '';
  if (!t || t.length > MAX_TITLE) throw new HttpError(400, `Title is required (max ${MAX_TITLE} characters)`);
  if (!b || b.length > MAX_BODY) throw new HttpError(400, `Reply text is required (max ${MAX_BODY} characters)`);
  const i = intent === '' || intent == null ? null : intent;
  if (i !== null && !INTENTS.includes(i)) throw new HttpError(400, `Unknown message type: ${i}`);
  return { title: t, body: b, intent: i };
}

/** Fill placeholders. Only {name} is automatic; anything in [brackets] is for the agent to edit. */
export function renderSavedReply(body, username) {
  return body.replace(/\{name\}/g, username ? `@${username}` : 'there');
}

/** First start: add the starter set so the feature is useful immediately. */
export async function seedSavedReplies() {
  const db = getDb();
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM saved_replies`);
  if (rows[0].n > 0) return 0;
  for (const r of DEFAULT_SAVED_REPLIES) {
    await db.query(`INSERT INTO saved_replies (title, body, intent, created_by) VALUES ($1, $2, $3, 'starter set')`, [
      r.title, r.body, r.intent,
    ]);
  }
  return DEFAULT_SAVED_REPLIES.length;
}

export async function listSavedReplies() {
  return (
    await getDb().query(
      `SELECT id, title, body, intent, use_count FROM saved_replies WHERE active
        ORDER BY intent NULLS LAST, use_count DESC, id`,
    )
  ).rows;
}

export async function createSavedReply(input, agent) {
  const r = clean(input);
  return (
    await getDb().query(
      `INSERT INTO saved_replies (title, body, intent, created_by) VALUES ($1, $2, $3, $4)
       RETURNING id, title, body, intent, use_count`,
      [r.title, r.body, r.intent, agent ?? null],
    )
  ).rows[0];
}

export async function updateSavedReply(id, input) {
  const r = clean(input);
  const row = (
    await getDb().query(
      `UPDATE saved_replies SET title = $2, body = $3, intent = $4, updated_at = now()
        WHERE id = $1 AND active RETURNING id, title, body, intent, use_count`,
      [id, r.title, r.body, r.intent],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, 'Saved reply not found');
  return row;
}

export async function deleteSavedReply(id) {
  const { rows } = await getDb().query(
    `UPDATE saved_replies SET active = false, updated_at = now() WHERE id = $1 AND active RETURNING id`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'Saved reply not found');
  return { id };
}

/**
 * Up to `limit` replies for this conversation: ones for its current message type first, then
 * general ones; within each, the most used first. Text is already filled in for this customer.
 */
export async function suggestSavedReplies(conversation, limit = 3) {
  const { rows } = await getDb().query(
    `SELECT id, title, body, intent FROM saved_replies
      WHERE active AND (intent = $1 OR intent IS NULL)
      ORDER BY (intent = $1) DESC NULLS LAST, use_count DESC, id
      LIMIT $2`,
    [conversation.intent ?? '', limit],
  );
  return rows.map((r) => ({ ...r, text: renderSavedReply(r.body, conversation.username) }));
}
