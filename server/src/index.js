import { config } from './config.js';
import { initDb } from './db.js';
import { createApp } from './app.js';
import { startScheduler } from './scheduler.js';

const db = await initDb();
if (!config.appSecret) {
  console.warn('[security] IG_APP_SECRET is empty: webhook signatures are NOT checked (dev only).');
}

startScheduler();
createApp().listen(config.port, () => {
  console.log(`DM Manager API on http://localhost:${config.port}  (db: ${db.kind}, sender: ${config.sender})`);
  console.log(`SLA: ${config.slaSeconds}s, reply window: ${config.replyWindowHours}h`);
});
