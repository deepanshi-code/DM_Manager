// Phase 4: real Instagram delivery, replies typed in the Instagram app (echoes),
// username lookup, and agent login. No network: Meta's API is replaced by fakes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { initDb, getDb } from '../src/db.js';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { setSender } from '../src/senders/index.js';
import { createInstagramClient, InstagramApiError } from '../src/instagram/client.js';
import { enrichProfiles, setProfileLookup } from '../src/services/profiles.js';
import { createAgent, hashPassword, verifyPassword, resetLoginThrottle } from '../src/auth.js';
import {
  ingestInbound,
  ingestEcho,
  sendReply,
  getConversation,
  INSTAGRAM_APP_AGENT,
} from '../src/services/conversations.js';

const uid = () => `p4_${crypto.randomUUID().slice(0, 8)}`;
const mid = () => `m_${crypto.randomUUID()}`;

let server;
let base;
// One hook, so the database exists before agents are created.
before(async () => {
  await initDb({ dataDir: 'memory://' });
  setSender({ send: async () => ({ mid: mid() }) });
  config.auth = true;
  await createAgent('Asha', 'asha-password-1');
  await createAgent('Rohan', 'rohan-password-1');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

// ---------- Instagram API client ----------

function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  };
  fn.calls = calls;
  return fn;
}
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

test('sendText posts to the messages endpoint with the token in a header, not the URL', async () => {
  const fetch = fakeFetch(() => json(200, { recipient_id: '42', message_id: 'mid.abc' }));
  const ig = createInstagramClient({ accessToken: 'SECRET', userId: '1784', version: 'v23.0', fetch });
  const out = await ig.sendText('42', 'Hello!');

  assert.deepEqual(out, { mid: 'mid.abc', recipientId: '42' });
  const { url, init } = fetch.calls[0];
  assert.equal(url, 'https://graph.instagram.com/v23.0/1784/messages');
  assert.ok(!url.includes('SECRET'));
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, 'Bearer SECRET');
  assert.deepEqual(JSON.parse(init.body), { recipient: { id: '42' }, message: { text: 'Hello!' } });
});

test('API errors carry Meta\'s message and say whether a retry makes sense', async () => {
  const bad = createInstagramClient({
    accessToken: 't',
    fetch: fakeFetch(() => json(400, { error: { message: 'Outside of allowed window', code: 10, error_subcode: 2534022 } })),
  });
  await assert.rejects(bad.sendText('1', 'hi'), (err) => {
    assert.ok(err instanceof InstagramApiError);
    assert.equal(err.message, 'Outside of allowed window');
    assert.equal(err.code, 10);
    assert.equal(err.retryable, false);
    return true;
  });

  const down = createInstagramClient({ accessToken: 't', fetch: fakeFetch(() => json(503, {})) });
  await assert.rejects(down.sendText('1', 'hi'), (err) => err.retryable === true);

  const offline = createInstagramClient({ accessToken: 't', fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(offline.sendText('1', 'hi'), /unreachable/);

  const noToken = createInstagramClient({ accessToken: '' });
  await assert.rejects(noToken.sendText('1', 'hi'), /IG_ACCESS_TOKEN/);
});

test('getProfile asks only for username and name', async () => {
  const fetch = fakeFetch(() => json(200, { username: 'riya_shop', name: 'Riya', id: '42' }));
  const ig = createInstagramClient({ accessToken: 't', fetch });
  assert.deepEqual(await ig.getProfile('42'), { username: 'riya_shop', name: 'Riya' });
  assert.match(fetch.calls[0].url, /\/42\?fields=username%2Cname$/);
});

// ---------- Replies typed in the Instagram app (echo webhooks) ----------

test('a reply typed in the Instagram app clears the reply timer', async () => {
  const igUserId = uid();
  const t0 = Date.now() - 10 * 60_000;
  const { conversationId } = await ingestInbound({ igUserId, mid: mid(), text: 'price?', timestamp: t0 });

  const echo = await ingestEcho({ igUserId, mid: mid(), text: 'It is 499', timestamp: t0 + 120_000 });
  assert.equal(echo.duplicate, false);
  assert.equal(echo.status, 'WAITING_ON_CUSTOMER');

  const conv = await getConversation(conversationId);
  assert.equal(conv.needs_reply_since, null);
  assert.equal(conv.is_overdue, false);
  assert.equal(conv.last_message_preview, 'You: It is 499');
  const out = conv.messages.find((m) => m.direction === 'OUTBOUND');
  assert.equal(out.sent_by, INSTAGRAM_APP_AGENT);
  assert.equal(out.response_seconds, 120);
});

test('the echo of a dashboard reply is not counted twice', async () => {
  const igUserId = uid();
  const { conversationId } = await ingestInbound({ igUserId, mid: mid(), text: 'size M?' });
  const sentMid = mid();
  setSender({ send: async () => ({ mid: sentMid }) });
  try {
    await sendReply(conversationId, 'Yes, M is in stock', 'Asha');
  } finally {
    setSender({ send: async () => ({ mid: mid() }) });
  }
  const echo = await ingestEcho({ igUserId, mid: sentMid, text: 'Yes, M is in stock' });
  assert.equal(echo.duplicate, true);
  const outbound = (await getConversation(conversationId)).messages.filter((m) => m.direction === 'OUTBOUND');
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].sent_by, 'Asha');
});

test('an echo that arrives before the send finishes is merged into the agent\'s reply', async () => {
  const igUserId = uid();
  const { conversationId } = await ingestInbound({ igUserId, mid: mid(), text: 'COD?', timestamp: Date.now() - 60_000 });
  const sentMid = mid();
  // Meta can deliver the echo webhook before its API call has returned to us.
  setSender({
    send: async ({ recipientId, text }) => {
      await ingestEcho({ igUserId: recipientId, mid: sentMid, text });
      return { mid: sentMid };
    },
  });
  try {
    const reply = await sendReply(conversationId, 'Yes, COD is available', 'Rohan');
    assert.ok(reply.responseSeconds >= 59);
  } finally {
    setSender({ send: async () => ({ mid: mid() }) });
  }
  const conv = await getConversation(conversationId);
  const outbound = conv.messages.filter((m) => m.direction === 'OUTBOUND');
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].sent_by, 'Rohan');
  assert.equal(outbound[0].delivery_status, 'SENT');
  assert.equal(conv.needs_reply_since, null);
});

test('a customer message sent after the Instagram-app reply still needs a reply', async () => {
  const igUserId = uid();
  const t0 = Date.now() - 30 * 60_000;
  const { conversationId } = await ingestInbound({ igUserId, mid: mid(), text: 'hi', timestamp: t0 });
  const later = t0 + 10 * 60_000;
  await ingestInbound({ igUserId, mid: mid(), text: 'also, do you ship to Pune?', timestamp: later });
  // Webhooks can arrive out of order: the echo (sent between the two) is processed last.
  await ingestEcho({ igUserId, mid: mid(), text: 'Hello!', timestamp: t0 + 5 * 60_000 });

  const conv = await getConversation(conversationId);
  assert.equal(new Date(conv.needs_reply_since).getTime(), later);
  assert.notEqual(conv.status, 'WAITING_ON_CUSTOMER');
  assert.ok(conv.unread_count > 0);
});

test('a message the business starts creates the conversation without a reply timer', async () => {
  const igUserId = uid();
  const echo = await ingestEcho({ igUserId, mid: mid(), text: 'Thanks for following us!' });
  const conv = await getConversation(echo.conversationId);
  assert.equal(conv.needs_reply_since, null);
  assert.equal(conv.status, 'WAITING_ON_CUSTOMER');
});

// ---------- Username lookup ----------

test('usernames are looked up once, and failures back off', async () => {
  const known = uid();
  const failing = uid();
  await ingestInbound({ igUserId: known, mid: mid(), text: 'hi' });
  await ingestInbound({ igUserId: failing, mid: mid(), text: 'hello' });
  const asked = [];
  setProfileLookup(async (id) => {
    asked.push(id);
    if (id === failing) throw new Error('blocked');
    return { username: 'neha_store' };
  });
  try {
    const now = Date.now();
    assert.deepEqual(await enrichProfiles([known, failing], now), { updated: 1, failed: 1 });
    // Second round: the known one already has a name; the failed one is inside its back-off window.
    assert.deepEqual(await enrichProfiles([known, failing], now + 1000), { updated: 0, failed: 0 });
    assert.deepEqual(asked, [known, failing]);
  } finally {
    setProfileLookup(null);
  }
  const { rows } = await getDb().query(`SELECT username FROM contacts WHERE ig_user_id = $1`, [known]);
  assert.equal(rows[0].username, 'neha_store');
});

// ---------- Agent login ----------

test('passwords are stored as salted scrypt hashes', async () => {
  const a = await hashPassword('correct horse battery');
  const b = await hashPassword('correct horse battery');
  assert.notEqual(a, b);
  assert.ok(!a.includes('correct'));
  assert.equal(await verifyPassword('correct horse battery', a), true);
  assert.equal(await verifyPassword('wrong password!!', a), false);
});

after(() => {
  server?.close();
  config.auth = false;
});

const call = (path, { method = 'GET', body, cookie, type = 'application/json' } = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': type } : {}), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

async function signIn(name, password) {
  const res = await call('/auth/login', { method: 'POST', body: { name, password } });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  return setCookie.split(';')[0];
}

test('the API requires a signed-in agent', async () => {
  resetLoginThrottle();
  assert.equal((await call('/conversations')).status, 401);
  assert.equal((await call('/labels.csv')).status, 401);
  const me = await (await call('/auth/me')).json();
  assert.deepEqual(me, { required: true, agent: null });
});

test('login, act as yourself, logout', async () => {
  resetLoginThrottle();
  assert.equal((await call('/auth/login', { method: 'POST', body: { name: 'Asha', password: 'nope-nope-nope' } })).status, 401);
  assert.equal((await call('/auth/login', { method: 'POST', body: { name: 'Nobody', password: 'asha-password-1' } })).status, 401);

  const cookie = await signIn('asha', 'asha-password-1'); // name is case-insensitive
  const meta = await (await call('/meta', { cookie })).json();
  assert.equal(meta.auth.agent, 'Asha');
  assert.deepEqual(meta.agents, ['Asha', 'Rohan']);

  // The body says "Rohan", but the session says Asha: the session wins.
  const { conversationId } = await ingestInbound({ igUserId: uid(), mid: mid(), text: 'price?' });
  const res = await call(`/conversations/${conversationId}/reply`, {
    method: 'POST', cookie, body: { text: 'It is 499', agent: 'Rohan' },
  });
  assert.equal(res.status, 201);
  const conv = await getConversation(conversationId);
  assert.equal(conv.messages.find((m) => m.direction === 'OUTBOUND').sent_by, 'Asha');
  assert.equal(conv.assignee, 'Asha');

  // Only real accounts can be assigned.
  const bad = await call(`/conversations/${conversationId}/assignee`, { method: 'PATCH', cookie, body: { assignee: 'Meera' } });
  assert.equal(bad.status, 400);

  assert.equal((await call('/auth/logout', { method: 'POST', cookie, body: {} })).status, 200);
  assert.equal((await call('/conversations', { cookie })).status, 401);
});

test('changes must be sent as JSON (blocks cross-site form posts)', async () => {
  resetLoginThrottle();
  const cookie = await signIn('Rohan', 'rohan-password-1');
  const res = await call('/conversations/1/status', { method: 'PATCH', cookie, body: 'status=RESOLVED', type: 'application/x-www-form-urlencoded' });
  assert.equal(res.status, 415);
});

test('repeated wrong passwords are throttled', async () => {
  resetLoginThrottle();
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await call('/auth/login', { method: 'POST', body: { name: 'Rohan', password: 'guess-guess-' + i } })).status, 401);
  }
  const blocked = await call('/auth/login', { method: 'POST', body: { name: 'Rohan', password: 'rohan-password-1' } });
  assert.equal(blocked.status, 429);
  resetLoginThrottle();
});
