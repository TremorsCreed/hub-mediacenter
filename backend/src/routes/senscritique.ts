import { Router } from 'express'
import { z } from 'zod'

const router = Router()

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function clean(s: any): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

// Scrape une liste SensCritique via le JSON __NEXT_DATA__ (Apollo state).
// Renvoie { title, cover, description, likes, total, source_url, items[] }.
// items = { position, title, original_title, year, type:'movie'|'series' } (les ~30
// premiers, SensCritique paginant le rendu serveur à 30).
router.post('/scrape', async (req, res) => {
  const parsed = z.object({ url: z.string().min(8) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'url requise' })
  let url = parsed.data.url.trim()
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  if (!/senscritique\.com\/liste\//i.test(url)) {
    return res.status(400).json({ error: 'URL de liste SensCritique attendue (format .../liste/...)' })
  }

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' },
      signal: AbortSignal.timeout(15000) as any,
    })
    if (!r.ok) return res.status(502).json({ error: `SensCritique a répondu ${r.status}` })
    const html = await r.text()
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
    if (!m) return res.status(422).json({ error: 'Structure SensCritique non reconnue (page modifiée ?).' })

    const data = JSON.parse(m[1])
    const apollo = data?.props?.pageProps?.__APOLLO_STATE__
    if (!apollo) return res.status(422).json({ error: 'Données de la liste introuvables.' })

    const ulKey = Object.keys(apollo).find(k => k.startsWith('UserList:'))
    if (!ulKey) return res.status(422).json({ error: 'Liste introuvable dans la page.' })
    const ul = apollo[ulKey]

    const plKey = Object.keys(ul).find(k => k.startsWith('productsList'))
    const rawItems: any[] = (plKey ? ul[plKey]?.items : []) ?? []

    const items = rawItems.map((it: any) => {
      const ref = it?.product?.__ref
      const p = ref ? apollo[ref] : null
      if (!p) return null
      const cat = String(p.category ?? '').toLowerCase()
      const type = cat.includes('série') || cat.includes('serie') || p.universe === 4 ? 'series' : 'movie'
      return {
        position: it.position ?? 0,
        title: clean(p.title ?? p.originalTitle),
        original_title: p.originalTitle ? clean(p.originalTitle) : null,
        year: typeof p.yearOfProduction === 'number' ? p.yearOfProduction : null,
        type,
      }
    }).filter(Boolean).sort((a: any, b: any) => a.position - b.position)

    res.json({
      title: clean(ul.label) || 'Liste SensCritique',
      cover: ul.cover ?? ul.firstProductBackdrop ?? null,
      description: ul.description ? clean(ul.description).slice(0, 500) : null,
      likes: Number(ul.likePositiveCount ?? 0),
      total: Number(ul.productCount ?? items.length),
      source_url: url,
      items,
    })
  } catch (e: any) {
    res.status(502).json({ error: `Échec du chargement : ${e.message}` })
  }
})

export default router
