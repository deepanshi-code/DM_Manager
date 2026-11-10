import { config } from './config.js';
import { initDb } from './db.js';
import { createApp } from './app.js';
import { startScheduler } from './scheduler.js';
import { backfillIntents } from './services/conversations.js';
import { modelInfo } from './classifier/index.js';

const db = await initDb();
if (!config.appSecret) {
  console.warn('[security] IG_APP_SECRET is empty: webhook signatures are NOT checked (dev only).');
}

const backfill = await backfillIntents();
if (backfill.messages) {
  console.log(`[classifier] labelled ${backfill.messages} older message(s) in ${backfill.conversations} conversation(s)`);
}
const clf = modelInfo();
console.log(clf.available
  ? `[classifier] model ${clf.analyzer} (trained ${clf.trainedAt}, threshold ${clf.threshold})`
  : `[classifier] keyword rules only (${clf.error})`);

startScheduler();
createApp().listen(config.port, () => {
  console.log(`DM Manager API on http://localhost:${config.port}  (db: ${db.kind}, sender: ${config.sender})`);
  console.log(`SLA: ${config.slaSeconds}s, reply window: ${config.replyWindowHours}h`);
});
