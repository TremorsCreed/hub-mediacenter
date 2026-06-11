// Vérificateur de rappels EPG : toutes les 30s, repère les programmes dont
// l'heure de début approche (selon lead_min) et envoie une notif au device choisi.
import { db } from './db'
import { sendNotify, isConnected } from './ws'
import { notifyOverlay } from './notify'

async function check() {
  const now = Math.floor(Date.now() / 1000)
  let rows: any[] = []
  try {
    const r = await db.execute({
      // Fenêtre de déclenchement : de (début - lead) jusqu'à (début + 5 min) de grâce
      sql: 'SELECT * FROM epg_reminders WHERE notified = 0 AND (start_ts - lead_min * 60) <= ? AND start_ts + 300 > ?',
      args: [now, now],
    })
    rows = r.rows as any[]
  } catch { return }

  for (const rem of rows) {
    const dev = rem.device_id as string | null
    if (!dev || !isConnected(dev)) continue // best-effort : on retentera tant que la fenêtre est ouverte
    const mins = Math.max(0, Math.round((Number(rem.start_ts) - now) / 60))
    const chan = rem.channel_name || 'IPTV'
    const msg = mins > 0
      ? `« ${rem.title} » sur ${chan} commence dans ${mins} min`
      : `« ${rem.title} » sur ${chan} commence maintenant`
    try { sendNotify(dev, `⏰ ${msg}`) } catch { /* */ }
    try { await notifyOverlay(dev, { title: '⏰ Rappel', message: msg, duration: 12 }) } catch { /* */ }
    try { await db.execute({ sql: 'UPDATE epg_reminders SET notified = 1 WHERE id = ?', args: [rem.id] }) } catch { /* */ }
  }

  // Purge des rappels passés depuis plus d'un jour
  try { await db.execute({ sql: 'DELETE FROM epg_reminders WHERE start_ts < ?', args: [now - 86400] }) } catch { /* */ }
}

export function startReminderChecker() {
  setInterval(() => { check().catch(() => {}) }, 30000)
  console.log('[reminders] checker EPG démarré (intervalle 30s)')
}
