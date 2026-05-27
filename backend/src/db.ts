import { createClient, Client } from '@libsql/client'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'hub.db')
const dir = path.dirname(DB_PATH)
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

export const db: Client = createClient({ url: `file:${DB_PATH}` })

export async function initDb() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      ip TEXT,
      last_seen INTEGER NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS catalog (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      ean TEXT,
      year INTEGER,
      plex_id TEXT,
      tivimate_id TEXT,
      thumbnail TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_catalog_ean ON catalog(ean);
    CREATE INDEX IF NOT EXISTS idx_catalog_title ON catalog(title);

    CREATE TABLE IF NOT EXISTS ean_mappings (
      ean TEXT PRIMARY KEY,
      catalog_id TEXT NOT NULL,
      FOREIGN KEY (catalog_id) REFERENCES catalog(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS playback_state (
      device_id TEXT PRIMARY KEY,
      catalog_id TEXT,
      app TEXT,
      status TEXT NOT NULL DEFAULT 'stopped',
      started_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS playback_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      catalog_id TEXT,
      app TEXT,
      title TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      requester TEXT NOT NULL DEFAULT 'manual'
    );

    CREATE TABLE IF NOT EXISTS device_config (
      device_id TEXT PRIMARY KEY,
      xtream_server TEXT NOT NULL DEFAULT '',
      xtream_user TEXT NOT NULL DEFAULT '',
      xtream_pass TEXT NOT NULL DEFAULT '',
      xtream_ext TEXT NOT NULL DEFAULT 'ts',
      plex_server_id TEXT NOT NULL DEFAULT '',
      app_mappings TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS plex_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      client_id TEXT NOT NULL DEFAULT '',
      auth_token TEXT NOT NULL DEFAULT '',
      server_url TEXT NOT NULL DEFAULT '',
      server_machine_id TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO plex_config (id) VALUES (1);
  `)
}
