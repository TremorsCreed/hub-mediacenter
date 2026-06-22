import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import { hashPin, verifyPin, issueAdminToken, requireAdmin } from '../auth'

const router = Router()

// Parse tolérant (dashboard_prefs peut être vide/corrompu → null plutôt que crash)
function safeParse(s: string): unknown { try { return JSON.parse(s) } catch { return null } }

// Liste des profils (public — sert à l'écran « Qui regarde ? »).
// N'expose jamais le pin_hash, juste un booléen has_pin.
router.get('/', async (_req, res) => {
  const { rows } = await db.execute(
    "SELECT id, name, avatar_color, is_admin, (pin_hash IS NOT NULL) as has_pin, (nfc_token IS NOT NULL) as has_nfc, COALESCE(preferred_lang, 'FR') as preferred_lang, default_device_id, default_player, COALESCE(autoplay_next, 1) as autoplay_next, default_playlist_id, dashboard_prefs, created_at FROM users ORDER BY is_admin DESC, name"
  )
  res.json(rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    avatar_color: r.avatar_color,
    is_admin: !!r.is_admin,
    has_pin: !!r.has_pin,
    has_nfc: !!r.has_nfc,
    preferred_lang: r.preferred_lang,
    default_device_id: r.default_device_id ?? null,
    default_player: r.default_player ?? null,
    default_playlist_id: r.default_playlist_id ?? null,
    autoplay_next: !!r.autoplay_next,
    dashboard_prefs: r.dashboard_prefs ? safeParse(r.dashboard_prefs) : null,
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

// Valide le token admin courant (AdminGate l'appelle à l'entrée de la section :
// un token mort — ex. backend redéployé, tokens en mémoire — déclenche le 403
// admin_required que le frontend intercepte pour redemander le PIN).
router.get('/admin/ping', requireAdmin, (_req, res) => res.json({ ok: true }))

// Vérifie le PIN admin SANS émettre de token (déverrouillage parental d'une
// catégorie : on ne veut pas donner les droits admin au client pour autant).
router.post('/check-pin', async (req, res) => {
  const parsed = VerifyPinSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'pin requis' })
  const { rows } = await db.execute('SELECT pin_hash FROM users WHERE is_admin = 1')
  const ok = rows.some((r: any) => verifyPin(parsed.data.pin, r.pin_hash as string))
  if (!ok) return res.status(401).json({ error: 'PIN incorrect' })
  res.json({ ok: true })
})

// ── Réglages perso (self-service, pas besoin d'être admin) ───────────────────
// Un profil peut modifier SES propres préférences : layout du dashboard + autoplay.
const PrefsSchema = z.object({
  dashboard_prefs: z.any().optional(),
  autoplay_next: z.boolean().optional(),
  default_playlist_id: z.number().nullable().optional(), // playlist cible par défaut (null = aucune)
})
router.put('/:id/prefs', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const userId = (req as any).userId as number | null
  if (userId == null || userId !== id) return res.status(403).json({ error: 'forbidden' })
  const parsed = PrefsSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  if (parsed.data.dashboard_prefs !== undefined) {
    await db.execute({
      sql: 'UPDATE users SET dashboard_prefs = ? WHERE id = ?',
      args: [JSON.stringify(parsed.data.dashboard_prefs), id],
    })
  }
  if (parsed.data.autoplay_next !== undefined) {
    await db.execute({
      sql: 'UPDATE users SET autoplay_next = ? WHERE id = ?',
      args: [parsed.data.autoplay_next ? 1 : 0, id],
    })
  }
  if (parsed.data.default_playlist_id !== undefined) {
    await db.execute({
      sql: 'UPDATE users SET default_playlist_id = ? WHERE id = ?',
      args: [parsed.data.default_playlist_id, id],
    })
  }
  res.json({ ok: true })
})

// ── Mutations : réservées à l'admin (token requis) ───────────────────────────
const CreateSchema = z.object({
  name: z.string().min(1).max(40),
  avatar_color: z.string().optional(),
  is_admin: z.boolean().optional(),
  pin: z.string().min(4).max(8).optional(),
  nfc_token: z.string().optional(),
  preferred_lang: z.string().optional(),
})
router.post('/', requireAdmin, async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const { name, avatar_color, is_admin, pin, nfc_token, preferred_lang } = parsed.data
  if (is_admin && !pin) return res.status(400).json({ error: 'Un profil admin nécessite un PIN' })

  try {
    const { rows } = await db.execute({
      sql: 'INSERT INTO users (name, avatar_color, is_admin, pin_hash, nfc_token, preferred_lang, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
      args: [name, avatar_color ?? '#f59e0b', is_admin ? 1 : 0, is_admin && pin ? hashPin(pin) : null, nfc_token?.trim() || null, (preferred_lang ?? 'FR').toUpperCase(), Date.now()]
    })
    res.json({ ok: true, id: (rows[0] as any).id })
  } catch (e: any) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Cette carte NFC est déjà associée à un profil' })
    throw e
  }
})

const UpdateSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  avatar_color: z.string().optional(),
  is_admin: z.boolean().optional(),
  pin: z.string().min(4).max(8).optional(),       // si fourni, (re)définit le PIN
  nfc_token: z.string().nullable().optional(),    // undefined = inchangé · null/'' = retire · valeur = associe
  preferred_lang: z.string().optional(),
  default_device_id: z.string().nullable().optional(),  // null/'' = aucun défaut
  default_player: z.string().nullable().optional(),     // null/'' = suit le réglage du device
  autoplay_next: z.boolean().optional(),                // autoplay de l'épisode suivant
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

  // nfc_token : undefined = inchangé ; null ou '' = retire ; valeur = (ré)associe
  const newNfc = parsed.data.nfc_token === undefined
    ? cur.nfc_token
    : (parsed.data.nfc_token?.trim() || null)

  // Défauts par profil : undefined = inchangé ; null ou '' = retire ; valeur = définit
  const newDefaultDevice = parsed.data.default_device_id === undefined
    ? cur.default_device_id
    : (parsed.data.default_device_id?.trim() || null)
  const newDefaultPlayer = parsed.data.default_player === undefined
    ? cur.default_player
    : (parsed.data.default_player?.trim() || null)

  const newAutoplay = parsed.data.autoplay_next === undefined
    ? (cur.autoplay_next ?? 1)
    : (parsed.data.autoplay_next ? 1 : 0)

  try {
    await db.execute({
      sql: 'UPDATE users SET name = ?, avatar_color = ?, is_admin = ?, pin_hash = ?, nfc_token = ?, preferred_lang = ?, default_device_id = ?, default_player = ?, autoplay_next = ? WHERE id = ?',
      args: [
        parsed.data.name ?? cur.name,
        parsed.data.avatar_color ?? cur.avatar_color,
        willBeAdmin ? 1 : 0,
        newPinHash,
        newNfc,
        (parsed.data.preferred_lang ?? cur.preferred_lang ?? 'FR').toUpperCase(),
        newDefaultDevice,
        newDefaultPlayer,
        newAutoplay,
        id,
      ]
    })
    res.json({ ok: true })
  } catch (e: any) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Cette carte NFC est déjà associée à un profil' })
    throw e
  }
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
