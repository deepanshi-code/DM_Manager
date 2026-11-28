// Agent accounts and login sessions.
//
// - Passwords: scrypt with a random salt per password (Node's built-in crypto, no dependency).
// - Sessions: a random 256-bit token in an HttpOnly cookie. Only its SHA-256 is stored, so a
//   leaked database cannot be used to log in.
// - When AUTH=on, the server decides who is acting (from the session); the browser can no
//   longer claim to be another agent. AUTH=off keeps the old "pick a name" demo mode.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { getDb } from './db.js';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const COOKIE = 'dm_session';
export const MIN_PASSWORD = 10;
const NAME_RE = /^[A-Za-z][A-Za-z0-9 ._-]{0,39}$/;

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(actual, expected);
}

// Used when the name doesn't exist, so "unknown user" and "wrong password" take the same time.
const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'));

export const generatePassword = () => crypto.randomBytes(12).toString('base64url'); // 16 chars

function checkName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name.trim())) {
    throw new AuthError(400, 'Name must start with a letter and use at most 40 letters, digits, spaces, . _ -');
  }
  return name.trim();
}
function checkPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new AuthError(400, `Password must be at least ${MIN_PASSWORD} characters`);
  }
  return password;
}

export async function createAgent(name, password) {
  const clean = checkName(name);
  const hash = await hashPassword(checkPassword(password));
  const { rows } = await getDb().query(
    `INSERT INTO agents (name, password_hash) VALUES ($1, $2)
     ON CONFLICT (name) DO NOTHING RETURNING id, name`,
    [clean, hash],
  );
  if (!rows[0]) throw new AuthError(409, `Agent "${clean}" already exists`);
  return rows[0];
}

export async function setPassword(name, password) {
  const hash = await hashPassword(checkPassword(password));
  const db = getDb();
  const { rows } = await db.query(`UPDATE agents SET password_hash = $2 WHERE name = $1 RETURNING id`, [name, hash]);
  if (!rows[0]) throw new AuthError(404, `No agent named "${name}"`);
  await db.query(`DELETE FROM sessions WHERE agent_id = $1`, [rows[0].id]); // log out everywhere
}

export async function setAgentActive(name, active) {
  const db = getDb();
  const { rows } = await db.query(`UPDATE agents SET active = $2 WHERE name = $1 RETURNING id`, [name, active]);
  if (!rows[0]) throw new AuthError(404, `No agent named "${name}"`);
  if (!active) await db.query(`DELETE FROM sessions WHERE agent_id = $1`, [rows[0].id]);
}

export async function listAgents() {
  return (await getDb().query(`SELECT name, active, created_at FROM agents ORDER BY name`)).rows;
}

/** Names that can be assigned chats: real accounts when login is on, AGENTS env otherwise. */
export async function agentNames() {
  if (!config.auth) return config.agents;
  return (await getDb().query(`SELECT name FROM agents WHERE active ORDER BY name`)).rows.map((r) => r.name);
}

// ---------- Login throttling (in memory; enough for one server process) ----------
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_NAME = 5;   // failed attempts for one name from one address
const MAX_PER_IP = 20;    // failed attempts from one address, any name
const failures = new Map();

const MAX_TRACKED = 10_000; // memory bound for the failure map

function tooMany(key, max, now) {
  const f = failures.get(key);
  return f && now - f.first < WINDOW_MS && f.count >= max;
}
function recordFailure(key, now) {
  const f = failures.get(key);
  if (!f || now - f.first >= WINDOW_MS) failures.set(key, { first: now, count: 1 });
  else f.count += 1;
}
function forgetOne(key) {
  const f = failures.get(key);
  if (!f) return;
  f.count -= 1;
  if (f.count <= 0) failures.delete(key);
}
/** Drop expired entries; if still too many (an attack), drop the oldest. */
function pruneFailures(now) {
  if (failures.size < 1000) return;
  for (const [k, f] of failures) if (now - f.first >= WINDOW_MS) failures.delete(k);
  while (failures.size > MAX_TRACKED) failures.delete(failures.keys().next().value);
}
export function resetLoginThrottle() {
  failures.clear();
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export async function login(name, password, ip = '?', now = Date.now()) {
  // Only plausible names become map keys (a real name is at most 40 characters), so the
  // failure map can't be filled with huge or endless random keys.
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const validName = NAME_RE.test(cleanName);
  const nameKey = `${ip}|${validName ? cleanName.toLowerCase() : '*invalid*'}`;
  pruneFailures(now);
  if (tooMany(nameKey, MAX_PER_NAME, now) || tooMany(ip, MAX_PER_IP, now)) {
    throw new AuthError(429, 'Too many failed attempts. Try again in 15 minutes.');
  }
  // Reserve this attempt before any await: parallel guesses each count immediately, so they
  // can't all pass the check above before the first failure is recorded. Undone on success.
  recordFailure(nameKey, now);
  recordFailure(ip, now);

  const db = getDb();
  const agent = validName
    ? (await db.query(`SELECT id, name, password_hash, active FROM agents WHERE lower(name) = lower($1)`, [cleanName])).rows[0]
    : undefined;
  const ok = await verifyPassword(typeof password === 'string' ? password : '', agent?.password_hash ?? DUMMY_HASH);
  if (!agent || !ok || !agent.active) {
    throw new AuthError(401, 'Wrong name or password');
  }
  failures.delete(nameKey);
  forgetOne(ip);

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now + config.sessionHours * 3600 * 1000);
  await db.query(`DELETE FROM sessions WHERE expires_at < now()`); // housekeeping
  await db.query(`INSERT INTO sessions (token_hash, agent_id, expires_at) VALUES ($1, $2, $3)`, [
    sha256(token),
    agent.id,
    expiresAt.toISOString(),
  ]);
  return { token, agent: agent.name, expiresAt };
}

export async function sessionAgent(token) {
  if (!token) return null;
  const { rows } = await getDb().query(
    `SELECT a.name FROM sessions s JOIN agents a ON a.id = s.agent_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND a.active`,
    [sha256(token)],
  );
  return rows[0]?.name ?? null;
}

export async function logout(token) {
  if (token) await getDb().query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
}

export function readCookie(req, name = COOKIE) {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(req, token, expiresAt) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (expiresAt) attrs.push(`Max-Age=${Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))}`);
  else attrs.push('Max-Age=0');
  if (req.secure) attrs.push('Secure'); // HTTPS (behind a proxy, set TRUST_PROXY)
  return attrs.join('; ');
}
