// End-to-end over real HTTP: the webhook endpoint (as Meta calls it) and every dashboard
// API route, plus the security checks that only make sense at the HTTP layer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { initDb } from '../src/db.js';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { setSender } from '../src/senders/index.js';
import { seedSavedReplies } from '../src/services/savedReplies.js';
import { markOverdue } from '../src/scheduler.js';

const SECRET = 'test-app-secret';
let server;
let base;

before(async () => {
  await initDb({ dataDir: 'memory://' });
  await seedSavedReplies();
  setSender({ send: async () => ({ mid: `out_${crypto.randomUUID()}` }) });
  config.auth = false;
  config.appSecret = SECRET;
  config.verifyToken = 'verify-me';
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  config.appSecret = '';
});

const sign = (body) => `sha256=${crypto.createHmac('sha256', SECRET).update(body).digest('hex')}`;

function webhookBody(messages) {
  return JSON.stringify({
    object: 'instagram',
    entry: [{
      id: 'biz', time: Date.now(),
      messaging: messages.map((m) => ({
        sender: { id: m.from ?? 'biz' }, recipient: { id: m.to ?? 'biz' }, timestamp: m.at ?? Date.now(),
        message: { mid: m.mid ?? `mid_${crypto.randomUUID()}`, text: m.text, ...(m.echo ? { is_echo: true } : {}) },
      })),
    }],
  });
}

async function postWebhook(body, signature = sign(body)) {
  return fetch(`${base}/webhook/instagram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) },
    body,
  });
}

const api = async (path, { method = 'GET', body, type = 'application/json' } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': type } : {},
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* CSV or empty */ }
  return { status: res.status, json, text };
};

// ---------- Webhook ----------

test('webhook verification handshake answers only with the right token', async () => {
  const ok = await fetch(`${base}/webhook/instagram?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '12345');
  const bad = await fetch(`${base}/webhook/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`);
  assert.equal(bad.status, 403);
});

test('webhooks with a missing or wrong signature are rejected and store nothing', async () => {
  const body = webhookBody([{ from: 'attacker_1', text: 'fake message' }]);
  assert.equal((await postWebhook(body, null)).status, 401);
  assert.equal((await postWebhook(body, 'sha256=' + '0'.repeat(64))).status, 401);
  // Signed for a different body (tampered in transit)
  assert.equal((await postWebhook(body, sign(body + ' '))).status, 401);
  const { json } = await api('/conversations?filter=ALL&q=fake%20message');
  assert.equal(json.length, 0);
});

test('malformed JSON with a valid signature gets 400', async () => {
  const body = '{not json';
  assert.equal((await postWebhook(body)).status, 400);
});

test('a signed webhook is stored once even when Meta retries it', async () => {
  const body = webhookBody([{ from: 'cust_retry', mid: 'mid_retry_1', text: 'is COD available?' }]);
  const first = await (await postWebhook(body)).json();
  const again = await (await postWebhook(body)).json();
  assert.deepEqual([first.stored, first.duplicates], [1, 0]);
  assert.deepEqual([again.stored, again.duplicates], [0, 1]);
});

// ---------- Full agent flow over the API ----------

test('full flow: DM arrives -> agent opens, uses a saved reply, notes, reminder -> report', async () => {
  await postWebhook(webhookBody([{ from: 'cust_flow', text: 'Where is my order 77123? It has been 6 days' }]));
  const list = (await api('/conversations?filter=NEEDS_REPLY')).json;
  const conv = list.find((c) => c.ig_user_id === 'cust_flow');
  assert.ok(conv, 'new DM is in "To reply"');

  assert.equal((await api(`/conversations/${conv.id}/read`, { method: 'POST', body: { agent: 'Asha' } })).json.status, 'OPEN');
  const detail = (await api(`/conversations/${conv.id}?agent=Asha`)).json;
  assert.equal(detail.intent, 'order_status');
  assert.deepEqual(detail.details.orderNumbers, ['77123']);
  const suggestion = detail.suggestedReplies[0];
  assert.equal(suggestion.intent, 'order_status');

  const reply = await api(`/conversations/${conv.id}/reply`, {
    method: 'POST', body: { text: suggestion.text, agent: 'Asha', savedReplyId: suggestion.id },
  });
  assert.equal(reply.status, 201);
  assert.equal(reply.json.status, 'WAITING_ON_CUSTOMER');

  assert.equal((await api(`/conversations/${conv.id}/notes`, { method: 'POST', body: { body: 'Courier says Friday', agent: 'Asha' } })).status, 201);
  const at = new Date(Date.now() + 3600_000).toISOString();
  assert.equal((await api(`/conversations/${conv.id}/reminder`, { method: 'PUT', body: { remindAt: at, agent: 'Asha' } })).json.remindAt, at);
  assert.equal((await api(`/conversations/${conv.id}/assignee`, { method: 'PATCH', body: { assignee: 'Asha' } })).status, 200);
  assert.ok((await api('/conversations?filter=MINE&agent=Asha')).json.some((c) => c.id === conv.id));

  const stats = (await api('/stats?agent=Asha')).json;
  assert.ok(stats.templates.repliesWithTemplate >= 1);
  assert.ok(stats.team.some((t) => t.agent === 'Asha'));

  const report = await api('/report.csv');
  assert.equal(report.status, 200);
  assert.ok(report.text.split('\n').some((l) => l.startsWith(`${conv.id},`)));
  assert.ok(!report.text.includes('Courier says Friday')); // notes and message text never in the report

  const labels = await api('/labels.csv');
  assert.match(labels.text, /^id,text,intent/);

  assert.equal((await api(`/conversations/${conv.id}/status`, { method: 'PATCH', body: { status: 'RESOLVED', agent: 'Asha' } })).status, 200);
});

test('a reply typed in the Instagram app (echo) answers the customer over the webhook too', async () => {
  await postWebhook(webhookBody([{ from: 'cust_phone', text: 'price of the tote bag?' }]));
  let conv = (await api('/conversations?filter=NEEDS_REPLY')).json.find((c) => c.ig_user_id === 'cust_phone');
  assert.ok(conv);
  await postWebhook(webhookBody([{ to: 'cust_phone', echo: true, text: 'It is 499!' }]));
  conv = (await api('/conversations?filter=NEEDS_REPLY')).json.find((c) => c.ig_user_id === 'cust_phone');
  assert.equal(conv, undefined);
});

test('saved replies CRUD over HTTP', async () => {
  const created = await api('/saved-replies', { method: 'POST', body: { title: 'Gift wrap', body: 'Hi {name}! Gift wrap is free.', intent: '' } });
  assert.equal(created.status, 201);
  const updated = await api(`/saved-replies/${created.json.id}`, { method: 'PUT', body: { title: 'Gift wrap', body: 'Hi {name}! Gift wrap costs [price].', intent: 'price' } });
  assert.equal(updated.json.intent, 'price');
  assert.equal((await api(`/saved-replies/${created.json.id}`, { method: 'DELETE', body: {} })).status, 200);
  assert.equal((await api(`/saved-replies/${created.json.id}`, { method: 'DELETE', body: {} })).status, 404);
});

test('bulk actions over HTTP', async () => {
  await postWebhook(webhookBody([{ from: 'spam_a', text: 'earn 5000 daily dm me' }, { from: 'spam_b', text: 'follow for follow' }]));
  const ids = (await api('/conversations?filter=ALL')).json.filter((c) => c.ig_user_id.startsWith('spam_')).map((c) => c.id);
  const r = await api('/conversations/bulk', { method: 'POST', body: { ids, action: 'spam', agent: 'Meera' } });
  assert.equal(r.json.done, 2);
});

// ---------- Security and robustness at the HTTP layer ----------

test('HTML/script in a customer message is stored as plain text, never interpreted', async () => {
  const evil = '<img src=x onerror=alert(1)><script>alert("x")</script>';
  await postWebhook(webhookBody([{ from: 'cust_xss', text: evil }]));
  const conv = (await api('/conversations?filter=ALL')).json.find((c) => c.ig_user_id === 'cust_xss');
  const detail = (await api(`/conversations/${conv.id}`)).json;
  assert.equal(detail.messages[0].body, evil); // stored verbatim; React renders it as text
  // The API answers JSON, so a browser never treats it as a page.
  const res = await fetch(`${base}/api/conversations/${conv.id}`);
  assert.match(res.headers.get('content-type'), /application\/json/);
});

test('search input is treated as data (no SQL injection), including % and quotes', async () => {
  for (const q of ["' OR 1=1 --", "%' ; DROP TABLE messages; --", '%', '_', '\\']) {
    const r = await api(`/conversations?filter=ALL&q=${encodeURIComponent(q)}`);
    assert.equal(r.status, 200, `query ${q}`);
    assert.ok(Array.isArray(r.json));
  }
  // % and _ are literal characters, not wildcards: they don't match every chat.
  assert.equal((await api(`/conversations?filter=ALL&q=${encodeURIComponent('%')}`)).json.length, 0);
  await postWebhook(webhookBody([{ from: 'cust_pct', text: 'is there 50% off today?' }]));
  assert.equal((await api(`/conversations?filter=ALL&q=${encodeURIComponent('50%')}`)).json.length, 1);
  // Tables still there:
  assert.equal((await api('/stats')).status, 200);
});

test('writes must be JSON (blocks cross-site form posts)', async () => {
  const r = await api('/conversations/1/status', { method: 'PATCH', body: 'status=RESOLVED', type: 'text/plain' });
  assert.equal(r.status, 415);
});

test('bad input gets clear 4xx errors, not crashes', async () => {
  assert.equal((await api('/conversations/abc')).status, 400);
  assert.equal((await api('/conversations/0')).status, 400);
  assert.equal((await api('/conversations/999999')).status, 404);
  assert.equal((await api('/conversations?filter=NOPE')).status, 400);
  assert.equal((await api('/conversations?intent=weather')).status, 400);
  assert.equal((await api('/conversations/1/reply', { method: 'POST', body: { text: '' } })).status, 400);
  assert.equal((await api('/conversations/1/reply', { method: 'POST', body: { text: 'x'.repeat(1001) } })).status, 400);
  assert.equal((await api('/conversations/1/status', { method: 'PATCH', body: { status: 'DELETED' } })).status, 400);
  assert.equal((await api('/messages/1/intent', { method: 'PATCH', body: { intent: 'nonsense' } })).status, 400);
  assert.equal((await api('/notes/abc', { method: 'DELETE', body: {} })).status, 400);
  assert.equal((await api('/conversations/1/notes', { method: 'POST', body: '{bad json' })).status, 400);
  // Oversized bodies are refused
  assert.equal((await api('/saved-replies', { method: 'POST', body: JSON.stringify({ title: 'x', body: 'y'.repeat(200_000) }) })).status, 413);
});

test('the overdue scheduler flags a chat once it passes the reply target', async () => {
  await postWebhook(webhookBody([{ from: 'cust_sla', text: 'hello?', at: Date.now() - 2 * 3600_000 }]));
  const ids = await markOverdue(new Date(), 3600);
  const conv = (await api('/conversations?filter=OVERDUE')).json.find((c) => c.ig_user_id === 'cust_sla');
  assert.ok(conv);
  assert.ok(ids.includes(conv.id));
  assert.deepEqual(await markOverdue(new Date(), 3600), []); // flagged once, not again
});

test('security headers are set, and customer data is never cached', async () => {
  const res = await fetch(`${base}/api/conversations?filter=ALL`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('health and meta endpoints', async () => {
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
  const meta = (await api('/meta')).json;
  assert.equal(meta.auth.required, false);
  assert.ok(meta.intents.includes('complaint'));
});
