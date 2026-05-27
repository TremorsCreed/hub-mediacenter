// Route les commandes WS vers le bon launcher.
// Mêmes types/sémantiques que l'agent Android.

import type { LaunchResult, PlayContext, WsPlayCommand } from './types.js'
import { launchBrowser } from './launchers/browser.js'
import { launchPlex } from './launchers/plex.js'
import { launchVlc } from './launchers/vlc.js'
import { notify } from './notify.js'

export async function handlePlay(ctx: PlayContext) {
  const { cmd, onState } = ctx
  console.log(`[play] ${cmd.title} via ${cmd.app}`)
  notify(`▶ ${cmd.title}`, `Lecture sur ${cmd.app.toUpperCase()}`)

  let result: LaunchResult
  try {
    switch (cmd.app) {
      case 'plex':
        result = await launchPlex({ plexId: cmd.plex_id, watchUrl: cmd.plex_watch_url })
        break
      case 'iptv': {
        // Priorité : URL pré-construite par le hub. Sinon impossible (l'agent PC ne
        // connaît pas les credentials Xtream — le hub résout tout côté serveur).
        const url = cmd.stream_url
        if (!url) {
          result = { kind: 'error', reason: 'no stream_url (hub should pre-build for PC)' }
          break
        }
        result = await launchVlc(url, true)
        break
      }
      case 'external': {
        const url = cmd.external_url
        if (!url) { result = { kind: 'error', reason: 'no external_url' }; break }
        result = await launchBrowser(url)
        break
      }
      default:
        result = { kind: 'error', reason: `unsupported app: ${cmd.app}` }
    }
  } catch (e) {
    result = { kind: 'error', reason: (e as Error).message }
  }

  switch (result.kind) {
    case 'success':
      onState('playing', { app: cmd.app })
      break
    case 'app_not_installed':
      notify('App manquante', `${result.what} n'est pas installé sur ce PC`)
      onState('error', { app: cmd.app })
      break
    case 'error':
      notify('Erreur de lecture', result.reason)
      console.error('[play] error:', result.reason)
      onState('error', { app: cmd.app })
      break
  }
}
