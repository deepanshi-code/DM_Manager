// Hosted demo: a fresh synthetic inbox at startup, reloaded when the data goes stale.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, getDb } from '../src/db.js';
import { refreshDemoIfStale } from '../src/demo.js';

before(async () => {
  await initDb({ dataDir: 'memory://' });
});

test('empty database: the demo inbox is loaded', async () => {
  const r = await refreshDemoIfStale(6);
  assert.ok(r.answered + r.overdue + r.fresh >= 30);
  const { rows } = await getDb().query(`SELECT count(*)::int AS n FROM conversations WHERE needs_reply_since IS NOT NULL`);
  assert.ok(rows[0].n > 0);
});

test('fresh data is left alone', async () => {
  assert.equal(await refreshDemoIfStale(6), null);
});

test('stale data (older than the limit) is wiped and reloaded, with ids starting again', async () => {
  const db = getDb();
  await db.query(`INSERT INTO conversation_notes (conversation_id, author, body) VALUES (1, 'x', 'visitor note')`);
  await db.query(`UPDATE conversations SET last_message_at = now() - interval '7 hours'`);
  const r = await refreshDemoIfStale(6);
  assert.ok(r);
  const notes = await db.query(`SELECT count(*)::int AS n FROM conversation_notes`);
  assert.equal(notes.rows[0].n, 0);
  const ids = await db.query(`SELECT min(id)::int AS lo FROM conversations`);
  assert.equal(ids.rows[0].lo, 1);
  const saved = await db.query(`SELECT count(*)::int AS n FROM saved_replies`);
  assert.ok(saved.rows[0].n > 0);
});
