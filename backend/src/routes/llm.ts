import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import {
  LLM_PROVIDERS,
  DEFAULT_MODELS,
  isLlmProvider,
  isConfigured,
  effectiveModel,
  getProviderConfig,
  getActiveProvider,
  callProvider,
  type LlmProvider,
  type ProviderConfig,
} from '../llm'

const router = Router()

// GET /api/llm : état des 4 fournisseurs + fournisseur actif. NE renvoie JAMAIS la
// clé API en clair (juste has_key). configured = appelable en l'état.
router.get('/', async (_req, res) => {
  const active = await getActiveProvider()
  const providers = []
  for (const provider of LLM_PROVIDERS) {
    const cfg = await getProviderConfig(provider)
    providers.push({
      provider,
      configured: isConfigured(cfg),
      has_key: !!(cfg?.api_key && cfg.api_key.trim()),
      base_url: cfg?.base_url ?? null,
      model: cfg ? effectiveModel(cfg) : DEFAULT_MODELS[provider],
    })
  }
  res.json({ active_provider: active, providers })
})

const UpsertSchema = z.object({
  api_key: z.string().optional(),
  base_url: z.string().optional(),
  model: z.string().optional(),
})

// PUT /api/llm/:provider : upsert la config. Une api_key vide n'écrase PAS la clé
// existante (permet de modifier juste le modèle/url sans renvoyer la clé).
router.put('/:provider', async (req, res) => {
  const provider = req.params.provider
  if (!isLlmProvider(provider)) return res.status(400).json({ error: 'unknown_provider' })
  const parsed = UpsertSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const existing = await getProviderConfig(provider)
  const body = parsed.data

  // api_key : conserve l'existante si le champ est absent ou vide.
  const apiKey = body.api_key && body.api_key.trim()
    ? body.api_key.trim()
    : (existing?.api_key ?? null)

  // base_url / model : applique si fourni (chaîne vide = effacement explicite),
  // sinon garde l'existant. Le model par défaut sera appliqué si on laisse vide.
  const baseUrl = body.base_url !== undefined ? (body.base_url.trim() || null) : (existing?.base_url ?? null)
  const model = body.model !== undefined ? (body.model.trim() || null) : (existing?.model ?? null)

  await db.execute({
    sql: `INSERT INTO llm_providers (provider, api_key, base_url, model, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(provider) DO UPDATE SET
            api_key = excluded.api_key,
            base_url = excluded.base_url,
            model = excluded.model,
            updated_at = excluded.updated_at`,
    args: [provider, apiKey, baseUrl, model, Date.now()],
  })
  res.json({ ok: true })
})

// POST /api/llm/active : définit le fournisseur actif (doit être configuré).
const ActiveSchema = z.object({ provider: z.string() })
router.post('/active', async (req, res) => {
  const parsed = ActiveSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const provider = parsed.data.provider
  if (!isLlmProvider(provider)) return res.status(400).json({ error: 'unknown_provider' })
  const cfg = await getProviderConfig(provider)
  if (!isConfigured(cfg)) return res.status(400).json({ error: 'not_configured' })
  await db.execute({ sql: 'UPDATE llm_settings SET active_provider = ? WHERE id = 1', args: [provider] })
  res.json({ ok: true, active_provider: provider })
})

// POST /api/llm/:provider/test : appel minimal (timeout 20s). Utilise le model stocké.
router.post('/:provider/test', async (req, res) => {
  const provider = req.params.provider
  if (!isLlmProvider(provider)) return res.status(400).json({ error: 'unknown_provider' })
  const cfg = await getProviderConfig(provider)
  if (!isConfigured(cfg)) return res.status(400).json({ ok: false, error: 'not_configured' })
  const t0 = Date.now()
  try {
    const sample = await callProvider(cfg as ProviderConfig, 'Réponds simplement « OK ».', {
      maxTokens: 16,
      timeoutMs: 20000,
    })
    res.json({ ok: true, latency_ms: Date.now() - t0, sample: (sample || '').slice(0, 200) })
  } catch (e: any) {
    res.json({ ok: false, latency_ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 300) })
  }
})

// DELETE /api/llm/:provider : efface la config (et désactive s'il était actif).
router.delete('/:provider', async (req, res) => {
  const provider = req.params.provider
  if (!isLlmProvider(provider)) return res.status(400).json({ error: 'unknown_provider' })
  await db.execute({ sql: 'DELETE FROM llm_providers WHERE provider = ?', args: [provider] })
  await db.execute({ sql: 'UPDATE llm_settings SET active_provider = NULL WHERE id = 1 AND active_provider = ?', args: [provider] })
  res.json({ ok: true })
})

export default router
