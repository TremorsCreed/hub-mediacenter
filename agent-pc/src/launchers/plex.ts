// Lance Plex Desktop si installée, sinon fallback sur la web app plex.tv.
// Plex Desktop expose aussi le Remote Control sur :32500 → le hub backend
// peut envoyer playMedia directement (même path que pour les Shield).
//
// Notre rôle ici : réveiller / ouvrir Plex au foreground pour que le Remote
// Control trouve une session active.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import open from 'open'
import type { LaunchResult } from '../types.js'

function findPlexDesktop(): string | null {
  switch (platform()) {
    case 'win32': {
      const candidates = [
        join(process.env.LOCALAPPDATA || '', 'Plex', 'Plex.exe'),
        'C:\\Program Files\\Plex\\Plex\\Plex.exe',
        join(homedir(), 'AppData', 'Local', 'Plex', 'Plex.exe'),
      ]
      return candidates.find(existsSync) ?? null
    }
    case 'darwin':
      return existsSync('/Applications/Plex.app') ? '/Applications/Plex.app/Contents/MacOS/Plex' : null
    case 'linux':
      return ['/usr/bin/plexmediaplayer', '/snap/bin/plex-desktop'].find(existsSync) ?? null
    default:
      return null
  }
}

export async function launchPlex(opts: { plexId?: string; watchUrl?: string }): Promise<LaunchResult> {
  // Priorité : Plex Desktop installé → on l'ouvre (le backend prendra le relais
  // via Remote Control HTTP). Sinon fallback sur web app.
  const exe = findPlexDesktop()
  if (exe) {
    try {
      const child = spawn(exe, [], { detached: true, stdio: 'ignore' })
      child.unref()
      return { kind: 'success' }
    } catch (e) {
      // Si l'exe foire, on tente le web
    }
  }
  // Web fallback : ouvre app.plex.tv/desktop, optionnellement sur le bon titre
  const url = opts.watchUrl
    ?? (opts.plexId ? `https://app.plex.tv/desktop#!/server/details/${opts.plexId}` : 'https://app.plex.tv/desktop')
  try {
    await open(url)
    return { kind: 'success' }
  } catch (e) {
    return { kind: 'error', reason: `plex launch failed: ${(e as Error).message}` }
  }
}
