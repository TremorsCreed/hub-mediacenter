import { Router } from 'express'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db'

const router = Router()

router.get('/search', async (req, res) => {
  const q = (req.query.q as string ?? '').trim()
  const { rows } = q
    ? await db.execute({ sql: `SELECT * FROM catalog WHERE title LIKE ? ORDER BY title LIMIT 50`, args: [`%${q}%`] })
    : await db.execute('SELECT * FROM catalog ORDER BY title LIMIT 100')
  res.json(rows)
})

router.get('/ean/:ean', async (req, res) => {
  const { rows } = await db.execute({
    sql: `SELECT c.* FROM catalog c
          LEFT JOIN ean_mappings e ON e.catalog_id = c.id
          WHERE c.ean = ? OR e.ean = ? LIMIT 1`,
    args: [req.params.ean, req.params.ean]
  })
  if (!rows.length) return res.status(404).json({ error: 'EAN not found' })
  res.json(rows[0])
})

const CatalogSchema = z.object({
  title: z.string().min(1),
  type: z.enum(['movie', 'episode', 'music', 'live_channel', 'vod']),
  ean: z.string().optional(),
  year: z.number().int().optional(),
  plex_id: z.string().optional(),
  tivimate_id: z.string().optional(),
  thumbnail: z.string().url().optional(),
  metadata: z.record(z.unknown()).default({})
})

router.post('/', async (req, res) => {
  const parsed = CatalogSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const id = uuidv4()
  const { title, type, ean, year, plex_id, tivimate_id, thumbnail, metadata } = parsed.data

  await db.execute({
    sql: `INSERT INTO catalog (id, title, type, ean, year, plex_id, tivimate_id, thumbnail, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, title, type, ean ?? null, year ?? null, plex_id ?? null, tivimate_id ?? null, thumbnail ?? null, JSON.stringify(metadata)]
  })

  if (ean) {
    await db.execute({
      sql: `INSERT INTO ean_mappings (ean, catalog_id) VALUES (?, ?)
            ON CONFLICT(ean) DO UPDATE SET catalog_id = excluded.catalog_id`,
      args: [ean, id]
    })
  }

  res.status(201).json({ ok: true, id })
})

router.put('/:id', async (req, res) => {
  const { rows } = await db.execute({ sql: 'SELECT id FROM catalog WHERE id = ?', args: [req.params.id] })
  if (!rows.length) return res.status(404).json({ error: 'not found' })

  const parsed = CatalogSchema.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const fields = parsed.data
  const sets: string[] = []
  const values: unknown[] = []

  for (const [key, val] of Object.entries(fields)) {
    sets.push(`${key} = ?`)
    values.push(key === 'metadata' ? JSON.stringify(val) : (val ?? null))
  }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' })

  values.push(req.params.id)
  await db.execute({ sql: `UPDATE catalog SET ${sets.join(', ')} WHERE id = ?`, args: values as any[] })

  if (fields.ean) {
    await db.execute({
      sql: `INSERT INTO ean_mappings (ean, catalog_id) VALUES (?, ?)
            ON CONFLICT(ean) DO UPDATE SET catalog_id = excluded.catalog_id`,
      args: [fields.ean, req.params.id]
    })
  }

  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  const result = await db.execute({ sql: 'DELETE FROM catalog WHERE id = ?', args: [req.params.id] })
  if (!result.rowsAffected) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

router.post('/ean', async (req, res) => {
  const schema = z.object({ ean: z.string().min(1), catalog_id: z.string().uuid() })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { ean, catalog_id } = parsed.data
  const { rows } = await db.execute({ sql: 'SELECT id FROM catalog WHERE id = ?', args: [catalog_id] })
  if (!rows.length) return res.status(404).json({ error: 'catalog entry not found' })

  await db.execute({
    sql: `INSERT INTO ean_mappings (ean, catalog_id) VALUES (?, ?)
          ON CONFLICT(ean) DO UPDATE SET catalog_id = excluded.catalog_id`,
    args: [ean, catalog_id]
  })
  res.status(201).json({ ok: true })
})

export default router
