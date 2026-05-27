// Notifications système cross-platform via node-notifier.
// Note : sur PC on n'utilise pas l'overlay style Android — la notif native suffit.

import notifier from 'node-notifier'

export function notify(title: string, message: string) {
  try {
    // Les options sound/timeout/appID sont supportées par les backends Windows/Linux
    // mais pas typées dans node-notifier — on cast.
    notifier.notify({
      title,
      message,
      ...({ sound: false, wait: false, timeout: 5, appID: 'Hub MediaCenter' } as any),
    })
  } catch (e) {
    // Si node-notifier crash (binaires manquants, etc.), on log silencieusement
    console.warn('[notify] failed:', (e as Error).message)
  }
}
