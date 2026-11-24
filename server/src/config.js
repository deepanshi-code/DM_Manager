const num = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));

export const config = {
  port: num(process.env.PORT, 4000),
  // How long a customer may wait for a reply before the chat is flagged overdue.
  slaSeconds: num(process.env.SLA_SECONDS, 3600),
  schedulerIntervalSeconds: num(process.env.SCHEDULER_INTERVAL_SECONDS, 15),
  // Meta's messaging window: businesses can reply freely within this many hours of the
  // customer's last message. Verify the current rule in Meta's docs before Phase 4.
  replyWindowHours: num(process.env.REPLY_WINDOW_HOURS, 24),
  verifyToken: process.env.IG_VERIFY_TOKEN || 'dev-verify-token',
  appSecret: process.env.IG_APP_SECRET || '',
  sender: process.env.SENDER || 'simulated',
  // Instagram messaging API (Phase 4). Token is a secret: keep it in .env, never in git.
  instagram: {
    accessToken: process.env.IG_ACCESS_TOKEN || '',
    userId: process.env.IG_USER_ID || 'me',
    version: process.env.IG_API_VERSION || 'v23.0',
    host: process.env.IG_GRAPH_HOST || 'https://graph.instagram.com',
  },
  // Agent login. "on" for any real deployment; "off" only for local demos with fake data.
  auth: (process.env.AUTH || 'on').toLowerCase() !== 'off',
  sessionHours: num(process.env.SESSION_HOURS, 12),
  // Set when running behind a reverse proxy / tunnel that terminates HTTPS (e.g. "1" or "loopback").
  trustProxy: process.env.TRUST_PROXY || '',
  simSendFailRate: num(process.env.SIM_SEND_FAIL_RATE, 0),
  agents: (process.env.AGENTS || 'Asha,Rohan,Meera')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  pgliteDir: process.env.PGLITE_DIR || './.data/pglite',
  databaseUrl: process.env.DATABASE_URL || '',
};
