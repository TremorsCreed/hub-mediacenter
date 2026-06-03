import { Router } from 'express'
import { z } from 'zod'

const router = Router()

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const SC_GQL = 'https://apollo.senscritique.com/'

function clean(s: any): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

// Appel GraphQL SensCritique (API publique, introspection ouverte).
async function gql<T = any>(query: string, variables: Record<string, any>): Promise<T> {
  const r = await fetch(SC_GQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://www.senscritique.com' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000) as any,
  })
  if (!r.ok) throw new Error(`SensCritique a répondu ${r.status}`)
  const j: any = await r.json()
  if (j.errors?.length) throw new Error(j.errors[0]?.message ?? 'Erreur GraphQL SensCritique')
  return j.data
}

function mapType(category: any, universe: any): 'movie' | 'series' {
  const cat = String(category ?? '').toLowerCase()
  return cat.includes('série') || cat.includes('serie') || universe === 4 ? 'series' : 'movie'
}

// ── Recherche de listes ──────────────────────────────────────────────────────
const SEARCH_Q = `query($q: String!, $limit: Int!) {
  searchListExplorer(query: $q, offset: 0, limit: $limit) {
    total
    items { id title url backdrop like_count }
  }
}`
router.get('/search', async (req, res) => {
  const q = clean(req.query.q)
  if (q.length < 2) return res.json([])
  try {
    const data = await gql(SEARCH_Q, { q, limit: 16 })
    const items = (data?.searchListExplorer?.items ?? []).map((h: any) => ({
      id: h.id,
      title: clean(h.title),
      url: h.url?.startsWith('http') ? h.url : `https://www.senscritique.com${h.url ?? ''}`,
      cover: h.backdrop ?? null,
      likes: Number(h.like_count ?? 0),
    }))
    res.json(items)
  } catch (e: any) {
    res.status(502).json({ error: `Recherche SensCritique indisponible : ${e.message}` })
  }
})

// ── Détail d'une liste (métadonnées + TOUS les items, paginés) ───────────────
const LIST_Q = `query($id: Int!, $limit: Int!, $offset: Int!) {
  userList(id: $id) {
    id label cover firstProductBackdrop description likePositiveCount productCount
    productsList(limit: $limit, offset: $offset) {
      total
      items { position product { id title originalTitle yearOfProduction category universe } }
    }
  }
}`
router.post('/scrape', async (req, res) => {
  const parsed = z.object({ url: z.string().min(4) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'url requise' })
  let url = parsed.data.url.trim()
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  const idMatch = url.match(/\/liste\/[^/]+\/(\d+)/i)
  if (!idMatch) return res.status(400).json({ error: 'URL de liste SensCritique attendue (format .../liste/slug/123).' })
  const id = Number(idMatch[1])

  try {
    const PAGE = 30
    let offset = 0
    let total = Infinity
    let meta: any = null
    const raw: any[] = []
    while (offset < total && offset <= 1000) {
      const data = await gql(LIST_Q, { id, limit: PAGE, offset })
      const ul = data?.userList
      if (!ul) return res.status(404).json({ error: 'Liste introuvable.' })
      if (!meta) meta = ul
      total = Number(ul.productsList?.total ?? 0)
      const items = ul.productsList?.items ?? []
      raw.push(...items)
      if (!items.length) break
      offset += PAGE
    }

    const items = raw
      .filter((it: any) => it?.product)
      .map((it: any) => ({
        position: it.position ?? 0,
        title: clean(it.product.title ?? it.product.originalTitle),
        original_title: it.product.originalTitle ? clean(it.product.originalTitle) : null,
        year: typeof it.product.yearOfProduction === 'number' ? it.product.yearOfProduction : null,
        type: mapType(it.product.category, it.product.universe),
      }))
      .sort((a, b) => a.position - b.position)

    res.json({
      title: clean(meta.label) || 'Liste SensCritique',
      cover: meta.cover ?? meta.firstProductBackdrop ?? null,
      description: meta.description ? clean(meta.description).slice(0, 500) : null,
      likes: Number(meta.likePositiveCount ?? 0),
      total: items.length,
      source_url: url,
      items,
    })
  } catch (e: any) {
    res.status(502).json({ error: `Échec du chargement : ${e.message}` })
  }
})

export default router
