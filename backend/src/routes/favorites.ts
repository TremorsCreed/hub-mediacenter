import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'

const router = Router()

// Tous les endpoints opèrent sur le profil courant (header X-User-Id → req.userId).

router.get('/', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.json([])
  const { rows } = await db.execute({
    sql: 'SELECT id, app, ref_id, ref_type, title, thumb, created_at FROM favorites WHERE user_id = ? ORDER BY created_at DESC',
    args: [userId],
  })
  res.json(rows)
})

const AddSchema = z.object({
  app: z.string().min(1),
  ref_id: z.string().min(1),
  ref_type: z.string().optional(),
  title: z.string().optional(),
  thumb: z.string().optional(),
})

router.post('/', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.status(403).json({ error: 'no_profile' })
  const parsed = AddSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const { app, ref_id, ref_type, title, thumb } = parsed.data

  await db.execute({
    sql: `INSERT INTO favorites (user_id, app, ref_id, ref_type, title, thumb, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, app, ref_id) DO UPDATE SET title = excluded.title, thumb = excluded.thumb, ref_type = excluded.ref_type`,
    args: [userId, app, ref_id, ref_type ?? null, title ?? null, thumb ?? null, Date.now()],
  })
  res.json({ ok: true })
})

// Suppression par référence (app + ref_id) — pratique pour le toggle côté UI.
router.delete('/', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.status(403).json({ error: 'no_profile' })
  const app = req.query.app as string | undefined
  const ref_id = req.query.ref_id as string | undefined
  if (!app || !ref_id) return res.status(400).json({ error: 'app et ref_id requis' })
  await db.execute({
    sql: 'DELETE FROM favorites WHERE user_id = ? AND app = ? AND ref_id = ?',
    args: [userId, app, ref_id],
  })
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.status(403).json({ error: 'no_profile' })
  await db.execute({ sql: 'DELETE FROM favorites WHERE id = ? AND user_id = ?', args: [parseInt(req.params.id, 10), userId] })
  res.json({ ok: true })
})

export default router
