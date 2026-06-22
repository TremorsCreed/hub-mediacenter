import { ScrapedListItem } from '../api'

// Parsing d'une liste collée (texte libre ou JSON) en items « titre » résolvables.
// Supporte la granularité épisode : une entrée série avec un tableau `seasons[].episodes[]`
// est décomposée en un item par épisode (format « Show · S01E02 · Titre », comme Trakt).

const num = (v: any): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

// Une ligne texte « Titre (Année) », préfixe « série: »/« tv: » pour forcer une série.
export function textLineToScraped(line: string): ScrapedListItem | null {
  let s = line.trim()
  if (!s) return null
  let type: 'movie' | 'series' = 'movie'
  const pref = s.match(/^(s[ée]rie|tv|show)\s*[:\-]\s*(.+)$/i)
  if (pref) { type = 'series'; s = pref[2].trim() }
  let year: number | null = null
  const ym = s.match(/^(.*?)[\s.\-]*\((\d{4})\)\s*$/)
  if (ym) { s = ym[1].trim(); year = Number(ym[2]) }
  return { position: 1, title: s, year, type, kind: type === 'series' ? 'show' : 'movie' }
}

// Développe un tableau de saisons en items épisode (numéro accepté : ep|episode|number).
export function seasonsToEpisodes(showTitle: string, year: number | null, seasons: any[]): ScrapedListItem[] {
  const out: ScrapedListItem[] = []
  for (const s of seasons) {
    const sn = num(s?.season ?? s?.number)
    const eps = Array.isArray(s?.episodes) ? s.episodes : []
    for (const e of eps) {
      const en = num(e?.ep ?? e?.episode ?? e?.number)
      if (sn == null || en == null) continue
      const tag = `S${String(sn).padStart(2, '0')}E${String(en).padStart(2, '0')}`
      const epTitle = String(e?.title ?? e?.name ?? '').trim()
      out.push({
        position: out.length + 1,
        title: [showTitle, tag, epTitle].filter(Boolean).join(' · '),
        year,
        type: 'series',
        kind: 'episode',
        show_title: showTitle,
        season: sn,
        episode: en,
        episode_title: epTitle || null,
      })
    }
  }
  return out
}

// Une entrée JSON → un ou plusieurs ScrapedListItem (plusieurs si elle a des saisons).
export function jsonEntryToScraped(e: any): ScrapedListItem[] {
  if (typeof e === 'string') {
    const t = textLineToScraped(e)
    return t ? [t] : []
  }
  if (e && typeof e === 'object') {
    const title = String(e.title ?? e.name ?? '').trim()
    if (!title) return []
    const year = num(e.year)
    if (Array.isArray(e.seasons) && e.seasons.length) {
      const eps = seasonsToEpisodes(title, year, e.seasons)
      if (eps.length) return eps // sinon (saisons vides) on retombe sur la série entière
    }
    const t = String(e.type ?? e.kind ?? '').toLowerCase()
    const type: 'movie' | 'series' = (t === 'series' || t === 'serie' || t === 'tv' || t === 'show') ? 'series' : 'movie'
    return [{ position: typeof e.position === 'number' ? e.position : 1, title, year, type, kind: type === 'series' ? 'show' : 'movie', original_title: e.original_title ?? null }]
  }
  return []
}

// Liste collée complète → items (JSON d'abord, sinon une ligne = un titre).
export function parsePastedList(raw: string): ScrapedListItem[] {
  const text = raw.trim()
  if (!text) return []
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const json = JSON.parse(text)
      const arr: any[] = Array.isArray(json) ? json : Array.isArray(json.items) ? json.items : Array.isArray(json.list) ? json.list : []
      const out = arr.flatMap(jsonEntryToScraped)
      if (out.length) return out.map((it, i) => ({ ...it, position: i + 1 }))
    } catch { /* JSON invalide → mode texte ligne par ligne */ }
  }
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map((l, i) => ({ ...(textLineToScraped(l) as ScrapedListItem), position: i + 1 }))
}
