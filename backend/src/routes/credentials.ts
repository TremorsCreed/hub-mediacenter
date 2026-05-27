import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'

const router = Router()

const CredentialSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['xtream']),
  data: z.record(z.unknown()).default({})
}).transform(c => {
  // Trim les champs string du data — les credentials copiés-collés ont souvent des
  // espaces parasites qui cassent les URLs stream (vu en prod sur Elon IPTV).
  if (c.type === 'xtream' && c.data) {
    const trimmed: Record<string, unknown> = { ...c.data }
    for (const k of ['server', 'user', 'pass', 'ext']) {
      if (typeof trimmed[k] === 'string') trimmed[k] = (trimmed[k] as string).trim()
    }
    c.data = trimmed
  }
  return c
})

router.get('/', async (_req, res) => {
  const { rows } = await db.execute('SELECT id, name, type, data, created_at, updated_at FROM credentials ORDER BY name')
  res.json(rows.map((r: any) => ({ ...r, data: JSON.parse(r.data as string) })))
})

router.post('/', async (req, res) => {
  const parsed = CredentialSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const now = Date.now()
  const r = await db.execute({
    sql: 'INSERT INTO credentials (name, type, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    args: [parsed.data.name, parsed.data.type, JSON.stringify(parsed.data.data), now, now]
  })
  res.json({ ok: true, id: Number(r.lastInsertRowid) })
})

router.put('/:id', async (req, res) => {
  const parsed = CredentialSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  await db.execute({
    sql: 'UPDATE credentials SET name = ?, type = ?, data = ?, updated_at = ? WHERE id = ?',
    args: [parsed.data.name, parsed.data.type, JSON.stringify(parsed.data.data), Date.now(), req.params.id]
  })
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  // Détacher des devices qui le référencent
  await db.execute({ sql: 'UPDATE device_config SET xtream_credential_id = NULL WHERE xtream_credential_id = ?', args: [req.params.id] })
  await db.execute({ sql: 'DELETE FROM credentials WHERE id = ?', args: [req.params.id] })
  res.json({ ok: true })
})

export default router
