import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'

const router = Router()

// Suivi « vu » du profil courant (header X-User-Id → req.userId). Fondation du futur
// algo de reco : on enregistre quoi a été vu (film/série/saison/épisode/jeu), avec
// parent_id pour relier un épisode/saison à sa série.

router.get('/', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.json([])
  const { rows } = await db.execute({
    sql: 'SELECT id, app, ref_id, ref_type, title, thumb, parent_id, watched_at FROM watched WHERE user_id = ? ORDER BY watched_at DESC',
    args: [userId],
  })
  res.json(rows)
})

const ItemSchema = z.object({
  app: z.string().min(1),
  ref_id: z.string().min(1),
  ref_type: z.string().optional(),
  title: z.string().optional(),
  thumb: z.string().optional(),
  parent_id: z.string().optional(),
})

async function upsert(userId: number, it: z.infer<typeof ItemSchema>) {
  await db.execute({
    sql: `INSERT INTO watched (user_id, app, ref_id, ref_type, title, thumb, parent_id, watched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, app, ref_id) DO UPDATE SET
            ref_type = excluded.ref_type, title = excluded.title, thumb = excluded.thumb,
            parent_id = COALESCE(excluded.parent_id, watched.parent_id), watched_at = excluded.watched_at`,
    args: [userId, it.app, it.ref_id, it.ref_type ?? null, it.title ?? null, it.thumb ?? null, it.parent_id ?? null, Date.now()],
  })
}

// Marque un élément comme vu.
router.post('/', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.status(403).json({ error: 'no_profile' })
  const parsed = ItemSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  await upsert(userId, parsed.data)
  res.json({ ok: true })
})

// Marque plusieurs éléments d'un coup (ex. « saison vue » → tous ses épisodes).
const BulkSchema = z.object({ items: z.array(ItemSchema).min(1).max(500) })
router.post('/bulk', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.status(403).json({ error: 'no_profile' })
  const parsed = BulkSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  for (const it of parsed.data.items) await upsert(userId, it)
  res.json({ ok: true, count: parsed.data.items.length })
})

// Retire « vu » par référence (toggle UI).
router.delete('/', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.status(403).json({ error: 'no_profile' })
  const app = req.query.app as string | undefined
  const ref_id = req.query.ref_id as string | undefined
  if (!app || !ref_id) return res.status(400).json({ error: 'app et ref_id requis' })
  await db.execute({ sql: 'DELETE FROM watched WHERE user_id = ? AND app = ? AND ref_id = ?', args: [userId, app, ref_id] })
  res.json({ ok: true })
})

// Retire plusieurs « vu » (ex. « saison non vue »).
router.post('/unbulk', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.status(403).json({ error: 'no_profile' })
  const parsed = z.object({ app: z.string(), ref_ids: z.array(z.string()).min(1).max(500) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  for (const ref_id of parsed.data.ref_ids) {
    await db.execute({ sql: 'DELETE FROM watched WHERE user_id = ? AND app = ? AND ref_id = ?', args: [userId, parsed.data.app, ref_id] })
  }
  res.json({ ok: true })
})

export default router
