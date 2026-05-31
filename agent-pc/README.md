# Hub MediaCenter — Agent PC

Agent pour PC HTPC qui se connecte au Hub MediaCenter via WebSocket. Lance la lecture (Plex Desktop, VLC, navigateur) et débloque LaunchBox quand MarquesasServer est coincé sur "A game is currently being played".

## Installation rapide (Windows, exe + autostart)

1. Copie le dossier `agent-pc/` sur le PC Windows (où tournent LaunchBox et MarquesasServer).
2. Vérifie que `dist/hub-agent.exe` est présent (sinon, lance `npm run package` depuis une machine de dev avec Node 20+).
3. Clic droit sur `install.ps1` > **Exécuter avec PowerShell** (ou `powershell -ExecutionPolicy Bypass -File install.ps1`).

L'installeur :
- Copie `hub-agent.exe` dans `%LOCALAPPDATA%\hub-mediacenter\`
- Crée un launcher VBS qui démarre l'exe en fenêtre cachée
- Place un raccourci dans le dossier `shell:startup` (démarrage auto à chaque logon)
- Lance l'agent immédiatement

Options :

```powershell
.\install.ps1 -HubUrl "ws://192.168.1.15:8020" -DeviceName "HTPC Salon"
.\install.ps1 -NoStart       # Installe sans démarrer
.\install.ps1 -Uninstall     # Kill + supprime l'install (config conservée)
```

Vérifier que l'agent tourne :

```powershell
Get-Process hub-agent
```

## Build

```bash
cd agent-pc
npm install
npm run package      # → dist/hub-agent.exe (Windows x64, ~55 MB, Node 22 embedded)
npm run package:all  # → dist/hub-agent-{win,linux,macos} (multi-OS)
```

## Run en dev

```bash
npm install
npm start
```

Au premier lancement, un `config.json` est créé dans `%APPDATA%\hub-mediacenter\` (Windows) ou `./config.json` (Linux/macOS) avec :
- `device_id` : UUID unique (stable entre redémarrages)
- `device_name` : hostname par défaut, éditable
- `hub_url` : `ws://192.168.1.15:8020` par défaut, éditable

Vars d'env (surchargent le config) :
- `HUB_AGENT_URL=ws://192.168.1.15:8020`
- `HUB_AGENT_NAME="HTPC Salon"`
- `HUB_AGENT_CONFIG=/chemin/vers/config.json`
- `LAUNCHBOX_EXE=F:\LaunchBox\LaunchBox.exe` (override de la détection auto)

## Capabilities

| App | Action | Mécanisme |
|-----|--------|-----------|
| `plex` | play (movie, episode, music) | Plex Desktop si installé, sinon `app.plex.tv` dans le navigateur. Le hub gère le Remote Control HTTP sur :32500. |
| `iptv` | play (live_channel, vod) | VLC (auto-détecté). URL Xtream pré-construite par le hub. |
| `external` | play (movie, episode) | Deep link navigateur (Netflix, Disney+, Prime, etc.) |
| `launchbox` | reset | `taskkill /F LaunchBox.exe + BigBox.exe` puis relance LaunchBox. Débloque l'état stuck `isInGame=true` du plugin MarquesasServer. |

## Messages WebSocket reçus

- `play` — lance un média selon `app`
- `stop` — notif "lecture arrêtée"
- `notify` — affiche une toast Windows
- `overlay` — remappé en toast Windows (pas d'overlay graphique sur PC)
- `config` — credentials Xtream + plex_server_id (le hub résout les URLs côté serveur)
- `control` — pas implémenté sur PC (KEYCODE_MEDIA_* Android)
- `launchbox_reset` — `{ relaunch?: boolean }` → taskkill LaunchBox.exe et relance si demandé
- `ping/pong` — heartbeat

## Messages WebSocket envoyés

- `register` — au connect, avec `capabilities`
- `state_update` — après play (status: playing/stopped/error)
- `launchbox_reset_result` — `{ ok, killed, relaunched, detail, request_id }` après un reset
- `ping` — heartbeat toutes les 30s

## Autostart Linux / macOS

- **Linux** : créer un `~/.config/systemd/user/hub-agent.service` qui lance `node /chemin/dist/index.cjs` (le bundle), puis `systemctl --user enable --now hub-agent`
- **macOS** : créer un LaunchAgent `~/Library/LaunchAgents/com.hubmediacenter.agent.plist`

(Pas d'installeur automatique pour ces OS pour l'instant — uniquement Windows.)
