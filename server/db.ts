import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const path = process.env.DB_PATH ?? 'server/data/squeekverse.sqlite';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
export const db = new DatabaseSync(path);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, token TEXT NOT NULL, name TEXT NOT NULL, wallet TEXT, crew TEXT, seeds INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rounds (round INTEGER PRIMARY KEY, work INTEGER NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT NOT NULL, round INTEGER NOT NULL, score INTEGER NOT NULL, flowers INTEGER NOT NULL, seeds INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS runs_round ON runs(round, score DESC);
CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT NOT NULL, kind TEXT NOT NULL, from_round INTEGER NOT NULL, target INTEGER NOT NULL, almanac INTEGER NOT NULL, stake INTEGER NOT NULL, actual INTEGER, points INTEGER, almanac_points INTEGER, created_at INTEGER NOT NULL, UNIQUE(player, from_round, kind));
CREATE TABLE IF NOT EXISTS names (token_id INTEGER PRIMARY KEY, name TEXT NOT NULL, owner TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chronicle (from_round INTEGER PRIMARY KEY, kind TEXT NOT NULL, to_round INTEGER NOT NULL, work INTEGER NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
`);
export const get = <T>(sql: string, ...args: (string | number | null)[]) => db.prepare(sql).get(...args) as T | undefined;
export const all = <T>(sql: string, ...args: (string | number | null)[]) => db.prepare(sql).all(...args) as T[];
export const run = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).run(...args);
