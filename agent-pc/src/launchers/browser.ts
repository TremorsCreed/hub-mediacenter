// Ouvre une URL dans le navigateur par défaut.
// Sur PCTV avec un browser kiosk c'est suffisant pour Netflix/Disney+/Prime/etc.

import open from 'open'
import type { LaunchResult } from '../types.js'

export async function launchBrowser(url: string): Promise<LaunchResult> {
  try {
    await open(url)
    return { kind: 'success' }
  } catch (e) {
    return { kind: 'error', reason: `browser open failed: ${(e as Error).message}` }
  }
}
