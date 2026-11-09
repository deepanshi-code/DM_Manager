// Small database wrapper so the rest of the code doesn't care whether we run on
// embedded PGlite (zero-install, for development) or a real PostgreSQL server.
// Both expose: query(sql, params) -> { rows }, tx(fn), close().
import { readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { config } from './config.js';

let db = null;

function wrapPg(pool) {
  return {
    kind: 'postgres',
    query: (sql, params) => pool.query(sql, params),
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (sql, params) => client.query(sql, params) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

function wrapPglite(lite) {
  return {
    kind: 'pglite',
    query: (sql, params) => lite.query(sql, params),
    exec: (sql) => lite.exec(sql),
    tx: (fn) => lite.transaction((tx) => fn({ query: (sql, params) => tx.query(sql, params) })),
    close: () => lite.close(),
  };
}

/** @param {{ dataDir?: string }} [options] dataDir 'memory://' gives a throwaway DB (tests). */
export async function initDb(options = {}) {
  if (config.databaseUrl && !options.dataDir) {
    db = wrapPg(new pg.Pool({ connectionString: config.databaseUrl }));
  } else {
    const dataDir = options.dataDir ?? config.pgliteDir;
    // PGlite only creates the last folder level, so make sure the parents exist.
    if (!dataDir.includes('://')) await mkdir(dirname(dataDir), { recursive: true });
    const lite = new PGlite(dataDir);
    await lite.waitReady;
    db = wrapPglite(lite);
  }
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.exec(schema);
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialised: call initDb() first');
  return db;
}
