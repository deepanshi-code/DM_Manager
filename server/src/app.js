import express from 'express';
import { webhookRouter } from './routes/webhook.js';
import { apiRouter } from './routes/api.js';
import { config } from './config.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Basic security headers on every response: no MIME sniffing, no framing (clickjacking),
  // no referrer leaks; customer data from the API is never cached by browsers or proxies.
  app.use((req, res, next) => {
    res.set({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    });
    if (req.path.startsWith('/api/')) res.set('cache-control', 'no-store');
    next();
  });
  // Behind a tunnel / reverse proxy that terminates HTTPS, this makes req.secure and req.ip correct.
  if (config.trustProxy) app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);

  // Webhook first: it needs the raw body, so it must run before express.json().
  app.use('/webhook', webhookRouter);
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', apiRouter);
  app.get('/health', (req, res) => res.json({ ok: true }));

  // Express 5 forwards errors thrown in async handlers to here.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    if (err.status === 502) return res.status(502).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
