// Hosted demo: a fresh synthetic inbox at startup, reloaded when it was loaded too long ago.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initDb, getDb } from '../src/db.js';
import { refreshDemoIfStale } from '../src/demo.js';

before(async () => {
  await initDb({ dataDir: 'memory://' });
});

const HOUR = 3600_000;

test('empty database: the demo inbox is loaded and the load time recorded', async () => {
  const r = await refreshDemoIfStale(6);
  assert.ok(r.answered + r.overdue + r.fresh >= 30);
  const { rows } = await getDb().query(`SELECT count(*)::int AS n FROM conversations WHERE needs_reply_since IS NOT NULL`);
  assert.ok(rows[0].n > 0);
  const marker = await getDb().query(`SELECT value FROM app_meta WHERE key = 'demo_seeded_at'`);
  assert.equal(marker.rows.length, 1);
});

test('a demo loaded less than 6 hours ago is left alone', async () => {
  assert.equal(await refreshDemoIfStale(6, Date.now() + 5 * HOUR), null);
});

test('visitor replies do not keep a stale demo alive: age counts from when it was loaded', async () => {
  const db = getDb();
  // A visitor replied "just now" (last_message_at is recent)...
  await db.query(`UPDATE conversations SET last_message_at = now()`);
  await db.query(`INSERT INTO conversation_notes (conversation_id, author, body) VALUES (1, 'x', 'visitor note')`);
  // ...but the demo was loaded 7 hours ago, so it is reloaded anyway.
  const r = await refreshDemoIfStale(6, Date.now() + 7 * HOUR);
  assert.ok(r);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM conversation_notes`)).rows[0].n, 0);
  assert.equal((await db.query(`SELECT min(id)::int AS lo FROM conversations`)).rows[0].lo, 1);
  assert.ok((await db.query(`SELECT count(*)::int AS n FROM saved_replies`)).rows[0].n > 0);
});

test('an interrupted load (no completion marker) is redone on the next start', async () => {
  const db = getDb();
  await db.query(`DELETE FROM app_meta WHERE key = 'demo_seeded_at'`); // as if the process died mid-seed
  assert.ok(await refreshDemoIfStale(6));
});

test('the server refuses DEMO_SEED together with login (real-customer mode)', () => {
  const index = fileURLToPath(new URL('../src/index.js', import.meta.url));
  const r = spawnSync(process.execPath, [index], {
    env: { ...process.env, DEMO_SEED: 'true', AUTH: 'on', PGLITE_DIR: 'memory://', PORT: '0', DATABASE_URL: '' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DEMO_SEED=true deletes all conversations/);
});
