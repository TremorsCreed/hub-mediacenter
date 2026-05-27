# Hub MediaCenter — Agent PC

Agent pour PC HTPC (Windows / Linux / macOS) qui se connecte au Hub MediaCenter via WebSocket et lance la lecture via Plex Desktop, VLC ou le navigateur (Netflix, Disney+, Prime, etc.).

## Install

```bash
cd agent-pc
npm install
```

## Run

```bash
npm start
```

Au premier lancement, un fichier `config.json` est créé avec :
- `device_id` : UUID unique (gardez-le stable)
- `device_name` : hostname par défaut, éditable
- `hub_url` : `ws://192.168.1.15:8020` par défaut, éditable

Vous pouvez aussi le configurer via variables d'environnement :
- `HUB_AGENT_URL=ws://192.168.1.15:8020`
- `HUB_AGENT_NAME="HTPC Salon"`
- `HUB_AGENT_CONFIG=/chemin/vers/config.json`

## Apps gérées

| App | Mécanisme |
|-----|-----------|
| Plex | Plex Desktop si installée, sinon fallback web `app.plex.tv`. Le hub gère le Remote Control HTTP sur `:32500`. |
| IPTV | VLC (auto-détecté dans les emplacements standards) avec l'URL résolue par le hub. |
| Netflix / Disney+ / Prime / etc. | Deep link dans le navigateur par défaut. |

## Autostart

- **Windows** : créer un raccourci dans `shell:startup` qui lance `npm start` (ou packager via `pkg`)
- **Linux** : `systemd --user` service
- **macOS** : LaunchAgent
