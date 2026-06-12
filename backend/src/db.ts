import { createClient, Client } from '@libsql/client'
import path from 'path'
import fs from 'fs'
import { hashPin } from './auth'

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
      title TEXT,
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
      xtream_credential_id INTEGER,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS lb_games (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT '',
      publisher TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_lb_games_platform ON lb_games(platform);
    CREATE INDEX IF NOT EXISTS idx_lb_games_title ON lb_games(title);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      avatar_color TEXT NOT NULL DEFAULT '#f59e0b',
      is_admin INTEGER NOT NULL DEFAULT 0,
      pin_hash TEXT,
      created_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      app TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      ref_type TEXT,
      title TEXT,
      thumb TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, app, ref_id)
    );

    CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);

    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      cover TEXT,
      is_shared INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS playlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      app TEXT NOT NULL DEFAULT 'unresolved',
      ref_id TEXT,
      ref_type TEXT,
      title TEXT,
      year INTEGER,
      thumb TEXT,
      lang TEXT,
      status TEXT NOT NULL DEFAULT 'resolved',
      created_at INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_items_pl ON playlist_items(playlist_id, position);

    CREATE TABLE IF NOT EXISTS epg_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      cred_id INTEGER,
      stream_id TEXT NOT NULL,
      channel_name TEXT,
      title TEXT,
      start_ts INTEGER NOT NULL,
      device_id TEXT,
      lead_min INTEGER NOT NULL DEFAULT 5,
      notified INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_due ON epg_reminders(notified, start_ts);

    -- Préférences de catégories IPTV : masquer (déclutter) ou verrouiller (parental).
    -- scope = 'global' (base posée par l'admin) ou un user_id en texte (surcharge par
    -- profil). État effectif = fusion, le plus restrictif gagne (hidden > locked).
    -- Absence de ligne = catégorie visible.
    CREATE TABLE IF NOT EXISTS iptv_category_prefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cred_id INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      category_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      state TEXT NOT NULL CHECK (state IN ('hidden','locked')),
      UNIQUE(cred_id, content_type, category_id, scope)
    );
  `)

  // Migrations idempotentes (ALTER TABLE échoue silencieusement si la colonne existe)
  try { await db.execute("ALTER TABLE device_config ADD COLUMN xtream_credential_id INTEGER") } catch {}
  try { await db.execute("ALTER TABLE playback_state ADD COLUMN title TEXT") } catch {}
  try { await db.execute("ALTER TABLE device_config ADD COLUMN tvoverlay_enabled INTEGER NOT NULL DEFAULT 0") } catch {}
  try { await db.execute("ALTER TABLE device_config ADD COLUMN overlay_player_duration INTEGER NOT NULL DEFAULT 0") } catch {}
  // Lecteur IPTV préféré par device : 'auto' | 'mxplayer' | 'vlc' | 'tivimate'
  try { await db.execute("ALTER TABLE device_config ADD COLUMN iptv_player TEXT NOT NULL DEFAULT 'auto'") } catch {}
  try { await db.execute("ALTER TABLE playback_history ADD COLUMN user_id INTEGER") } catch {}
  // Carte NFC Zaparoo → profil (groundwork ; logique de session dans le sprint Zaparoo)
  try { await db.execute("ALTER TABLE users ADD COLUMN nfc_token TEXT") } catch {}
  try { await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nfc ON users(nfc_token) WHERE nfc_token IS NOT NULL") } catch {}
  // Langue préférée du profil (matching des imports de playlists IPTV/Plex)
  try { await db.execute("ALTER TABLE users ADD COLUMN preferred_lang TEXT NOT NULL DEFAULT 'FR'") } catch {}
  // Défauts par profil : device cible (présélectionné à l'activation du profil)
  // et lecteur IPTV (prime sur le réglage du device s'il est défini)
  try { await db.execute("ALTER TABLE users ADD COLUMN default_device_id TEXT") } catch {}
  try { await db.execute("ALTER TABLE users ADD COLUMN default_player TEXT") } catch {}
  // Extension de conteneur (épisodes IPTV séries, pour la relecture depuis une playlist)
  try { await db.execute("ALTER TABLE playlist_items ADD COLUMN ext TEXT") } catch {}
  // Logo de la chaîne pour l'overlay de rappel EPG (carte du bas)
  try { await db.execute("ALTER TABLE epg_reminders ADD COLUMN logo TEXT") } catch {}

  // ── Spotify : un compte Spotify lié par profil hub ───────────────────────────
  // Le token « suit le profil actif » (cf. design Spotify). user_id = id du profil hub,
  // ou MAISON_USER_ID (-1) pour le compte « Maison » dédié aux enceintes partagées
  // (Echo) — découplé du compte perso de l'admin pour ne plus polluer ses recos.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS spotify_accounts (
      user_id INTEGER PRIMARY KEY,
      spotify_user_id TEXT,
      display_name TEXT,
      email TEXT,
      product TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL DEFAULT 0,
      scopes TEXT NOT NULL DEFAULT '',
      image TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `)

  // Seed : crée un profil Admin par défaut (PIN 0000) si aucun utilisateur n'existe.
  const { rows: userCount } = await db.execute("SELECT COUNT(*) as n FROM users")
  if (Number((userCount[0] as any).n) === 0) {
    await db.execute({
      sql: "INSERT INTO users (name, avatar_color, is_admin, pin_hash, created_at) VALUES (?, ?, 1, ?, ?)",
      args: ['Admin', '#f59e0b', hashPin('0000'), Date.now()]
    })
    console.log('[db] Profil Admin créé (PIN par défaut: 0000 — à changer dans Admin → Profils)')
  }
}
