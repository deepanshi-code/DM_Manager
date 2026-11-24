// Webhooks identify customers only by a numeric Instagram-scoped id. This fills in their
// username once, so agents see "@riya_shop" instead of "17841400000000000".
import { getDb } from '../db.js';
import { config } from '../config.js';
import { instagramClient } from '../senders/index.js';

const RETRY_AFTER_MS = 60 * 60 * 1000; // don't hammer the API for a profile that just failed
const recentFailures = new Map(); // igUserId -> time of last failure

let lookupOverride = null;
/** Tests inject a fake lookup: (igUserId) => Promise<{ username }>. Pass null to reset. */
export function setProfileLookup(fn) {
  lookupOverride = fn;
}

function lookup() {
  if (lookupOverride) return lookupOverride;
  if (!config.instagram.accessToken) return null; // demo / simulator mode: nothing to look up
  return (id) => instagramClient().getProfile(id);
}

/** Look up usernames for the given customers that don't have one yet. Never throws per customer. */
export async function enrichProfiles(igUserIds, now = Date.now()) {
  const fetchProfile = lookup();
  if (!fetchProfile || igUserIds.length === 0) return { updated: 0, failed: 0 };

  const db = getDb();
  const { rows } = await db.query(
    `SELECT ig_user_id FROM contacts WHERE username IS NULL AND ig_user_id = ANY($1::text[])`,
    [igUserIds],
  );
  let updated = 0;
  let failed = 0;
  for (const { ig_user_id: id } of rows) {
    if (now - (recentFailures.get(id) ?? -Infinity) < RETRY_AFTER_MS) continue;
    try {
      const profile = await fetchProfile(id);
      if (profile?.username) {
        await db.query(`UPDATE contacts SET username = $2 WHERE ig_user_id = $1 AND username IS NULL`, [id, profile.username]);
        updated += 1;
        recentFailures.delete(id);
      }
    } catch (err) {
      failed += 1;
      recentFailures.set(id, now);
      console.warn(`[profiles] could not look up ${id}: ${err.message}`);
    }
  }
  return { updated, failed };
}
