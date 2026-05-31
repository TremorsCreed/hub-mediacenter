// Ouvre une URL dans le navigateur par défaut.
// Implémentation native par OS pour éviter la dépendance `open` qui utilise
// import.meta.url et casse au bundling esbuild → pkg.

import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import type { LaunchResult } from '../types.js'

export async function launchBrowser(url: string): Promise<LaunchResult> {
  try {
    const os = platform()
    if (os === 'win32') {
      // start "" "<url>" via cmd. Le "" est le titre de fenêtre (obligatoire si l'URL contient des espaces)
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    } else if (os === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
    }
    return { kind: 'success' }
  } catch (e) {
    return { kind: 'error', reason: `browser open failed: ${(e as Error).message}` }
  }
}
