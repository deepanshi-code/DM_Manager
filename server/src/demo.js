// Builds a believable demo inbox from the synthetic DMs, timed relative to SLA_SECONDS:
//   - answered chats from the last few hours (some on time, some late, some via saved replies)
//   - a few overdue chats, including a complaint and a customer who is chasing
//   - a batch of brand-new chats that turn overdue a couple of minutes later
// Used by `npm run demo:reset` and, on a hosted demo (DEMO_SEED=true), at startup when the
// database is empty. Synthetic data only.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getDb } from './db.js';
import { ingestInbound, ingestEcho, updateStatus, markRead } from './services/conversations.js';
import { seedSavedReplies, listSavedReplies, renderSavedReply } from './services/savedReplies.js';

export async function seedDemoInbox() {
  await seedSavedReplies();
  const saved = await listSavedReplies();

  const data = JSON.parse(await readFile(fileURLToPath(new URL('../simulator/data/synthetic_dms.json', import.meta.url)), 'utf8'));
  const sla = config.slaSeconds * 1000;
  const now = Date.now();
  const agents = config.agents.length ? config.agents : ['Asha', 'Rohan', 'Meera'];

  // Deterministic "random" so every reset looks the same.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const between = (a, b) => a + (b - a) * rand();

  let mid = 0;
  const nextMid = () => `demo_${++mid}`;
  const counts = { answered: 0, resolved: 0, overdue: 0, fresh: 0 };

  for (const [i, customer] of data.customers.entries()) {
    const msgs = customer.messages;
    // Scenario by position: ~35% answered earlier today, ~20% overdue, the rest new.
    const kind = i % 20 < 7 ? 'answered' : i % 20 < 11 ? 'overdue' : 'fresh';

    let start;
    if (kind === 'answered') start = now - between(1, 6) * 3600_000;
    else if (kind === 'overdue') start = now - between(2.5 * sla, Math.max(20 * sla, 3 * sla + 60_000));
    else start = now - between(5_000, 0.7 * sla);

    let t = start;
    let last = start; // time of the customer's latest message
    let conversationId;
    for (const m of msgs) {
      last = Math.min(t, now - 1000);
      ({ conversationId } = await ingestInbound({
        igUserId: customer.igUserId,
        username: customer.username,
        mid: nextMid(),
        text: m.text,
        timestamp: last,
      }));
      t += kind === 'fresh' ? between(2_000, 8_000) : kind === 'answered' ? between(3_000, 0.15 * sla) : between(60_000, 6 * 60_000);
    }

    if (kind === 'answered') {
      // Most replies on time, some late: a realistic, non-perfect picture. Timed from the first
      // unanswered message (that's what the reply timer measures). Whether a saved reply is used
      // is independent of the delay, so the demo doesn't fake a "templates are faster" result.
      const delay = rand() < 0.65 ? between(0.2 * sla, 0.9 * sla) : between(1.5 * sla, 12 * sla);
      const agent = agents[i % agents.length];
      const intent = msgs[0].intent;
      const template = rand() < 0.6 ? saved.find((s) => s.intent === intent) : null;
      const text = template ? renderSavedReply(template.body, customer.username).replace(/\[[^\]]*\]/, '499') : 'Hi! Thanks for your message, sharing the details now.';
      await markRead(conversationId, agent);
      const echo = await ingestEcho({ igUserId: customer.igUserId, mid: nextMid(), text, timestamp: Math.min(Math.max(start + delay, last + 1000), now - 1000) });
      // Shown as sent by an agent from the dashboard (the echo path is just a way to backdate it).
      await getDb().query(
        `UPDATE messages SET sent_by = $2, saved_reply_id = $3, saved_reply_edited = $4 WHERE id = $1`,
        [echo.messageId, agent, template?.id ?? null, template ? true : null],
      );
      await getDb().query(`UPDATE conversations SET assignee = $2 WHERE id = $1`, [conversationId, agent]);
      if (template) await getDb().query(`UPDATE saved_replies SET use_count = use_count + 1 WHERE id = $1`, [template.id]);
      if (rand() < 0.5) {
        await updateStatus(conversationId, 'RESOLVED', agent);
        counts.resolved += 1;
      }
      counts.answered += 1;
    } else {
      counts[kind] += 1;
    }
  }

  // Flag overdue chats now, instead of waiting for the scheduler's first tick.
  await getDb().query(
    `UPDATE conversations SET is_overdue = true, overdue_at = now()
      WHERE needs_reply_since IS NOT NULL AND needs_reply_since <= now() - make_interval(secs => $1)`,
    [config.slaSeconds],
  );
  return counts;
}

/** Seed only if the database has no conversations yet (safe to call on every start). */
export async function seedDemoIfEmpty() {
  const { rows } = await getDb().query(`SELECT count(*)::int AS n FROM conversations`);
  if (rows[0].n > 0) return null;
  return seedDemoInbox();
}

/**
 * Hosted demo only (DEMO_SEED=true): if the demo data is empty or older than `maxAgeHours`,
 * wipe it and load a fresh synthetic inbox. Otherwise every chat would pass Meta's 24-hour
 * reply window within a day and the public demo would look broken. Never use on real data.
 */
export async function refreshDemoIfStale(maxAgeHours = 6) {
  const db = getDb();
  const { rows } = await db.query(`SELECT max(last_message_at) AS latest, count(*)::int AS n FROM conversations`);
  const latest = rows[0].latest ? new Date(rows[0].latest).getTime() : 0;
  if (rows[0].n > 0 && Date.now() - latest < maxAgeHours * 3600_000) return null;
  if (rows[0].n > 0) {
    await db.exec(`TRUNCATE conversation_notes, status_events, messages, conversations, contacts, saved_replies, sessions
                   RESTART IDENTITY CASCADE`);
  }
  return seedDemoInbox();
}
