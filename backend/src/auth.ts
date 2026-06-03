import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import type { Request, Response, NextFunction } from 'express'

// ── Hash de PIN (scrypt, format "salt:hash" en hex) ──────────────────────────
export function hashPin(pin: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(pin, salt, 32)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored || !stored.includes(':')) return false
  const [saltHex, hashHex] = stored.split(':')
  try {
    const salt = Buffer.from(saltHex, 'hex')
    const expected = Buffer.from(hashHex, 'hex')
    const actual = scryptSync(pin, salt, expected.length)
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

// ── Tokens admin de session (en mémoire, expirent au redémarrage) ────────────
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000 // 8h
const adminTokens = new Map<string, number>() // token -> expiry timestamp

export function issueAdminToken(): string {
  const token = randomBytes(24).toString('hex')
  adminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL_MS)
  return token
}

export function isValidAdminToken(token: string | undefined): boolean {
  if (!token) return false
  const exp = adminTokens.get(token)
  if (!exp) return false
  if (Date.now() > exp) { adminTokens.delete(token); return false }
  return true
}

export function revokeAdminToken(token: string | undefined): void {
  if (token) adminTokens.delete(token)
}

// ── Middlewares ──────────────────────────────────────────────────────────────
// Attache l'id du profil courant (sélection façon Netflix, pas d'auth forte).
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const raw = req.header('X-User-Id')
  const id = raw ? parseInt(raw, 10) : NaN
  ;(req as any).userId = Number.isFinite(id) ? id : null
  next()
}

// Exige un token admin valide (émis après vérification du PIN).
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.header('X-Admin-Token') ?? undefined
  if (!isValidAdminToken(token)) {
    res.status(403).json({ error: 'admin_required' })
    return
  }
  next()
}
