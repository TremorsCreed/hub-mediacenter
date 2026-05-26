"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.initDb = initDb;
const client_1 = require("@libsql/client");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const DB_PATH = process.env.DB_PATH || path_1.default.join(process.cwd(), 'data', 'hub.db');
const dir = path_1.default.dirname(DB_PATH);
if (!fs_1.default.existsSync(dir))
    fs_1.default.mkdirSync(dir, { recursive: true });
exports.db = (0, client_1.createClient)({ url: `file:${DB_PATH}` });
async function initDb() {
    await exports.db.executeMultiple(`
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
  `);
}
