import { Router } from 'express'
import { z } from 'zod'
import fs from 'fs'
import { db } from '../db'
import { isValidAdminToken } from '../auth'
import { matchCatalogue } from '../companionMatch'

// Sprint Companion : on reçoit un partage (URL TikTok au départ, généralisable),
// on résout la caption via oEmbed, on en extrait un titre candidat, et on stocke
// dans une boîte de réception à traiter.
//
// Étape 1 (ici) : la cascade de résolution du titre. Sur le format dominant
// (résumés / edits de films), le titre n'est PAS dans la caption mais dans les
// COMMENTAIRES (quelqu'un répond « le titre c'est X »). Ordre de priorité :
//   1) commentaires (signal le plus fort), via tikwm
//   2) caption + hashtags (heuristique existante)
//   3) (plus tard) vision sur la vignette
//   4) boîte de réception manuelle (validation UI)
// Puis recherche TMDb / Trakt pour transformer le titre en candidat scoré.

const router = Router()

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const TRAKT_API = 'https://api.trakt.tv'
const TRAKT_CLIENT_ID = process.env.TRAKT_CLIENT_ID ?? ''

function clean(s: any): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

function ctx(req: any) {
  return {
    userId: (req.userId ?? null) as number | null,
    isAdmin: isValidAdminToken(req.header('X-Admin-Token') ?? undefined),
  }
}

// Détecte la plateforme d'origine à partir de l'hôte de l'URL.
function detectPlatform(url: string): string {
  const h = url.toLowerCase()
  if (h.includes('tiktok.com')) return 'tiktok'
  if (h.includes('youtube.com') || h.includes('youtu.be')) return 'youtube'
  if (h.includes('instagram.com')) return 'instagram'
  return 'unknown'
}

// Extrait la première URL d'un texte de partage (TikTok envoie souvent un libellé
// + le lien dans un seul champ text/plain).
function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]+/i)
  return m ? m[0] : null
}

// Suit les redirections des liens courts (vm.tiktok.com / vt.tiktok.com) pour
// récupérer l'URL canonique attendue par l'oEmbed.
async function resolveShortUrl(url: string): Promise<string> {
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000) as any,
    })
    return r.url || url
  } catch {
    return url
  }
}

// Appel oEmbed TikTok (public, sans authentification). Renvoie la caption (title),
// l'auteur et la vignette, ou null si indisponible.
async function fetchTikTokOembed(url: string): Promise<any | null> {
  try {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000) as any,
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

// Extraction heuristique étage 1 : hashtags, mentions, année, et texte de prose
// nettoyé (best effort). Pas encore de matching ici, juste de quoi voir ce qu'on
// récupère et calibrer la suite.
function extractHeuristic(caption: string, authorName: string | null) {
  const cap = clean(caption)
  const hashtags = Array.from(cap.matchAll(/#([\p{L}\p{N}_]+)/gu)).map((m) => m[1])
  const mentions = Array.from(cap.matchAll(/@([\p{L}\p{N}_.]+)/gu)).map((m) => m[1])
  const yearMatch = cap.match(/\b(19\d{2}|20\d{2})\b/)
  const yearGuess = yearMatch ? Number(yearMatch[1]) : null

  // Prose = caption sans URLs, hashtags, mentions, ni emojis. C'est souvent (pas
  // toujours) le titre ou une phrase qui le contient.
  const prose = cap
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/@[\p{L}\p{N}_.]+/gu, ' ')
    .replace(/[\p{Extended_Pictographic}‍️]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const titleGuess = prose.length >= 2 ? prose.slice(0, 160) : null

  return { hashtags, mentions, yearGuess, titleGuess, prose, authorName: authorName ? clean(authorName) : null }
}

// ── Cascade 1 : commentaires TikTok via tikwm ────────────────────────────────

// Un commentaire normalisé (sous-ensemble de ce que tikwm renvoie).
type TikComment = { text: string; diggCount: number; replyTotal: number; nickname: string | null }

// Un titre candidat extrait d'un commentaire (ou de la caption), avec la trace de
// comment il a été trouvé. Sert ensuite à calculer le score de confiance.
type TitleCandidate = {
  title: string
  source: 'comment' | 'caption'
  // 'pattern' : motif explicite (« le titre c'est X »), 'quoted' : entre guillemets,
  // 'bare' : commentaire brut sans motif (signal plus faible).
  via: 'pattern' | 'quoted' | 'bare'
  diggCount: number
}

// Récupère jusqu'à `count` commentaires d'une vidéo TikTok via tikwm (service tiers
// gratuit qui gère la signature TikTok). Renvoie null en cas d'échec (jamais d'erreur
// lancée). tikwm a un rate limit (environ 1 req/s) : on garde un timeout serré.
async function fetchTikTokComments(videoUrl: string, count = 20): Promise<TikComment[] | null> {
  try {
    const u = `https://www.tikwm.com/api/comment/list?url=${encodeURIComponent(videoUrl)}&count=${count}&cursor=0`
    const r = await fetch(u, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000) as any,
    })
    if (!r.ok) return null
    const j: any = await r.json()
    if (!j || j.code !== 0 || !j.data?.comments) return null
    return (j.data.comments as any[]).map((c) => ({
      text: clean(c?.text),
      diggCount: Number(c?.digg_count ?? 0),
      replyTotal: Number(c?.reply_total ?? 0),
      nickname: c?.user?.nickname ? clean(c.user.nickname) : null,
    }))
  } catch {
    return null
  }
}

// Motifs explicites FR + EN du type « le titre c'est X ». On capture le reste du
// commentaire après le motif comme titre candidat. Les apostrophes / guillemets
// "courbes" de TikTok (’ « » “ ”) sont gérés en plus des versions droites.
// Note (étape 2) : un LLM local viendra renforcer cette extraction (motifs
// implicites, fautes, titres noyés dans une phrase) en complément de ces regex.
// Apostrophe droite (U+0027) ou courbe (U+2019, que TikTok renvoie souvent).
const APOS = "['’]"
// Le séparateur du motif (« c'est », « : », « , ») est OBLIGATOIRE : il évite de
// confondre une vraie réponse (« le titre c'est X ») avec une simple demande
// (« le titre svp », « titre ? ») qui ne contient aucun titre.
const TITLE_PATTERNS: RegExp[] = [
  // FR
  new RegExp(`(?:le\\s+)?titre\\s*(?:c${APOS}est|:|,)\\s*(.+)`, 'i'),
  new RegExp(`(?:le\\s+)?nom\\s+du\\s+film\\s*(?:c${APOS}est|:|,)\\s*(.+)`, 'i'),
  new RegExp(`(?:le\\s+)?film\\s+(?:c${APOS}est|s${APOS}appelle)\\s*(.+)`, 'i'),
  new RegExp(`(?:ca|ça)\\s+s${APOS}appelle\\s*(.+)`, 'i'),
  new RegExp(`(?:le\\s+film|le\\s+titre)\\s*:\\s*(.+)`, 'i'),
  // EN
  /(?:the\s+)?title\s+is\s*:?\s*(.+)/i,
  /it['’]?s\s+called\s*:?\s*(.+)/i,
  /(?:the\s+)?(?:movie|film)\s+is\s*:?\s*(.+)/i,
  /name\s+of\s+the\s+(?:movie|film)\s+is\s*:?\s*(.+)/i,
]

// Titre cité entre guillemets : « X », “ X ”, " X ". Renvoie le 1er groupe non vide.
const QUOTED_PATTERNS: RegExp[] = [
  /«\s*([^»]{2,80})\s*»/,
  /[“"]\s*([^”"]{2,80})\s*[”"]/,
]

// Nettoie un titre candidat brut : retire guillemets résiduels, ponctuation de fin,
// emojis, et coupe à une longueur raisonnable.
function cleanCandidateTitle(s: string): string {
  return clean(s)
    .replace(/[«»“”"']/g, ' ')
    .replace(/[\p{Extended_Pictographic}‍️]/gu, ' ')
    .replace(/^[\s:,.\-]+/, '')
    .replace(/[\s:,.\-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

// Extrait les titres candidats d'une liste de commentaires, ordonnés par force du
// signal puis par nombre de likes. On privilégie les commentaires épinglés / top
// (souvent en tête de liste et fortement likés).
function extractTitlesFromComments(comments: TikComment[]): TitleCandidate[] {
  const out: TitleCandidate[] = []
  for (const c of comments) {
    const text = c.text
    if (!text) continue

    // 1) Motif explicite : le plus fort. On prend le 1er motif qui matche.
    let matchedPattern = false
    for (const re of TITLE_PATTERNS) {
      const m = text.match(re)
      if (m && m[1]) {
        const title = cleanCandidateTitle(m[1])
        if (title.length >= 2) {
          out.push({ title, source: 'comment', via: 'pattern', diggCount: c.diggCount })
          matchedPattern = true
          break
        }
      }
    }
    if (matchedPattern) continue

    // 2) Titre cité entre guillemets, sans motif explicite autour.
    for (const re of QUOTED_PATTERNS) {
      const m = text.match(re)
      if (m && m[1]) {
        const title = cleanCandidateTitle(m[1])
        if (title.length >= 2) {
          out.push({ title, source: 'comment', via: 'quoted', diggCount: c.diggCount })
          break
        }
      }
    }
  }

  // Tri : motif explicite avant citation, puis par likes décroissants.
  const rank = (v: TitleCandidate['via']) => (v === 'pattern' ? 0 : v === 'quoted' ? 1 : 2)
  out.sort((a, b) => rank(a.via) - rank(b.via) || b.diggCount - a.diggCount)

  // Dédoublonnage par titre (insensible à la casse), en gardant le 1er (mieux classé).
  const seen = new Set<string>()
  const deduped: TitleCandidate[] = []
  for (const c of out) {
    const k = c.title.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    deduped.push(c)
  }
  return deduped
}

// ── Consensus : pool commentaires + reponses, scoring par nombre de proposeurs ──

// Une occurrence d'un titre candidat dans le pool (un commentaire OU une reponse).
// likes = digg_count du commentaire/reponse qui propose ce titre.
type TitleOccurrence = { title: string; via: 'pattern' | 'quoted' | 'bare'; likes: number }

// Recupere les reponses d'un commentaire via tikwm. Renvoie [] en cas d'echec (jamais
// d'erreur lancee). videoId = aweme id ; commentId = id du commentaire parent.
async function fetchTikTokReplies(videoId: string, commentId: string, count = 30): Promise<TikComment[]> {
  try {
    const u = `https://www.tikwm.com/api/comment/reply?video_id=${encodeURIComponent(videoId)}&comment_id=${encodeURIComponent(commentId)}&count=${count}&cursor=0`
    const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) as any })
    if (!r.ok) return []
    const j: any = await r.json()
    if (!j || j.code !== 0 || !j.data?.comments) return []
    return (j.data.comments as any[]).map((c) => ({
      text: clean(c?.text),
      diggCount: Number(c?.digg_count ?? 0),
      replyTotal: Number(c?.reply_total ?? 0),
      nickname: c?.user?.nickname ? clean(c.user.nickname) : null,
    }))
  } catch {
    return []
  }
}

// Recupere la liste brute des commentaires (avec leur id et video_id) pour pouvoir
// ensuite aller chercher les reponses. tikwm renvoie cid (id du commentaire) et
// video_id (aweme id) sur chaque entree.
type RawComment = TikComment & { cid: string | null; videoId: string | null }
async function fetchTikTokCommentsRaw(videoUrl: string, count = 30): Promise<RawComment[] | null> {
  try {
    const u = `https://www.tikwm.com/api/comment/list?url=${encodeURIComponent(videoUrl)}&count=${count}&cursor=0`
    const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) as any })
    if (!r.ok) return null
    const j: any = await r.json()
    if (!j || j.code !== 0 || !j.data?.comments) return null
    return (j.data.comments as any[]).map((c) => ({
      text: clean(c?.text),
      diggCount: Number(c?.digg_count ?? 0),
      replyTotal: Number(c?.reply_total ?? 0),
      nickname: c?.user?.nickname ? clean(c.user.nickname) : null,
      cid: c?.cid != null ? String(c.cid) : (c?.id != null ? String(c.id) : null),
      videoId: c?.video_id != null ? String(c.video_id) : (c?.aweme_id != null ? String(c.aweme_id) : null),
    }))
  } catch {
    return null
  }
}

// Un commentaire court qui ressemble a un titre (peu de mots, pas une phrase / question).
// Sert a capter les reponses du type « We Bury the Dead » donnees sans motif explicite.
function looksLikeBareTitle(text: string): string | null {
  const t = clean(text)
  if (!t) return null
  // Ecarte les questions et les demandes (« titre ? », « c'est quoi », etc.).
  if (/[?]/.test(t)) return null
  if (/\b(titre|title|svp|please|quoi|name|nom)\b/i.test(t)) return null
  const cleaned = cleanCandidateTitle(t)
  if (cleaned.length < 2 || cleaned.length > 60) return null
  const words = cleaned.split(/\s+/)
  // Un titre fait en general 1 a 7 mots ; au-dela c'est une phrase / une blague.
  if (words.length < 1 || words.length > 7) return null
  return cleaned
}

// Extrait toutes les occurrences de titres candidats d'un pool (commentaires + reponses).
// Chaque commentaire peut produire AU PLUS une occurrence (la plus forte : pattern >
// quoted > bare), pour ne pas qu'un meme commentaire compte plusieurs fois.
function extractOccurrences(pool: TikComment[]): TitleOccurrence[] {
  const out: TitleOccurrence[] = []
  for (const c of pool) {
    const text = c.text
    if (!text) continue

    let matched = false
    // 1) Motif explicite.
    for (const re of TITLE_PATTERNS) {
      const m = text.match(re)
      if (m && m[1]) {
        const title = cleanCandidateTitle(m[1])
        if (title.length >= 2) { out.push({ title, via: 'pattern', likes: c.diggCount }); matched = true; break }
      }
    }
    if (matched) continue

    // 2) Titre entre guillemets.
    for (const re of QUOTED_PATTERNS) {
      const m = text.match(re)
      if (m && m[1]) {
        const title = cleanCandidateTitle(m[1])
        if (title.length >= 2) { out.push({ title, via: 'quoted', likes: c.diggCount }); matched = true; break }
      }
    }
    if (matched) continue

    // 3) Commentaire court ressemblant a un titre (signal faible mais cumulable).
    const bare = looksLikeBareTitle(text)
    if (bare) out.push({ title: bare, via: 'bare', likes: c.diggCount })
  }
  return out
}

// Un titre distinct apres regroupement des occurrences equivalentes.
type ConsensusGroup = {
  title: string        // forme d'affichage (occurrence la plus likee du groupe)
  proposers: number    // nombre d'occurrences distinctes proposant ce titre
  score: number        // proposers * POIDS + somme(min(likes, plafond))
  strongest: 'pattern' | 'quoted' | 'bare'
}

// Le NOMBRE de personnes qui proposent un titre prime ; les likes ne sont qu'un bonus
// plafonne (anti viral unique : 50 likes sur une blague ne battent pas 3 personnes).
const CONSENSUS_PROPOSER_WEIGHT = 100
const CONSENSUS_LIKES_CAP = 50

// Regroupe les occurrences par titre normalise et calcule le score consensus.
function consensusGroups(occurrences: TitleOccurrence[]): ConsensusGroup[] {
  const viaRank = (v: TitleOccurrence['via']) => (v === 'pattern' ? 0 : v === 'quoted' ? 1 : 2)
  const groups = new Map<string, { occ: TitleOccurrence[]; }>()
  for (const o of occurrences) {
    const k = normForCompare(o.title)
    if (!k) continue
    if (!groups.has(k)) groups.set(k, { occ: [] })
    groups.get(k)!.occ.push(o)
  }
  const out: ConsensusGroup[] = []
  for (const { occ } of groups.values()) {
    const proposers = occ.length
    const likeBonus = occ.reduce((s, o) => s + Math.min(o.likes, CONSENSUS_LIKES_CAP), 0)
    const score = proposers * CONSENSUS_PROPOSER_WEIGHT + likeBonus
    // Forme d'affichage : l'occurrence la mieux classee (motif fort, puis plus likee).
    const display = [...occ].sort((a, b) => viaRank(a.via) - viaRank(b.via) || b.likes - a.likes)[0]
    const strongest = occ.reduce<'pattern' | 'quoted' | 'bare'>((best, o) => viaRank(o.via) < viaRank(best) ? o.via : best, 'bare')
    out.push({ title: display.title, proposers, score, strongest })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

// ── Cascade : recherche TMDb / Trakt ─────────────────────────────────────────

type MatchCandidate = {
  type: 'movie' | 'show'
  title: string
  year: number | null
  ids: { imdb?: string; tmdb?: number; trakt?: number }
}

// Recherche texte Trakt (films + séries). Renvoie une liste de candidats normalisés.
// Si TRAKT_CLIENT_ID est absent (cas local), renvoie un tableau vide sans échouer :
// la résolution des commentaires doit rester testable sans clé.
async function searchTraktByTitle(title: string, limit = 8): Promise<MatchCandidate[]> {
  if (!TRAKT_CLIENT_ID) return []
  try {
    const u = `${TRAKT_API}/search/movie,show?query=${encodeURIComponent(title)}&extended=full&limit=${limit}`
    const r = await fetch(u, {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': TRAKT_CLIENT_ID,
        'User-Agent': UA,
      },
      signal: AbortSignal.timeout(15000) as any,
    })
    if (!r.ok) return []
    const data = (await r.json()) as any[]
    return (data ?? [])
      .map((it: any): MatchCandidate | null => {
        const node = it.type === 'movie' ? it.movie : it.type === 'show' ? it.show : null
        if (!node) return null
        const ids: MatchCandidate['ids'] = {}
        if (node.ids?.imdb) ids.imdb = node.ids.imdb
        if (node.ids?.tmdb) ids.tmdb = Number(node.ids.tmdb)
        if (node.ids?.trakt) ids.trakt = Number(node.ids.trakt)
        return {
          type: it.type as 'movie' | 'show',
          title: clean(node.title),
          year: typeof node.year === 'number' ? node.year : null,
          ids,
        }
      })
      .filter((x): x is MatchCandidate => !!x && !!x.title)
  } catch {
    return []
  }
}

// ── Score de confiance ───────────────────────────────────────────────────────

// Normalise un titre pour comparaison (minuscules, sans accents ni ponctuation).
function normForCompare(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Vrai si le meilleur candidat TMDb correspond de près au titre extrait (égalité
// après normalisation, ou inclusion forte). Sert à distinguer high / medium.
function hasCloseMatch(extracted: string, candidates: MatchCandidate[]): boolean {
  if (!candidates.length) return false
  const a = normForCompare(extracted)
  if (!a) return false
  const top = normForCompare(candidates[0].title)
  return top === a || top.includes(a) || a.includes(top)
}

// Calcule le score de confiance global de la résolution.
//   high   : titre via motif explicite ou hashtag exact, ET match TMDb proche
//   medium : titre depuis commentaire sans motif, ou match TMDb seulement fuzzy
//   low    : seulement la prose de caption, ou aucun match TMDb solide
function scoreConfidence(
  chosen: TitleCandidate | null,
  candidates: MatchCandidate[],
): 'high' | 'medium' | 'low' {
  if (!chosen) return 'low'
  const close = hasCloseMatch(chosen.title, candidates)
  const strongSource = chosen.via === 'pattern' || chosen.via === 'quoted'

  if (strongSource && close) return 'high'
  if (close || chosen.source === 'comment') return 'medium'
  return 'low'
}

// ── Resolution par consensus : commentaires + reponses → titre verifie Trakt ──

// Resultat de la resolution par les commentaires (forme alignee sur /ingest).
type ConsensusResult = {
  resolvedTitle: string | null
  candidates: MatchCandidate[]
  confidence: 'high' | 'medium' | 'low' | null
  // Pour la trace / le debug front : les meilleurs groupes consensus avec leur score.
  groups: { title: string; proposers: number; score: number }[]
}

// Petit delai entre appels tikwm pour respecter le rate limit (environ 1 req/s).
function delay(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

// Resout le titre par CONSENSUS : un titre propose par PLUSIEURS personnes (en cumulant
// des likes plafonnes) bat un commentaire viral unique. Construit un pool commentaires +
// reponses (limite aux ~8 commentaires les plus repondus pour le rate limit), score, puis
// ne garde QUE les meilleurs candidats ayant une vraie correspondance Trakt.
async function resolveByConsensus(videoUrl: string, fallbackVideoId: string | null): Promise<ConsensusResult> {
  const empty: ConsensusResult = { resolvedTitle: null, candidates: [], confidence: null, groups: [] }
  const raw = await fetchTikTokCommentsRaw(videoUrl)
  if (!raw || !raw.length) return empty

  // Pool = tous les commentaires (+ reponses des plus repondus).
  const pool: TikComment[] = raw.map((c) => ({ text: c.text, diggCount: c.diggCount, replyTotal: c.replyTotal, nickname: c.nickname }))

  // On va chercher les reponses des ~8 commentaires les plus repondus (rate limit).
  const withReplies = raw
    .filter((c) => c.replyTotal > 0 && c.cid)
    .sort((a, b) => b.replyTotal - a.replyTotal)
    .slice(0, 8)
  for (const c of withReplies) {
    const vid = c.videoId || fallbackVideoId
    if (!vid || !c.cid) continue
    const replies = await fetchTikTokReplies(vid, c.cid)
    for (const r of replies) pool.push(r)
    await delay(1100)
  }

  // Occurrences → groupes consensus tries par score.
  const occurrences = extractOccurrences(pool)
  const groups = consensusGroups(occurrences)
  if (!groups.length) return empty

  // Verification Trakt sur les meilleurs candidats : on ne garde que ceux qui ont une
  // vraie correspondance. Le titre retenu = le mieux score ET verifie.
  const TOP_TO_VERIFY = 5
  for (const g of groups.slice(0, TOP_TO_VERIFY)) {
    const cands = await searchTraktByTitle(g.title)
    if (cands.length && hasCloseMatch(g.title, cands)) {
      // Confiance : plusieurs proposeurs distincts + match → high ; 1 seul + match → medium.
      const confidence: 'high' | 'medium' = g.proposers >= 2 ? 'high' : 'medium'
      return {
        resolvedTitle: g.title,
        candidates: cands,
        confidence,
        groups: groups.slice(0, TOP_TO_VERIFY).map((x) => ({ title: x.title, proposers: x.proposers, score: x.score })),
      }
    }
  }
  // Rien de verifie : la recherche manuelle prendra le relais.
  return { ...empty, groups: groups.slice(0, TOP_TO_VERIFY).map((x) => ({ title: x.title, proposers: x.proposers, score: x.score })) }
}

// ── POST /ingest : reçoit un partage, résout, extrait, stocke en boîte de réception ──
const IngestSchema = z.object({
  url: z.string().optional(),
  sharedText: z.string().optional(),
})
router.post('/ingest', async (req, res) => {
  const { userId } = ctx(req)
  const parsed = IngestSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  // L'URL peut arriver seule, ou noyée dans le texte de partage Android.
  const raw = clean(parsed.data.url || '')
  const url = raw && /^https?:\/\//i.test(raw) ? raw : firstUrl(clean(parsed.data.sharedText || raw))
  if (!url) return res.status(400).json({ error: 'no_url', detail: 'Aucune URL trouvée dans le partage.' })

  const platform = detectPlatform(url)
  const resolvedUrl = platform === 'tiktok' ? await resolveShortUrl(url) : url

  let oembed: any = null
  if (platform === 'tiktok') oembed = await fetchTikTokOembed(resolvedUrl)

  const caption = clean(oembed?.title || parsed.data.sharedText || '')
  const authorName = oembed?.author_name ?? null
  const authorUnique = oembed?.author_unique_id ?? null
  const thumb = oembed?.thumbnail_url ?? null
  const videoId = oembed?.embed_product_id ?? null

  const h = extractHeuristic(caption, authorName)

  // ── Cascade de résolution du titre ──────────────────────────────────────────
  // 1) commentaires + reponses par CONSENSUS (signal le plus fort, verifie Trakt),
  // 2) caption + hashtags (existant, fallback non verifie).
  let resolutionSource: 'comment' | 'caption' | 'none' = 'none'
  let resolvedTitle: string | null = null
  let candidates: MatchCandidate[] = []
  let confidence: 'high' | 'medium' | 'low' = 'low'
  let consensusGroupsOut: { title: string; proposers: number; score: number }[] = []

  if (platform === 'tiktok') {
    const cons = await resolveByConsensus(resolvedUrl, videoId ? String(videoId) : null)
    consensusGroupsOut = cons.groups
    if (cons.resolvedTitle && cons.confidence) {
      resolvedTitle = cons.resolvedTitle
      candidates = cons.candidates
      confidence = cons.confidence
      resolutionSource = 'comment'
    }
  }

  // 2) Fallback caption : on prend la prose nettoyée (ou un hashtag) comme titre.
  // Non verifie Trakt → confiance basse ; la validation manuelle prend le relais.
  if (!resolvedTitle && h.titleGuess) {
    resolvedTitle = h.titleGuess
    candidates = await searchTraktByTitle(h.titleGuess)
    confidence = candidates.length && hasCloseMatch(h.titleGuess, candidates) ? 'medium' : 'low'
    resolutionSource = 'caption'
  }

  const tmdbSearchRan = !!TRAKT_CLIENT_ID

  // type_guess / year_guess depuis le meilleur match si dispo, sinon l'heuristique.
  const topMatch = candidates[0] ?? null
  const typeGuess = topMatch ? (topMatch.type === 'show' ? 'series' : 'movie') : null
  const yearGuess = topMatch?.year ?? h.yearGuess ?? null

  const now = Date.now()
  const { rows } = await db.execute({
    sql: `INSERT INTO companion_inbox
            (user_id, source_platform, source_url, resolved_url, video_id,
             caption, author_name, author_unique_id, thumbnail,
             hashtags, title_guess, year_guess, type_guess,
             status, raw, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
          RETURNING id`,
    args: [
      userId, platform, url, resolvedUrl, videoId,
      caption || null, authorName, authorUnique, thumb,
      JSON.stringify(h.hashtags), resolvedTitle ?? h.titleGuess, yearGuess, typeGuess,
      oembed ? JSON.stringify(oembed) : null, now, now,
    ],
  })

  const id = Number((rows[0] as any).id)
  res.json({
    id,
    status: 'pending',
    platform,
    resolved_url: resolvedUrl,
    caption,
    author: authorName,
    thumbnail: thumb,
    // Fiche candidate : résultat de la cascade.
    resolved_title: resolvedTitle,
    resolution_source: resolutionSource,
    confidence,
    candidates,
    tmdb_search_ran: tmdbSearchRan,
    consensus: consensusGroupsOut,
    extraction: h,
    note: oembed ? 'oembed_ok' : 'oembed_indisponible',
  })
})

// ── POST /fiche : enrichit un candidat (film/série) en fiche complète ─────────
// Étape 2a du Sprint Companion : à partir d'un identifiant Trakt/IMDb/TMDb,
// on construit une fiche détaillée (affiche, casting, synopsis, note, bande
// annonce) pour validation par l'utilisateur avant enregistrement. Tout passe
// par l'API Trakt publique (client_id seul).

const FicheIdsSchema = z
  .object({
    trakt: z.number().optional(),
    imdb: z.string().optional(),
    tmdb: z.number().optional(),
  })
  .refine((ids) => ids.trakt != null || (ids.imdb && ids.imdb.length > 0) || ids.tmdb != null, {
    message: 'Au moins un identifiant (trakt, imdb ou tmdb) est requis.',
  })

const FicheSchema = z.object({
  type: z.enum(['movie', 'show']),
  ids: FicheIdsSchema,
})

// Préfixe https:// aux chemins d'images Trakt (renvoyés sans protocole).
function ficheImg(path?: string | null): string | null {
  if (!path) return null
  return path.startsWith('http') ? path : `https://${path}`
}

// Appel REST Trakt (lecture publique). Renvoie data + Response, lance en cas
// d'erreur HTTP (géré par le try/catch de la route).
async function traktGet<T = any>(path: string): Promise<{ data: T; res: Response }> {
  const r = await fetch(`${TRAKT_API}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': TRAKT_CLIENT_ID,
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(15000) as any,
  })
  if (!r.ok) {
    const err: any = new Error(`Trakt a répondu ${r.status}`)
    err.status = r.status
    throw err
  }
  const data = (await r.json()) as T
  return { data, res: r }
}

// Extrait la clé vidéo YouTube d'une URL de bande annonce Trakt. Gère les formes
// youtube.com/watch?v=KEY, youtu.be/KEY et youtube.com/embed/KEY. Renvoie null
// si l'URL est absente ou non reconnue.
function youtubeKey(url?: string | null): string | null {
  if (!url) return null
  const s = String(url)
  const m =
    s.match(/[?&]v=([A-Za-z0-9_-]{6,})/) ||
    s.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) ||
    s.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/)
  return m ? m[1] : null
}

router.post('/fiche', async (req, res) => {
  if (!TRAKT_CLIENT_ID) return res.status(503).json({ error: 'Trakt non configuré (TRAKT_CLIENT_ID manquant).' })

  const parsed = FicheSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { type, ids } = parsed.data
  // On privilégie l'id trakt, sinon l'id imdb (Trakt accepte un id imdb dans le
  // chemin, ex. /movies/tt1234567). On ne tente pas le tmdb seul ici car il ne
  // sert pas directement d'identifiant de chemin Trakt.
  const slug = ids.trakt != null ? String(ids.trakt) : ids.imdb
  if (!slug) {
    return res.status(400).json({ error: 'Identifiant trakt ou imdb requis pour interroger Trakt.' })
  }

  const base = type === 'movie' ? 'movies' : 'shows'

  try {
    // 1) Résumé (synopsis, note, genres, trailer, ids, images).
    const { data: summary } = await traktGet<any>(`/${base}/${encodeURIComponent(slug)}?extended=full,images`)

    // 2) Casting + équipe (best effort : si l'appel échoue, on garde une fiche
    // sans casting plutôt que d'échouer toute la requête).
    let people: any = null
    try {
      const r = await traktGet<any>(`/${base}/${encodeURIComponent(slug)}/people?extended=full`)
      people = r.data
    } catch {
      people = null
    }

    // Casting principal : 10 premiers (nom + personnage).
    const cast = Array.isArray(people?.cast)
      ? people.cast
          .slice(0, 10)
          .map((c: any) => ({ name: clean(c?.person?.name), character: clean(c?.character) || null }))
          .filter((c: any) => c.name)
      : []

    // Réalisateur / créateur. Pour une série, on prend les créateurs si présents
    // (crew.created), sinon le(s) réalisateur(s) (crew.directing, job Director).
    let director: string | null = null
    if (type === 'show' && Array.isArray(people?.crew?.created) && people.crew.created.length) {
      director =
        people.crew.created
          .map((c: any) => clean(c?.person?.name))
          .filter(Boolean)
          .join(', ') || null
    }
    if (!director && Array.isArray(people?.crew?.directing)) {
      director =
        people.crew.directing
          .filter((c: any) => clean(c?.job).toLowerCase() === 'director')
          .map((c: any) => clean(c?.person?.name))
          .filter(Boolean)
          .join(', ') || null
    }

    // 3) Bande annonce : URL brute + clé YouTube extraite.
    const trailerUrl = summary?.trailer ? clean(summary.trailer) : null
    const trailerKey = youtubeKey(trailerUrl)

    // Images : poster + fanart (backdrop). Trakt renvoie des tableaux de chemins
    // sans protocole, on prend le premier et on préfixe https.
    const poster = ficheImg(summary?.images?.poster?.[0]) ?? null
    const backdrop = ficheImg(summary?.images?.fanart?.[0]) ?? null

    const outIds: { trakt?: number; imdb?: string; tmdb?: number } = {}
    if (summary?.ids?.trakt != null) outIds.trakt = Number(summary.ids.trakt)
    if (summary?.ids?.imdb) outIds.imdb = summary.ids.imdb
    if (summary?.ids?.tmdb != null) outIds.tmdb = Number(summary.ids.tmdb)

    res.json({
      type,
      title: clean(summary?.title) || null,
      year: typeof summary?.year === 'number' ? summary.year : null,
      tagline: summary?.tagline ? clean(summary.tagline) : null,
      overview: summary?.overview ? clean(summary.overview) : null,
      runtime: typeof summary?.runtime === 'number' ? summary.runtime : null,
      rating: typeof summary?.rating === 'number' ? summary.rating : null,
      genres: Array.isArray(summary?.genres) ? summary.genres : [],
      // released pour un film, first_aired pour une série.
      released: summary?.released ?? summary?.first_aired ?? null,
      poster,
      backdrop,
      director,
      cast,
      trailer_url: trailerUrl,
      trailer_youtube_key: trailerKey,
      ids: outIds,
    })
  } catch (e: any) {
    const status = e?.status === 404 ? 404 : 502
    const msg = status === 404 ? 'Média introuvable sur Trakt.' : `Trakt indisponible : ${e?.message ?? 'erreur réseau'}`
    res.status(status).json({ error: msg })
  }
})

// ── GET /inbox : liste les partages à traiter (du profil, ou tous si admin) ───
router.get('/inbox', async (req, res) => {
  const { userId, isAdmin } = ctx(req)
  const status = clean(req.query.status)
  const wheres: string[] = []
  const args: any[] = []
  if (!isAdmin) { wheres.push('(user_id = ? OR user_id IS NULL)'); args.push(userId) }
  if (status) { wheres.push('status = ?'); args.push(status) }
  const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : ''
  const { rows } = await db.execute({
    sql: `SELECT id, user_id, source_platform, source_url, resolved_url, video_id,
                 caption, author_name, author_unique_id, thumbnail,
                 hashtags, title_guess, year_guess, type_guess,
                 status, matched_app, matched_ref_id, matched_title,
                 created_at, updated_at
          FROM companion_inbox ${whereSql}
          ORDER BY created_at DESC LIMIT 200`,
    args,
  })
  res.json(rows.map((r: any) => ({ ...r, hashtags: safeParse(r.hashtags) })))
})

function safeParse(s: any): any {
  if (!s) return []
  try { return JSON.parse(s) } catch { return [] }
}

// ── POST /match : disponibilite catalogue d'un media resolu ───────────────────
// Reutilise la logique de cross-ref de Discover (Plex perso + IPTV par langue +
// services streaming via Plex Discover) et renvoie un MatchResult avec un statut
// synthetique : in_catalogue | streaming_only | not_found (-> wishlist).
const MatchSchema = z.object({
  title: z.string().min(1),
  year: z.number().nullable().optional(),
  type: z.enum(['movie', 'show']),
  ids: z
    .object({
      tmdb: z.number().optional(),
      imdb: z.string().optional(),
    })
    .optional(),
})
router.post('/match', async (req, res) => {
  const parsed = MatchSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  try {
    const result = await matchCatalogue({
      title: clean(parsed.data.title),
      year: parsed.data.year ?? null,
      type: parsed.data.type,
      ids: parsed.data.ids,
    })
    res.json(result)
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? 'match_failed' })
  }
})

// ── POST /inbox/:id/decide : tranche le sort d'un item de la boite de reception ─
// decision : 'matched' (rattache a un media, ajoute a une playlist cote front) |
// 'wishlist' (existe mais hors catalogue) | 'ignored'. Met a jour le statut et,
// optionnellement, la trace du media retenu (matched_*).
const DecideSchema = z.object({
  decision: z.enum(['matched', 'wishlist', 'ignored']),
  matched_app: z.string().optional(),
  matched_ref_id: z.string().optional(),
  matched_title: z.string().optional(),
})
router.post('/inbox/:id/decide', async (req, res) => {
  const { userId, isAdmin } = ctx(req)
  const id = parseInt(req.params.id, 10)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invalide' })
  const parsed = DecideSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  // Verifie que l'item est visible par ce profil (proprietaire, sans profil, ou admin).
  const { rows } = await db.execute({ sql: 'SELECT user_id FROM companion_inbox WHERE id = ?', args: [id] })
  if (!rows.length) return res.status(404).json({ error: 'item introuvable' })
  const owner = (rows[0] as any).user_id as number | null
  if (!isAdmin && owner != null && owner !== userId) return res.status(403).json({ error: 'forbidden' })

  const d = parsed.data
  await db.execute({
    sql: `UPDATE companion_inbox
          SET status = ?, matched_app = ?, matched_ref_id = ?, matched_title = ?, updated_at = ?
          WHERE id = ?`,
    args: [d.decision, d.matched_app ?? null, d.matched_ref_id ?? null, d.matched_title ?? null, Date.now(), id],
  })
  res.json({ ok: true, id, status: d.decision })
})

// ── DELETE /inbox/:id : retire un item de la boite de reception (Decouvertes) ──
// Meme controle de propriete que /inbox/:id/decide : admin, proprietaire, ou item
// sans profil (user_id null).
router.delete('/inbox/:id', async (req, res) => {
  const { userId, isAdmin } = ctx(req)
  const id = parseInt(req.params.id, 10)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invalide' })

  const { rows } = await db.execute({ sql: 'SELECT user_id FROM companion_inbox WHERE id = ?', args: [id] })
  if (!rows.length) return res.status(404).json({ error: 'item introuvable' })
  const owner = (rows[0] as any).user_id as number | null
  if (!isAdmin && owner != null && owner !== userId) return res.status(403).json({ error: 'forbidden' })

  await db.execute({ sql: 'DELETE FROM companion_inbox WHERE id = ?', args: [id] })
  res.json({ ok: true })
})

// ── GET /search?q=... : recherche manuelle de titre (Trakt) ───────────────────
// Sert a resoudre a la main un partage non identifie automatiquement (l'utilisateur
// tape le titre qu'il a vu). Renvoie des candidats au meme format que /ingest.
router.get('/search', async (req, res) => {
  const q = clean(req.query.q)
  if (q.length < 2) return res.json([])
  try {
    res.json(await searchTraktByTitle(q, 10))
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? 'search_failed' })
  }
})

// ── GET /apk : telecharge l'APK de l'app companion (depuis le volume /apk) ─────
// Sert au lien de telechargement affiche dans le Hub (modale d'appairage). Public
// (pas d'admin) pour pouvoir le recuperer depuis le telephone.
const COMPANION_APK = '/apk/hub-companion-debug.apk'
router.get('/apk', (_req, res) => {
  if (!fs.existsSync(COMPANION_APK)) return res.status(404).json({ error: 'apk indisponible' })
  res.download(COMPANION_APK, 'HMCompanion.apk')
})

export default router
