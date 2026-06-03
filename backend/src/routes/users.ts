import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import { hashPin, verifyPin, issueAdminToken, requireAdmin } from '../auth'

const router = Router()

// Liste des profils (public — sert à l'écran « Qui regarde ? »).
// N'expose jamais le pin_hash, juste un booléen has_pin.
router.get('/', async (_req, res) => {
  const { rows } = await db.execute(
    'SELECT id, name, avatar_color, is_admin, (pin_hash IS NOT NULL) as has_pin, created_at FROM users ORDER BY is_admin DESC, name'
  )
  res.json(rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    avatar_color: r.avatar_color,
    is_admin: !!r.is_admin,
    has_pin: !!r.has_pin,
    created_at: r.created_at,
  })))
})

// Vérifie un PIN admin → émet un token de session (la « barrière » de la section Admin).
const VerifyPinSchema = z.object({ pin: z.string().min(1) })
router.post('/verify-pin', async (req, res) => {
  const parsed = VerifyPinSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'pin requis' })

  const { rows } = await db.execute('SELECT id, name, pin_hash FROM users WHERE is_admin = 1')
  const match = rows.find((r: any) => verifyPin(parsed.data.pin, r.pin_hash as string))
  if (!match) return res.status(401).json({ error: 'PIN incorrect' })

  res.json({ ok: true, token: issueAdminToken(), admin: { id: (match as any).id, name: (match as any).name } })
})

// ── Mutations : réservées à l'admin (token requis) ───────────────────────────
const CreateSchema = z.object({
  name: z.string().min(1).max(40),
  avatar_color: z.string().optional(),
  is_admin: z.boolean().optional(),
  pin: z.string().min(4).max(8).optional(),
})
router.post('/', requireAdmin, async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const { name, avatar_color, is_admin, pin } = parsed.data
  if (is_admin && !pin) return res.status(400).json({ error: 'Un profil admin nécessite un PIN' })

  const { rows } = await db.execute({
    sql: 'INSERT INTO users (name, avatar_color, is_admin, pin_hash, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
    args: [name, avatar_color ?? '#f59e0b', is_admin ? 1 : 0, is_admin && pin ? hashPin(pin) : null, Date.now()]
  })
  res.json({ ok: true, id: (rows[0] as any).id })
})

const UpdateSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  avatar_color: z.string().optional(),
  is_admin: z.boolean().optional(),
  pin: z.string().min(4).max(8).optional(), // si fourni, (re)définit le PIN
})
router.put('/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const parsed = UpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { rows: existRows } = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] })
  if (!existRows.length) return res.status(404).json({ error: 'profil introuvable' })
  const cur = existRows[0] as any

  const willBeAdmin = parsed.data.is_admin ?? !!cur.is_admin
  // Empêche de rétrograder le dernier admin
  if (cur.is_admin && parsed.data.is_admin === false) {
    const { rows: adm } = await db.execute('SELECT COUNT(*) as n FROM users WHERE is_admin = 1')
    if (Number((adm[0] as any).n) <= 1) return res.status(400).json({ error: 'Impossible : c\'est le dernier admin' })
  }
  const newPinHash = parsed.data.pin ? hashPin(parsed.data.pin)
    : (willBeAdmin ? cur.pin_hash : null) // un profil redevenu membre perd son PIN

  await db.execute({
    sql: 'UPDATE users SET name = ?, avatar_color = ?, is_admin = ?, pin_hash = ? WHERE id = ?',
    args: [
      parsed.data.name ?? cur.name,
      parsed.data.avatar_color ?? cur.avatar_color,
      willBeAdmin ? 1 : 0,
      newPinHash,
      id,
    ]
  })
  res.json({ ok: true })
})

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const { rows } = await db.execute({ sql: 'SELECT is_admin FROM users WHERE id = ?', args: [id] })
  if (!rows.length) return res.status(404).json({ error: 'profil introuvable' })
  if ((rows[0] as any).is_admin) {
    const { rows: adm } = await db.execute('SELECT COUNT(*) as n FROM users WHERE is_admin = 1')
    if (Number((adm[0] as any).n) <= 1) return res.status(400).json({ error: 'Impossible : c\'est le dernier admin' })
  }
  await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [id] })
  res.json({ ok: true })
})

export default router
