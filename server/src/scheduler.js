// The "nothing gets forgotten" guarantee. Every few seconds, any conversation
// whose oldest unanswered message is older than the SLA gets flagged overdue.
// Flags are cleared by sendReply() or by resolving the chat.
import { getDb } from './db.js';
import { config } from './config.js';

/** Returns the ids of conversations that just became overdue. `now` is injectable for tests. */
export async function markOverdue(now = new Date(), slaSeconds = config.slaSeconds) {
  const cutoff = new Date(now.getTime() - slaSeconds * 1000).toISOString();
  const { rows } = await getDb().query(
    `UPDATE conversations
        SET is_overdue = true, overdue_at = $2, updated_at = now()
      WHERE needs_reply_since IS NOT NULL
        AND NOT is_overdue
        AND status <> 'RESOLVED'
        AND needs_reply_since <= $1
      RETURNING id`,
    [cutoff, now.toISOString()],
  );
  return rows.map((r) => r.id);
}

export function startScheduler() {
  let running = false;
  const tick = async () => {
    if (running) return; // never overlap two runs
    running = true;
    try {
      const ids = await markOverdue();
      // Phase 3 idea: notify the assignee (email / push) instead of only logging.
      if (ids.length) console.log(`[sla] ${ids.length} conversation(s) became overdue: ${ids.join(', ')}`);
    } catch (err) {
      console.error('[sla] check failed', err);
    } finally {
      running = false;
    }
  };
  tick();
  return setInterval(tick, config.schedulerIntervalSeconds * 1000);
}
