// Resolver souverain : du « quoi regarder » (identité stable de l'œuvre) vers le
// « où jouer maintenant » (un stream_id sur une source IPTV active). L'identité vit
// dans la table works (id interne possédé + tmdb/imdb), la résolution physique est
// un cache jetable (iptv_resolutions). Au changement de provider, on ne re-pointe
// rien à la main : on re-résout par tmdb_id sinon titre+année sur les sources actives.

import { db } from './db'
import {
  listActiveCredentialIds, getVodList, getSeriesList, findAllInList, normalizeTitle,
  type StreamEntry,
} from './iptvVodCache'
import { getXtreamCred, xtreamCall } from './routes/iptv'

export interface WorkIdentity {
  work_id?: number
  type?: 'movie' | 'show'
  title?: string
  original_title?: string
  year?: number
  tmdb_id?: number
  imdb_id?: string
  tvdb_id?: number
  season?: number
  episode?: number
  preferred_lang?: string
}

export interface ResolvedStream {
  work_id?: number
  cred_id: number
  kind: 'vod' | 'series'
  stream_id: string   // pour une série avec saison/épisode : l'episode_id
  ext?: string
  lang?: string
}

function normKey(title: string, year?: number): string {
  return normalizeTitle(title) + '|' + (year ?? '')
}

function wantKindOf(id: WorkIdentity): 'vod' | 'series' {
  if (id.season != null && id.episode != null) return 'series'
  return id.type === 'show' ? 'series' : 'vod'
}

// Trouve (ou crée) l'œuvre canonique. Priorité aux IDs externes possédés (tmdb puis
// imdb), repli sur le titre normalisé + année. Enrichit un work existant si on
// apporte un ID externe qui manquait. Renvoie null si rien pour ancrer (pas de titre).
export async function ensureWork(id: WorkIdentity): Promise<number | null> {
  if (id.work_id) return id.work_id
  const type = id.type ?? (id.season != null ? 'show' : 'movie')

  const findBy = async (col: string, val: any): Promise<number | null> => {
    const { rows } = await db.execute({ sql: `SELECT id FROM works WHERE ${col} = ? LIMIT 1`, args: [val] })
    return rows.length ? Number((rows[0] as any).id) : null
  }

  let wid: number | null = null
  if (id.tmdb_id) wid = await findBy('tmdb_id', id.tmdb_id)
  if (wid == null && id.imdb_id) wid = await findBy('imdb_id', id.imdb_id)
  if (wid == null && id.title) {
    const { rows } = await db.execute({
      sql: 'SELECT id FROM works WHERE norm_key = ? AND type = ? LIMIT 1',
      args: [normKey(id.title, id.year), type],
    })
    if (rows.length) wid = Number((rows[0] as any).id)
  }

  // Enrichit un work trouvé sans ID externe (on possède maintenant un tmdb/imdb).
  if (wid != null && (id.tmdb_id || id.imdb_id)) {
    await db.execute({
      sql: `UPDATE works SET tmdb_id = COALESCE(tmdb_id, ?), imdb_id = COALESCE(imdb_id, ?),
                              tvdb_id = COALESCE(tvdb_id, ?), updated_at = ?
            WHERE id = ?`,
      args: [id.tmdb_id ?? null, id.imdb_id ?? null, id.tvdb_id ?? null, Date.now(), wid],
    }).catch(() => {})
    return wid
  }
  if (wid != null) return wid
  if (!id.title) return null

  const now = Date.now()
  const { rows } = await db.execute({
    sql: `INSERT INTO works (type, title, original_title, year, tmdb_id, imdb_id, tvdb_id, norm_key, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [type, id.title, id.original_title ?? null, id.year ?? null,
           id.tmdb_id ?? null, id.imdb_id ?? null, id.tvdb_id ?? null,
           normKey(id.title, id.year), now, now],
  })
  return Number((rows[0] as any).id)
}

function pickByLang(cands: StreamEntry[], lang?: string): StreamEntry {
  if (lang) {
    const hit = cands.find(c => (c.language ?? '').toUpperCase() === lang.toUpperCase())
    if (hit) return hit
  }
  return cands[0]
}

// Résout l'episode_id réel d'une série Xtream (series_id → saison/épisode).
async function resolveEpisodeId(credId: number, seriesId: string, season: number, episode: number):
  Promise<{ episode_id: string; ext?: string } | null> {
  const cred = await getXtreamCred(String(credId))
  if (!cred) return null
  try {
    const data: any = await xtreamCall(cred, 'get_series_info', { series_id: seriesId })
    const eps: any[] = data?.episodes?.[String(season)] ?? []
    const ep = eps.find((e: any) => Number(e.episode_num) === episode)
    if (!ep) return null
    return { episode_id: String(ep.id), ext: ep.container_extension ? String(ep.container_extension) : undefined }
  } catch { return null }
}

// Lève l'ambiguïté entre plusieurs VOD de même titre via le tmdb_id (présent dans
// get_vod_info, jamais dans les listes). Limité aux 8 premiers candidats (1 appel
// HTTP chacun). Renvoie le candidat dont le tmdb_id correspond, sinon null.
async function disambiguateByTmdb(credId: number, cands: StreamEntry[], tmdbId: number): Promise<StreamEntry | null> {
  const cred = await getXtreamCred(String(credId))
  if (!cred) return null
  for (const c of cands.slice(0, 8)) {
    try {
      const data: any = await xtreamCall(cred, 'get_vod_info', { vod_id: c.stream_id })
      if (Number(data?.info?.tmdb_id) === tmdbId) return c
    } catch { /* candidat suivant */ }
  }
  return null
}

async function searchOnCred(credId: number, id: WorkIdentity, kind: 'vod' | 'series'): Promise<ResolvedStream | null> {
  const title = id.title!
  if (kind === 'series') {
    let cands = findAllInList(await getSeriesList(credId), title)  // pas d'année pour une série
    if (!cands.length) return null
    // Ordonne par langue préférée d'abord (un provider a souvent plusieurs versions
    // FR/EN/4K… de la même série).
    if (id.preferred_lang) {
      const pl = id.preferred_lang.toUpperCase()
      cands = [...cands].sort((a, b) =>
        (b.language?.toUpperCase() === pl ? 1 : 0) - (a.language?.toUpperCase() === pl ? 1 : 0))
    }
    if (id.season != null && id.episode != null) {
      // Plusieurs versions de la série existent ; certaines n'ont pas l'épisode (4K
      // partiel, bande-annonce…). On essaie les candidates jusqu'à en trouver une qui
      // contient bien la saison/épisode (≤8 appels get_series_info).
      for (const c of cands.slice(0, 8)) {
        const ep = await resolveEpisodeId(credId, c.stream_id, id.season, id.episode)
        if (ep) return { cred_id: credId, kind: 'series', stream_id: ep.episode_id, ext: ep.ext, lang: c.language }
      }
      return null
    }
    const chosen = cands[0]
    return { cred_id: credId, kind: 'series', stream_id: chosen.stream_id, lang: chosen.language }
  }
  let cands = findAllInList(await getVodList(credId), title, id.year)
  if (!cands.length) return null
  if (id.tmdb_id && cands.length > 1) {
    const picked = await disambiguateByTmdb(credId, cands, id.tmdb_id)
    if (picked) cands = [picked, ...cands.filter(c => c !== picked)]
  }
  const chosen = pickByLang(cands, id.preferred_lang)
  return { cred_id: credId, kind: 'vod', stream_id: chosen.stream_id, lang: chosen.language }
}

async function upsertResolution(workId: number, r: ResolvedStream, season: number, episode: number) {
  await db.execute({
    sql: `INSERT INTO iptv_resolutions (work_id, cred_id, kind, season, episode, stream_id, ext, lang, resolved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(work_id, cred_id, kind, season, episode, lang) DO UPDATE SET
            stream_id = excluded.stream_id, ext = excluded.ext, resolved_at = excluded.resolved_at`,
    args: [workId, r.cred_id, r.kind, season, episode, r.stream_id, r.ext ?? null, r.lang ?? '', Date.now()],
  }).catch(() => {})
}

// Cœur partagé : ensure work → (cache si !fresh) → recherche multi-sources → cache.
async function resolve(id: WorkIdentity, fresh: boolean): Promise<ResolvedStream | null> {
  if (!id.title && !id.work_id) return null
  const kind = wantKindOf(id)
  const season = id.season ?? -1
  const episode = id.episode ?? -1
  // Pour un épisode, id.title est « Série · S02E09 · Titre épisode » : on isole le
  // titre de la SÉRIE pour le matching et l'œuvre (la saison/épisode pinpointent
  // l'épisode via get_series_info). Sinon on chercherait une série au titre complet.
  const norm: WorkIdentity = { ...id }
  if (id.season != null && id.episode != null && id.title) {
    const show = id.title.replace(/\s*·\s*s\d{1,3}e\d{1,4}.*$/i, '').trim()
    if (show) norm.title = show
  }
  const workId = await ensureWork(norm)

  if (!fresh && workId != null) {
    const { rows } = await db.execute({
      sql: `SELECT * FROM iptv_resolutions WHERE work_id = ? AND kind = ? AND season = ? AND episode = ?`,
      args: [workId, kind, season, episode],
    })
    if (rows.length) {
      const pref = id.preferred_lang?.toUpperCase()
      const best = (pref && (rows as any[]).find(r => String(r.lang).toUpperCase() === pref)) || rows[0]
      const r = best as any
      return { work_id: workId, cred_id: Number(r.cred_id), kind: r.kind, stream_id: String(r.stream_id), ext: r.ext ? String(r.ext) : undefined, lang: r.lang || undefined }
    }
  }

  if (!norm.title) return null
  for (const credId of await listActiveCredentialIds()) {
    try {
      const found = await searchOnCred(credId, norm, kind)
      if (found) {
        found.work_id = workId ?? undefined
        if (workId != null) await upsertResolution(workId, found, season, episode)
        console.log(`[resolver] ${kind} « ${id.title} » → cred#${found.cred_id} stream ${found.stream_id}${found.lang ? ' (' + found.lang + ')' : ''}`)
        return found
      }
    } catch (e) { console.warn(`[resolver] cred#${credId} échec:`, (e as Error).message) }
  }
  console.warn(`[resolver] aucune source ne résout « ${id.title} » (${kind})`)
  return null
}

// Trouve le credential actif qui possède ce stream VOD (vérif d'appartenance aux
// listes déjà en mémoire — quasi gratuit). Sert à valider un ref_id stocké ET à
// retrouver le bon provider en multi-sources. Renvoie null si le stream n'existe
// sur aucune source active (= périmé après un changement de provider).
export async function findCredForVodStream(streamId: string): Promise<number | null> {
  for (const credId of await listActiveCredentialIds()) {
    const list = await getVodList(credId)
    if (list.some(s => s.stream_id === streamId)) return credId
  }
  return null
}

// Résolution normale : cache d'abord, recherche sinon.
export function resolveStream(id: WorkIdentity): Promise<ResolvedStream | null> {
  return resolve(id, false)
}

// Re-résolution forcée : ignore le cache (le stream_id en cache vient d'échouer à
// la lecture). Le cache est rafraîchi avec le nouveau stream_id.
export function reresolveStream(id: WorkIdentity): Promise<ResolvedStream | null> {
  return resolve(id, true)
}
