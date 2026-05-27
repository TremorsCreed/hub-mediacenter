// Lance VLC avec une URL de stream (IPTV).
// Détecte VLC dans le PATH ou les emplacements standards par OS.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { platform } from 'node:os'
import type { LaunchResult } from '../types.js'

function findVlc(): string | null {
  const candidates: string[] = []
  switch (platform()) {
    case 'win32':
      candidates.push(
        'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
        'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'
      )
      break
    case 'darwin':
      candidates.push('/Applications/VLC.app/Contents/MacOS/VLC')
      break
    default:
      candidates.push('/usr/bin/vlc', '/usr/local/bin/vlc', '/snap/bin/vlc')
  }
  for (const c of candidates) if (existsSync(c)) return c
  // Fallback : on tente juste "vlc" et on espère qu'il est dans le PATH
  return 'vlc'
}

export async function launchVlc(streamUrl: string, fullscreen = true): Promise<LaunchResult> {
  const vlc = findVlc()
  if (!vlc) return { kind: 'app_not_installed', what: 'vlc' }
  try {
    const args = [streamUrl, '--play-and-exit']
    if (fullscreen) args.unshift('--fullscreen')
    const child = spawn(vlc, args, { detached: true, stdio: 'ignore' })
    child.unref()
    return { kind: 'success' }
  } catch (e) {
    return { kind: 'error', reason: `vlc spawn failed: ${(e as Error).message}` }
  }
}
