import { db } from './db'

// Connecteur LLM générique : routage vers Claude / OpenAI / Gemini / Ollama selon
// le fournisseur actif configuré dans Admin. Helper réutilisable par tout le Hub
// (premier consommateur : le Companion, extraction de titres depuis des commentaires).

export type LlmProvider = 'claude' | 'openai' | 'gemini' | 'ollama'

export const LLM_PROVIDERS: LlmProvider[] = ['claude', 'openai', 'gemini', 'ollama']

export function isLlmProvider(p: string): p is LlmProvider {
  return (LLM_PROVIDERS as string[]).includes(p)
}

// Modèle par défaut par fournisseur (utilisé si non renseigné à la connexion).
// Tâches d'extraction = peu coûteuses, on vise des modèles légers.
export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  claude: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  ollama: 'llama3.1',
}

export interface ProviderConfig {
  provider: LlmProvider
  api_key: string | null
  base_url: string | null
  model: string | null
}

// Un fournisseur est « configuré » si on a de quoi l'appeler : une clé API pour
// les 3 cloud, une base_url pour Ollama (local, sans clé).
export function isConfigured(cfg: ProviderConfig | null): boolean {
  if (!cfg) return false
  if (cfg.provider === 'ollama') return !!(cfg.base_url && cfg.base_url.trim())
  return !!(cfg.api_key && cfg.api_key.trim())
}

export function effectiveModel(cfg: ProviderConfig): string {
  return (cfg.model && cfg.model.trim()) || DEFAULT_MODELS[cfg.provider]
}

export async function getProviderConfig(provider: LlmProvider): Promise<ProviderConfig | null> {
  const { rows } = await db.execute({
    sql: 'SELECT provider, api_key, base_url, model FROM llm_providers WHERE provider = ?',
    args: [provider],
  })
  if (!rows.length) return null
  const r = rows[0] as any
  return {
    provider,
    api_key: (r.api_key as string) ?? null,
    base_url: (r.base_url as string) ?? null,
    model: (r.model as string) ?? null,
  }
}

export async function getActiveProvider(): Promise<LlmProvider | null> {
  const { rows } = await db.execute('SELECT active_provider FROM llm_settings WHERE id = 1')
  const v = rows.length ? (rows[0] as any).active_provider : null
  return v && isLlmProvider(v) ? v : null
}

interface CallOpts { system?: string; maxTokens?: number; timeoutMs?: number }

// Appel bas niveau d'un fournisseur donné avec une config explicite. Lève en cas
// d'erreur HTTP/réseau (le caller décide quoi en faire). Renvoie le texte produit.
export async function callProvider(
  cfg: ProviderConfig,
  prompt: string,
  opts: CallOpts = {}
): Promise<string> {
  const model = effectiveModel(cfg)
  const maxTokens = opts.maxTokens ?? 1024
  const system = opts.system
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 20000)

  if (cfg.provider === 'claude') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': cfg.api_key ?? '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    })
    if (!res.ok) throw new Error(`claude ${res.status}: ${await res.text()}`)
    const data: any = await res.json()
    return data?.content?.[0]?.text ?? ''
  }

  if (cfg.provider === 'openai') {
    const messages: any[] = []
    if (system) messages.push({ role: 'system', content: system })
    messages.push({ role: 'user', content: prompt })
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.api_key ?? ''}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
      signal,
    })
    if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`)
    const data: any = await res.json()
    return data?.choices?.[0]?.message?.content ?? ''
  }

  if (cfg.provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.api_key ?? '')}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      }),
      signal,
    })
    if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`)
    const data: any = await res.json()
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  }

  // ollama (local) : base_url obligatoire.
  const base = (cfg.base_url ?? '').replace(/\/+$/, '')
  if (!base) throw new Error('ollama: base_url manquante')
  const messages: any[] = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
    signal,
  })
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`)
  const data: any = await res.json()
  return data?.message?.content ?? ''
}

// Point d'entrée pour le reste du Hub : lit le fournisseur actif + sa config en
// base, route vers le bon appel, renvoie le texte (ou null si aucun fournisseur
// configuré/actif, ou en cas d'erreur). Ne lève JAMAIS.
export async function callLLM(
  prompt: string,
  opts?: { system?: string; maxTokens?: number }
): Promise<string | null> {
  try {
    const active = await getActiveProvider()
    if (!active) return null
    const cfg = await getProviderConfig(active)
    if (!isConfigured(cfg)) return null
    const text = await callProvider(cfg as ProviderConfig, prompt, opts)
    return text || null
  } catch {
    return null
  }
}
