// Rebuilds the local demo database with a believable inbox, timed relative to SLA_SECONDS:
//   - answered chats from the last few hours (some on time, some late, some via saved replies),
//     so the overview's reply-time numbers aren't empty
//   - a few overdue chats, including a complaint and a customer who is chasing
//   - a batch of brand-new chats that turn overdue *during* the demo
//
//   npm run demo:reset          (stop the API server first)
//
// Synthetic data only (simulator/data/synthetic_dms.json). Refuses to touch a real
// PostgreSQL database (DATABASE_URL). The previous demo database is kept in .data/pglite-previous.
import { existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { initDb } from '../src/db.js';
import { setSender } from '../src/senders/index.js';
import { seedDemoInbox } from '../src/demo.js';

if (config.databaseUrl) {
  console.error('DATABASE_URL is set: demo:reset only rebuilds the embedded demo database. Nothing changed.');
  process.exit(1);
}
try {
  await fetch(`http://localhost:${config.port}/health`, { signal: AbortSignal.timeout(800) });
  console.error(`The API server is running on port ${config.port}. Stop it first, then run this again.`);
  process.exit(1);
} catch {
  // not running: good
}

// Keep the last demo database, replacing an older backup.
const dir = path.resolve(config.pgliteDir);
if (existsSync(dir)) {
  const previous = `${dir}-previous`;
  await rm(previous, { recursive: true, force: true });
  await rename(dir, previous);
  console.log(`Previous demo database moved to ${path.relative(process.cwd(), previous)}`);
}

const db = await initDb();
setSender({ send: async () => { throw new Error('demo seed never sends'); } });
const counts = await seedDemoInbox();
await db.close();

console.log(`Demo inbox ready (SLA ${config.slaSeconds}s):`);
console.log(`  ${counts.answered} answered earlier (${counts.resolved} resolved), ${counts.overdue} overdue, ${counts.fresh} new`);
console.log(`  The ${counts.fresh} new chats turn overdue about ${Math.round(config.slaSeconds / 60) || 1} min after you start the server.`);
if (config.auth) console.log('  Login is on: agent accounts were reset too. Create one with: npm run agent -- add <name>');
console.log('Next: npm run dev:server  (and npm run dev:client), then follow docs/DEMO.md');
