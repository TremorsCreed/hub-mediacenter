import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'

const router = Router()

// « Favori du moment » / en cours du profil courant : séries ou playlists épinglées.

router.get('/', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.json([])
  const { rows } = await db.execute({
    sql: 'SELECT id, key, kind, app, ref_id, playlist_id, title, thumb, created_at FROM current_picks WHERE user_id = ? ORDER BY created_at DESC',
    args: [userId],
  })
  res.json(rows)
})

const AddSchema = z.object({
  key: z.string().min(1),
  kind: z.string().min(1),          // 'series' | 'show' | 'playlist' | 'movie' …
  app: z.string().optional(),
  ref_id: z.string().optional(),
  playlist_id: z.number().optional(),
  title: z.string().optional(),
  thumb: z.string().optional(),
})

router.post('/', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.status(403).json({ error: 'no_profile' })
  const parsed = AddSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const { key, kind, app, ref_id, playlist_id, title, thumb } = parsed.data
  await db.execute({
    sql: `INSERT INTO current_picks (user_id, key, kind, app, ref_id, playlist_id, title, thumb, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, key) DO UPDATE SET
            kind = excluded.kind, title = excluded.title, thumb = excluded.thumb, created_at = excluded.created_at`,
    args: [userId, key, kind, app ?? null, ref_id ?? null, playlist_id ?? null, title ?? null, thumb ?? null, Date.now()],
  })
  res.json({ ok: true })
})

router.delete('/', async (req, res) => {
  const userId = (req as any).userId as number | null
  if (userId == null) return res.status(403).json({ error: 'no_profile' })
  const key = req.query.key as string | undefined
  if (!key) return res.status(400).json({ error: 'key requis' })
  await db.execute({ sql: 'DELETE FROM current_picks WHERE user_id = ? AND key = ?', args: [userId, key] })
  res.json({ ok: true })
})

export default router
