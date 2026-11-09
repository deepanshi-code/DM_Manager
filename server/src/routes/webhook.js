// Receives Instagram messaging webhooks. The simulator sends the same payload
// shape, so this file does not change when real Instagram is connected.
// Payload shape is based on Meta's Instagram messaging webhook; verify field
// names against the current Meta docs when you reach Phase 4.
import crypto from 'node:crypto';
import express from 'express';
import { config } from '../config.js';
import { ingestInbound } from '../services/conversations.js';

/** Turn a webhook body into a flat list of customer messages. */
export function parseInstagramWebhook(body) {
  const events = [];
  if (body?.object !== 'instagram') return events;
  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const message = event.message;
      if (!message || message.is_echo) continue; // is_echo = our own outgoing message
      if (message.is_deleted) continue;
      const text =
        typeof message.text === 'string'
          ? message.text
          : message.attachments?.length
            ? '[attachment]' // customers often send product screenshots
            : null;
      if (text === null || !message.mid || !event.sender?.id) continue;
      events.push({
        igUserId: String(event.sender.id),
        username: event.sender.username, // not sent by Meta; only the simulator fills this in
        mid: message.mid,
        text,
        timestamp: event.timestamp,
      });
    }
  }
  return events;
}

/** Meta signs each webhook with your app secret (header X-Hub-Signature-256). */
export function verifySignature(rawBody, header, secret) {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export const webhookRouter = express.Router();

// One-time verification handshake when you register the webhook URL with Meta.
webhookRouter.get('/instagram', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.verifyToken) {
    return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
  }
  return res.sendStatus(403);
});

// Raw body is needed to check the signature, so this route parses JSON itself.
webhookRouter.post('/instagram', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (config.appSecret && !verifySignature(raw, req.get('x-hub-signature-256'), config.appSecret)) {
    return res.sendStatus(401);
  }
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.sendStatus(400);
  }

  const events = parseInstagramWebhook(body);
  let stored = 0;
  let duplicates = 0;
  let failed = 0;
  for (const event of events) {
    try {
      const result = await ingestInbound(event);
      if (result.duplicate) duplicates += 1;
      else stored += 1;
    } catch (err) {
      failed += 1;
      console.error('[webhook] failed to store message', event.mid, err);
    }
  }
  // A non-2xx response makes Meta retry, which is what we want if storing failed.
  res.status(failed ? 500 : 200).json({ received: events.length, stored, duplicates, failed });
});
