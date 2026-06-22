import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import { isValidAdminToken } from '../auth'

const router = Router()

function ctx(req: any) {
  return {
    userId: (req.userId ?? null) as number | null,
    isAdmin: isValidAdminToken(req.header('X-Admin-Token') ?? undefined),
  }
}

// Une playlist est visible si : on en est propriétaire, ou elle est partagée, ou on est admin.
async function canSee(req: any, pl: any): Promise<boolean> {
  const { userId, isAdmin } = ctx(req)
  return isAdmin || pl.is_shared === 1 || pl.owner_user_id === userId
}
async function canEdit(req: any, pl: any): Promise<boolean> {
  const { userId, isAdmin } = ctx(req)
  return isAdmin || pl.owner_user_id === userId
}

// GET / — playlists visibles, avec compteur d'items et nom du propriétaire
router.get('/', async (req, res) => {
  const { userId, isAdmin } = ctx(req)
  const { rows } = await db.execute({
    sql: `
      SELECT p.*, u.name as owner_name,
             (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) as item_count
      FROM playlists p
      LEFT JOIN users u ON u.id = p.owner_user_id
      WHERE ? = 1 OR p.is_shared = 1 OR p.owner_user_id = ?
      ORDER BY p.updated_at DESC
    `,
    args: [isAdmin ? 1 : 0, userId],
  })
  res.json(rows)
})

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  cover: z.string().optional(),
  is_shared: z.boolean().optional(),
  source: z.string().optional(),
  source_url: z.string().optional(),
})
router.post('/', async (req, res) => {
  const { userId } = ctx(req)
  if (userId == null) return res.status(403).json({ error: 'no_profile' })
  const parsed = CreateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const d = parsed.data
  const now = Date.now()
  const { rows } = await db.execute({
    sql: `INSERT INTO playlists (owner_user_id, name, description, cover, is_shared, source, source_url, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [userId, d.name, d.description ?? null, d.cover ?? null, d.is_shared ? 1 : 0, d.source ?? 'manual', d.source_url ?? null, now, now],
  })
  res.json({ ok: true, id: (rows[0] as any).id })
})

async function loadPlaylist(id: number) {
  const { rows } = await db.execute({ sql: 'SELECT * FROM playlists WHERE id = ?', args: [id] })
  return (rows[0] as any) ?? null
}

// GET /:id — détail + items ordonnés
router.get('/:id', async (req, res) => {
  const pl = await loadPlaylist(parseInt(req.params.id, 10))
  if (!pl) return res.status(404).json({ error: 'introuvable' })
  if (!await canSee(req, pl)) return res.status(403).json({ error: 'forbidden' })
  const { rows: items } = await db.execute({
    sql: 'SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position, id',
    args: [pl.id],
  })
  res.json({ ...pl, items })
})

const UpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().nullable().optional(),
  cover: z.string().nullable().optional(),
  is_shared: z.boolean().optional(),
})
router.put('/:id', async (req, res) => {
  const pl = await loadPlaylist(parseInt(req.params.id, 10))
  if (!pl) return res.status(404).json({ error: 'introuvable' })
  if (!await canEdit(req, pl)) return res.status(403).json({ error: 'forbidden' })
  const parsed = UpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const d = parsed.data
  await db.execute({
    sql: 'UPDATE playlists SET name = ?, description = ?, cover = ?, is_shared = ?, updated_at = ? WHERE id = ?',
    args: [
      d.name ?? pl.name,
      d.description === undefined ? pl.description : d.description,
      d.cover === undefined ? pl.cover : d.cover,
      d.is_shared === undefined ? pl.is_shared : (d.is_shared ? 1 : 0),
      Date.now(),
      pl.id,
    ],
  })
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  const pl = await loadPlaylist(parseInt(req.params.id, 10))
  if (!pl) return res.status(404).json({ error: 'introuvable' })
  if (!await canEdit(req, pl)) return res.status(403).json({ error: 'forbidden' })
  await db.execute({ sql: 'DELETE FROM playlist_items WHERE playlist_id = ?', args: [pl.id] })
  await db.execute({ sql: 'DELETE FROM playlists WHERE id = ?', args: [pl.id] })
  res.json({ ok: true })
})

// POST /:id/items — ajoute un item en fin de liste
const ItemSchema = z.object({
  app: z.string().min(1),
  ref_id: z.string().optional(),
  ref_type: z.string().optional(),
  title: z.string().optional(),
  year: z.number().optional(),
  thumb: z.string().optional(),
  lang: z.string().optional(),
  ext: z.string().optional(),
  status: z.enum(['resolved', 'missing']).optional(),
})
router.post('/:id/items', async (req, res) => {
  const pl = await loadPlaylist(parseInt(req.params.id, 10))
  if (!pl) return res.status(404).json({ error: 'introuvable' })
  if (!await canEdit(req, pl)) return res.status(403).json({ error: 'forbidden' })
  const parsed = ItemSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const d = parsed.data
  const { rows: maxRows } = await db.execute({ sql: 'SELECT COALESCE(MAX(position), -1) + 1 as pos FROM playlist_items WHERE playlist_id = ?', args: [pl.id] })
  const pos = Number((maxRows[0] as any).pos)
  const { rows } = await db.execute({
    sql: `INSERT INTO playlist_items (playlist_id, position, app, ref_id, ref_type, title, year, thumb, lang, ext, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [pl.id, pos, d.app, d.ref_id ?? null, d.ref_type ?? null, d.title ?? null, d.year ?? null, d.thumb ?? null, d.lang ?? null, d.ext ?? null, d.status ?? 'resolved', Date.now()],
  })
  await db.execute({ sql: 'UPDATE playlists SET updated_at = ? WHERE id = ?', args: [Date.now(), pl.id] })
  res.json({ ok: true, id: (rows[0] as any).id })
})

// PUT /:id/items — remplace TOUS les items (édition JSON en masse) : la liste reçue
// devient la playlist, dans l'ordre donné. Transaction : purge puis ré-insertion.
const ReplaceSchema = z.object({ items: z.array(ItemSchema) })
router.put('/:id/items', async (req, res) => {
  const pl = await loadPlaylist(parseInt(req.params.id, 10))
  if (!pl) return res.status(404).json({ error: 'introuvable' })
  if (!await canEdit(req, pl)) return res.status(403).json({ error: 'forbidden' })
  const parsed = ReplaceSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const now = Date.now()
  const tx = await db.transaction('write')
  try {
    await tx.execute({ sql: 'DELETE FROM playlist_items WHERE playlist_id = ?', args: [pl.id] })
    for (let i = 0; i < parsed.data.items.length; i++) {
      const d = parsed.data.items[i]
      await tx.execute({
        sql: `INSERT INTO playlist_items (playlist_id, position, app, ref_id, ref_type, title, year, thumb, lang, ext, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [pl.id, i, d.app, d.ref_id ?? null, d.ref_type ?? null, d.title ?? null, d.year ?? null, d.thumb ?? null, d.lang ?? null, d.ext ?? null, d.status ?? 'resolved', now],
      })
    }
    await tx.execute({ sql: 'UPDATE playlists SET updated_at = ? WHERE id = ?', args: [now, pl.id] })
    await tx.commit()
  } catch (e) {
    await tx.rollback()
    throw e
  }
  res.json({ ok: true, count: parsed.data.items.length })
})

// PUT /:id/items/:itemId — ré-lie un item à une autre source/version (résolution manuelle,
// choix d'une version précise). Ne touche pas à la position.
const ItemRebindSchema = z.object({
  app: z.string().min(1),
  ref_id: z.string().nullable().optional(),
  ref_type: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  year: z.number().nullable().optional(),
  thumb: z.string().nullable().optional(),
  lang: z.string().nullable().optional(),
  ext: z.string().nullable().optional(),
  status: z.enum(['resolved', 'missing']).optional(),
})
router.put('/:id/items/:itemId', async (req, res) => {
  const pl = await loadPlaylist(parseInt(req.params.id, 10))
  if (!pl) return res.status(404).json({ error: 'introuvable' })
  if (!await canEdit(req, pl)) return res.status(403).json({ error: 'forbidden' })
  const parsed = ItemRebindSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const d = parsed.data
  const { rows: cur } = await db.execute({ sql: 'SELECT * FROM playlist_items WHERE id = ? AND playlist_id = ?', args: [parseInt(req.params.itemId, 10), pl.id] })
  const it = cur[0] as any
  if (!it) return res.status(404).json({ error: 'item introuvable' })
  await db.execute({
    sql: `UPDATE playlist_items SET app = ?, ref_id = ?, ref_type = ?, title = ?, year = ?, thumb = ?, lang = ?, ext = ?, status = ?
          WHERE id = ? AND playlist_id = ?`,
    args: [
      d.app,
      d.ref_id === undefined ? it.ref_id : d.ref_id,
      d.ref_type === undefined ? it.ref_type : d.ref_type,
      d.title === undefined ? it.title : d.title,
      d.year === undefined ? it.year : d.year,
      d.thumb === undefined ? it.thumb : d.thumb,
      d.lang === undefined ? it.lang : d.lang,
      d.ext === undefined ? it.ext : d.ext,
      d.status ?? 'resolved',
      it.id, pl.id,
    ],
  })
  await db.execute({ sql: 'UPDATE playlists SET updated_at = ? WHERE id = ?', args: [Date.now(), pl.id] })
  res.json({ ok: true })
})

router.delete('/:id/items/:itemId', async (req, res) => {
  const pl = await loadPlaylist(parseInt(req.params.id, 10))
  if (!pl) return res.status(404).json({ error: 'introuvable' })
  if (!await canEdit(req, pl)) return res.status(403).json({ error: 'forbidden' })
  await db.execute({ sql: 'DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?', args: [parseInt(req.params.itemId, 10), pl.id] })
  await db.execute({ sql: 'UPDATE playlists SET updated_at = ? WHERE id = ?', args: [Date.now(), pl.id] })
  res.json({ ok: true })
})

// PUT /:id/reorder — body { order: number[] } (ids d'items dans le nouvel ordre)
router.put('/:id/reorder', async (req, res) => {
  const pl = await loadPlaylist(parseInt(req.params.id, 10))
  if (!pl) return res.status(404).json({ error: 'introuvable' })
  if (!await canEdit(req, pl)) return res.status(403).json({ error: 'forbidden' })
  const parsed = z.object({ order: z.array(z.number()) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const tx = await db.transaction('write')
  try {
    for (let i = 0; i < parsed.data.order.length; i++) {
      await tx.execute({ sql: 'UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?', args: [i, parsed.data.order[i], pl.id] })
    }
    await tx.execute({ sql: 'UPDATE playlists SET updated_at = ? WHERE id = ?', args: [Date.now(), pl.id] })
    await tx.commit()
  } catch (e) {
    await tx.rollback()
    throw e
  }
  res.json({ ok: true })
})

export default router
