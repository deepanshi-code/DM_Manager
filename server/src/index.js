import { config } from './config.js';
import { initDb } from './db.js';
import { createApp } from './app.js';
import { startScheduler } from './scheduler.js';
import { backfillIntents } from './services/conversations.js';
import { modelInfo } from './classifier/index.js';
import { listAgents } from './auth.js';
import { seedSavedReplies } from './services/savedReplies.js';
import { refreshDemoIfStale } from './demo.js';

const db = await initDb();
if (config.sender === 'instagram') {
  // With real customers, unsigned webhooks would let anyone inject fake messages.
  const missing = [!config.appSecret && 'IG_APP_SECRET', !config.instagram.accessToken && 'IG_ACCESS_TOKEN'].filter(Boolean);
  if (missing.length) {
    console.error(`[config] SENDER=instagram needs ${missing.join(' and ')} in server/.env. Not starting.`);
    process.exit(1);
  }
  if (!config.auth) {
    console.error('[config] SENDER=instagram with AUTH=off would expose real customer chats without login. Not starting.');
    process.exit(1);
  }
} else if (!config.appSecret) {
  console.warn('[security] IG_APP_SECRET is empty: webhook signatures are NOT checked (dev only).');
}
if (config.auth && (await listAgents()).length === 0) {
  console.warn('[auth] Login is on but no agent accounts exist. Stop the server and run:  npm run agent -- add <name>');
}

if (config.demoSeed) {
  const demo = await refreshDemoIfStale();
  if (demo) console.log(`[demo] loaded a fresh synthetic demo inbox (${demo.answered + demo.overdue + demo.fresh} chats)`);
}
const seeded = await seedSavedReplies();
if (seeded) console.log(`[saved replies] added ${seeded} starter replies: edit them to match your shop`);

const backfill = await backfillIntents();
if (backfill.messages) {
  console.log(`[classifier] labelled ${backfill.messages} older message(s) in ${backfill.conversations} conversation(s)`);
}
const clf = modelInfo();
console.log(clf.available
  ? `[classifier] model ${clf.analyzer} (trained ${clf.trainedAt}, threshold ${clf.threshold})`
  : `[classifier] keyword rules only (${clf.error})`);

startScheduler();
// Express 5 calls this callback with an error if the port can't be bound (e.g. already in use).
createApp().listen(config.port, (err) => {
  if (err) {
    console.error(`[startup] cannot listen on port ${config.port}: ${err.code ?? err.message}. Is another server already running?`);
    process.exit(1);
  }
  console.log(`DM Manager API on http://localhost:${config.port}  (db: ${db.kind}, sender: ${config.sender})`);
  console.log(`SLA: ${config.slaSeconds}s, reply window: ${config.replyWindowHours}h, login: ${config.auth ? 'on' : 'OFF (demo mode)'}`);
});
