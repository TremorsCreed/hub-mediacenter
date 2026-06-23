// Back-remplissage de la fondation d'identité (Chantier B) sur les données existantes.
// Idempotent (gardé par work_id IS NULL) et non bloquant (fire-and-forget au boot) :
// pour chaque item de playlist/favori/vu, ancre une œuvre canonique (works) par
// titre+année, et seed une résolution IPTV depuis le ref_id stocké (attribuée au
// premier credential actif, faute d'avoir historisé la source). Si ce stream_id ne
// matche plus, la re-résolution lazy au play corrigera à la première lecture.

import { db } from '../db'
import { ensureWork } from '../resolver'
import { listActiveCredentialIds } from '../iptvVodCache'

export async function backfillWorks() {
  try {
    const firstCred = (await listActiveCredentialIds())[0] ?? null
    let anchored = 0

    // playlist_items : titre + saison/épisode → œuvre, + seed de résolution IPTV.
    const { rows: pis } = await db.execute(
      "SELECT id, app, ref_id, ref_type, title, year, lang, ext, season, episode FROM playlist_items WHERE work_id IS NULL AND title IS NOT NULL"
    )
    for (const r of pis as any[]) {
      const isShow = r.ref_type === 'series' || r.ref_type === 'episode' || r.season != null
      const wid = await ensureWork({
        type: isShow ? 'show' : 'movie',
        title: r.title, year: r.year ?? undefined,
        season: r.season ?? undefined, episode: r.episode ?? undefined,
      }).catch(() => null)
      if (wid == null) continue
      await db.execute({ sql: 'UPDATE playlist_items SET work_id = ? WHERE id = ?', args: [wid, r.id] })
      anchored++
      if (r.app === 'iptv' && r.ref_id && firstCred != null) {
        const kind = r.ref_type === 'series' ? 'series' : 'vod'
        await db.execute({
          sql: `INSERT INTO iptv_resolutions (work_id, cred_id, kind, season, episode, stream_id, ext, lang, resolved_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(work_id, cred_id, kind, season, episode, lang) DO NOTHING`,
          args: [wid, firstCred, kind, r.season ?? -1, r.episode ?? -1, r.ref_id, r.ext ?? null, r.lang ?? '', Date.now()],
        }).catch(() => {})
      }
    }

    // favorites + watched : ancrage par titre seulement (pas de saison/épisode stockés).
    for (const t of ['favorites', 'watched']) {
      const { rows } = await db.execute(`SELECT id, ref_type, title FROM ${t} WHERE work_id IS NULL AND title IS NOT NULL`)
      for (const r of rows as any[]) {
        const isShow = r.ref_type === 'series' || r.ref_type === 'episode' || r.ref_type === 'show'
        const wid = await ensureWork({ type: isShow ? 'show' : 'movie', title: r.title }).catch(() => null)
        if (wid == null) continue
        await db.execute({ sql: `UPDATE ${t} SET work_id = ? WHERE id = ?`, args: [wid, r.id] })
        anchored++
      }
    }

    if (anchored) console.log(`[backfill-works] ${anchored} item(s) ancrés sur une œuvre`)
  } catch (e) {
    console.warn('[backfill-works] échec:', (e as Error).message)
  }
}
