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

    -- Suivi « vu » par profil : films, séries, saisons, épisodes, jeux. parent_id relie
    -- un épisode/saison à sa série (pour agréger plus tard côté algo de reco).
    CREATE TABLE IF NOT EXISTS watched (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      app TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      ref_type TEXT,
      title TEXT,
      thumb TEXT,
      parent_id TEXT,
      watched_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, app, ref_id)
    );

    CREATE INDEX IF NOT EXISTS idx_watched_user ON watched(user_id);

    -- « Favori du moment » / en cours : la série ou playlist que le profil suit en ce
    -- moment (épinglée manuellement), affichée dans une rangée dédiée du dashboard.
    -- key = 'playlist:<id>' ou '<app>:<ref_id>' (dédup par profil).
    CREATE TABLE IF NOT EXISTS current_picks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      kind TEXT NOT NULL,
      app TEXT,
      ref_id TEXT,
      playlist_id INTEGER,
      title TEXT,
      thumb TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_current_user ON current_picks(user_id);

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
    -- profil). La surcharge profil REMPLACE la base pour cette catégorie : 'visible'
    -- ré-affiche un groupe masqué/verrouillé globalement, 'hidden'/'locked' restreint
    -- plus. Absence de ligne = hérite (profil) / visible (global).
    CREATE TABLE IF NOT EXISTS iptv_category_prefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cred_id INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      category_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      state TEXT NOT NULL CHECK (state IN ('hidden','locked','visible')),
      UNIQUE(cred_id, content_type, category_id, scope)
    );
  `)

  // Migration : la première version de la table n'acceptait pas 'visible' dans le
  // CHECK. SQLite ne modifie pas une contrainte : on sonde avec un insert témoin
  // et on reconstruit la table si l'ancienne contrainte est encore en place.
  try {
    await db.execute("INSERT INTO iptv_category_prefs (cred_id, content_type, category_id, scope, state) VALUES (-999, 'live', '__probe__', 'global', 'visible')")
    await db.execute("DELETE FROM iptv_category_prefs WHERE cred_id = -999")
  } catch {
    await db.executeMultiple(`
      CREATE TABLE iptv_category_prefs_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cred_id INTEGER NOT NULL,
        content_type TEXT NOT NULL,
        category_id TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        state TEXT NOT NULL CHECK (state IN ('hidden','locked','visible')),
        UNIQUE(cred_id, content_type, category_id, scope)
      );
      INSERT INTO iptv_category_prefs_v2 (id, cred_id, content_type, category_id, scope, state)
        SELECT id, cred_id, content_type, category_id, scope, state FROM iptv_category_prefs;
      DROP TABLE iptv_category_prefs;
      ALTER TABLE iptv_category_prefs_v2 RENAME TO iptv_category_prefs;
    `)
  }

  // Migrations idempotentes (ALTER TABLE échoue silencieusement si la colonne existe)
  try { await db.execute("ALTER TABLE device_config ADD COLUMN xtream_credential_id INTEGER") } catch {}
  try { await db.execute("ALTER TABLE playback_state ADD COLUMN title TEXT") } catch {}
  // Miniature du média en cours (URL absolue déjà proxifiée) — affichée dans la barre
  // « lecture en cours » quand la MediaSession ne fournit pas d'art (cas Just Player/IPTV).
  try { await db.execute("ALTER TABLE playback_state ADD COLUMN thumb TEXT") } catch {}
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
  // Autoplay de l'épisode suivant des séries (compte à rebours en fin d'épisode), par profil
  try { await db.execute("ALTER TABLE users ADD COLUMN autoplay_next INTEGER NOT NULL DEFAULT 1") } catch {}
  // Personnalisation du dashboard d'accueil (rangées activées + ordre), JSON, par profil
  try { await db.execute("ALTER TABLE users ADD COLUMN dashboard_prefs TEXT") } catch {}
  // Extension de conteneur (épisodes IPTV séries, pour la relecture depuis une playlist)
  try { await db.execute("ALTER TABLE playlist_items ADD COLUMN ext TEXT") } catch {}
  // Logo de la chaîne pour l'overlay de rappel EPG (carte du bas)
  try { await db.execute("ALTER TABLE epg_reminders ADD COLUMN logo TEXT") } catch {}

  // ── Progression de lecture ───────────────────────────────────────────────────
  // Avancement du dernier passage de CHAQUE média (Hub ou lancé hors Hub), pour
  // pouvoir reprendre ailleurs (« continuer la lecture sur… ») ou plus tard.
  // media_key = catalog_id (synthétique : plex:…/iptv:type:…/ext:…) si lancé par le
  // Hub, sinon `${app}|${title}` (sessions détectées sans passer par /play).
  // Les champs de relecture (plex_id, iptv_*, external_*) ne sont remplis QUE pour
  // les lancements Hub — c'est ce qui rend le transfert possible. Le live et les
  // flux non-seekable ne sont pas suivis (aucune position à reprendre).
  // Pas de scoping par profil en v1 : la notion de session active par device
  // arrivera avec le sprint Zaparoo (cf. mémoire). user_id reste nullable.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS playback_progress (
      media_key TEXT PRIMARY KEY,
      catalog_id TEXT,
      app TEXT,
      title TEXT,
      thumb TEXT,
      plex_id TEXT,
      iptv_stream_id TEXT,
      iptv_type TEXT,
      iptv_ext TEXT,
      external_url TEXT,
      external_platform TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      duration INTEGER NOT NULL DEFAULT 0,
      seekable INTEGER NOT NULL DEFAULT 0,
      device_id TEXT,
      user_id INTEGER,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `)
  await db.execute("CREATE INDEX IF NOT EXISTS idx_progress_updated ON playback_progress(updated_at DESC)")

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

  // ── Trakt : un compte Trakt lié par profil hub (token suit le profil actif) ──
  // Device flow OAuth. user_id = id du profil hub. Sert au scrobbling universel,
  // au « prochain épisode » multi-sources et à la publication de listes.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS trakt_accounts (
      user_id INTEGER PRIMARY KEY,
      trakt_user_id TEXT,
      username TEXT,
      name TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL DEFAULT 0,
      scopes TEXT NOT NULL DEFAULT '',
      image TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `)

  // ── Companion : boîte de réception des partages (TikTok au départ) ───────────
  // Un partage entrant (URL + caption résolue via oEmbed) atterrit ici avec une
  // extraction heuristique du titre candidat. status : 'pending' (à traiter),
  // 'matched' (rattaché à un item du catalogue), 'wishlist' (existe mais hors
  // catalogue), 'ignored'. Les champs matched_* sont remplis à la résolution.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS companion_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      source_platform TEXT NOT NULL DEFAULT 'tiktok',
      source_url TEXT NOT NULL,
      resolved_url TEXT,
      video_id TEXT,
      caption TEXT,
      author_name TEXT,
      author_unique_id TEXT,
      thumbnail TEXT,
      hashtags TEXT NOT NULL DEFAULT '[]',
      title_guess TEXT,
      year_guess INTEGER,
      type_guess TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      matched_app TEXT,
      matched_ref_id TEXT,
      matched_title TEXT,
      raw TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `)
  await db.execute("CREATE INDEX IF NOT EXISTS idx_companion_status ON companion_inbox(status, created_at DESC)")

  // ── Connecteur LLM générique : config par fournisseur + fournisseur actif ────
  // Brancher au choix Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google) ou
  // Ollama (local). base_url sert surtout à Ollama (ex. http://192.168.1.x:11434).
  // api_key sert aux 3 fournisseurs cloud. Premier consommateur : le Companion
  // (extraction de titres de films depuis des commentaires).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS llm_providers (
      provider TEXT PRIMARY KEY,
      api_key TEXT,
      base_url TEXT,
      model TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `)

  // Réglage singleton du fournisseur actif (id figé à 1).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS llm_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      active_provider TEXT
    )
  `)
  await db.execute("INSERT OR IGNORE INTO llm_settings (id) VALUES (1)")

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
