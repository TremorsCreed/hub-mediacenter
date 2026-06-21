import { useEffect, useState } from 'react'
import { api, LlmConfig, LlmProvider, LlmTestResult } from '../api'
import { Brain, Plug, Zap, Trash2, Loader2, CheckCircle2, AlertCircle, Star } from 'lucide-react'

// Métadonnées d'affichage par fournisseur. base_url surtout utile à Ollama (auto-hébergé).
const PROVIDERS: { id: LlmProvider; label: string; accent: string; modelHint: string; cloud: boolean; baseUrlHint?: string }[] = [
  { id: 'claude',  label: 'Claude',  accent: '#d97757', modelHint: 'claude-sonnet-4-5', cloud: true },
  { id: 'chatgpt', label: 'ChatGPT', accent: '#10a37f', modelHint: 'gpt-4o-mini', cloud: true },
  { id: 'gemini',  label: 'Gemini',  accent: '#4285f4', modelHint: 'gemini-2.0-flash', cloud: true },
  { id: 'ollama',  label: 'Ollama',  accent: '#a1a1aa', modelHint: 'llama3.1', cloud: false, baseUrlHint: 'http://192.168.1.x:11434' },
]

// État de saisie local par carte (la clé n'est jamais relue depuis le serveur).
interface Draft { api_key: string; base_url: string; model: string }

function ProviderCard({
  meta, config, onSaved, onActive,
}: {
  meta: typeof PROVIDERS[number]
  config: LlmConfig | undefined
  onSaved: () => void
  onActive: () => void
}) {
  const [draft, setDraft] = useState<Draft>({ api_key: '', base_url: '', model: '' })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<LlmTestResult | null>(null)
  const [removing, setRemoving] = useState(false)

  // (Re)synchronise les champs non secrets quand l'état serveur change.
  useEffect(() => {
    setDraft(d => ({ ...d, base_url: config?.base_url ?? '', model: config?.model ?? '' }))
  }, [config?.base_url, config?.model])

  const hasKey = config?.has_key ?? false
  const isActive = config?.active ?? false
  // Ollama n'exige pas de clé : configurable dès qu'une base_url est posée.
  const configured = meta.cloud ? hasKey : !!(config?.base_url || draft.base_url.trim())

  const save = async () => {
    setSaving(true); setTest(null)
    try {
      const input: { api_key?: string; base_url?: string | null; model?: string | null } = {
        base_url: draft.base_url.trim() || null,
        model: draft.model.trim() || null,
      }
      // Clé vide = on n'écrase pas la clé enregistrée côté serveur.
      if (draft.api_key.trim()) input.api_key = draft.api_key.trim()
      await api.llm.save(meta.id, input)
      setDraft(d => ({ ...d, api_key: '' }))
      onSaved()
    } catch (e: any) {
      setTest({ ok: false, error: e.message || 'Échec' })
    } finally { setSaving(false) }
  }

  const runTest = async () => {
    setTesting(true); setTest(null)
    try { setTest(await api.llm.test(meta.id)) }
    catch (e: any) { setTest({ ok: false, error: e.message || 'Échec du test' }) }
    finally { setTesting(false) }
  }

  const remove = async () => {
    if (!confirm(`Oublier la configuration ${meta.label} (clé comprise) ?`)) return
    setRemoving(true)
    try { await api.llm.remove(meta.id); setTest(null); onSaved() }
    catch (e: any) { setTest({ ok: false, error: e.message }) }
    finally { setRemoving(false) }
  }

  return (
    <div className={`bg-zinc-900 border rounded-lg p-4 space-y-3 ${isActive ? 'border-amber-500/60' : 'border-zinc-800'}`}>
      <div className="flex items-center gap-2">
        <Brain size={15} style={{ color: meta.accent }} />
        <span className="text-sm font-semibold">{meta.label}</span>
        {isActive && (
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider bg-amber-500 text-black rounded px-1.5 py-0.5 font-medium">
            <Star size={9} fill="currentColor" /> Actif
          </span>
        )}
        {configured && !isActive && (
          <span className="text-[10px] uppercase tracking-wider text-emerald-500 ml-auto flex items-center gap-1">
            <CheckCircle2 size={10} /> Configuré
          </span>
        )}
      </div>

      {meta.cloud && (
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Clé API</label>
          <input
            type="password"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
            value={draft.api_key}
            onChange={e => setDraft(d => ({ ...d, api_key: e.target.value }))}
            placeholder={hasKey ? 'clé enregistrée (laisser vide pour garder)' : 'sk-…'}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className={meta.cloud ? '' : 'col-span-2'}>
          <label className="text-xs text-zinc-500 block mb-1">Base URL {meta.cloud ? '(optionnel)' : ''}</label>
          <input
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
            value={draft.base_url}
            onChange={e => setDraft(d => ({ ...d, base_url: e.target.value }))}
            placeholder={meta.baseUrlHint ?? 'défaut'}
          />
        </div>
        <div className={meta.cloud ? '' : 'col-span-2'}>
          <label className="text-xs text-zinc-500 block mb-1">Modèle</label>
          <input
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
            value={draft.model}
            onChange={e => setDraft(d => ({ ...d, model: e.target.value }))}
            placeholder={meta.modelHint}
          />
        </div>
      </div>

      {/* Résultat du test : latence + extrait, ou erreur */}
      {test && (
        <div className={`text-xs rounded px-2 py-1.5 flex items-start gap-1.5 ${test.ok ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-900/50' : 'bg-red-950/30 text-red-300 border border-red-900/40'}`}>
          {test.ok ? <CheckCircle2 size={12} className="mt-0.5 shrink-0" /> : <AlertCircle size={12} className="mt-0.5 shrink-0" />}
          {test.ok
            ? <span>OK {test.latency_ms != null ? `(${test.latency_ms} ms)` : ''}{test.sample ? ` : « ${test.sample.slice(0, 80)} »` : ''}</span>
            : <span>{test.error || 'Échec'}</span>}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 text-sm bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-40 disabled:bg-zinc-700 disabled:text-zinc-400 px-3 py-1.5 rounded transition-colors"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} Connecter
        </button>
        <button
          onClick={runTest}
          disabled={testing || !configured}
          title={configured ? 'Tester la connexion' : 'Configure d\'abord le fournisseur'}
          className="flex items-center gap-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 px-3 py-1.5 rounded transition-colors"
        >
          {testing ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />} Tester
        </button>
        {!isActive && (
          <button
            onClick={onActive}
            disabled={!configured}
            title={configured ? 'Définir comme fournisseur actif' : 'Configure d\'abord le fournisseur'}
            className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-amber-400 disabled:opacity-40 px-2 py-1.5 transition-colors"
          >
            <Star size={13} /> Définir actif
          </button>
        )}
        {(configured || (config && (config.base_url || config.model))) && (
          <button
            onClick={remove}
            disabled={removing}
            title="Oublier ce fournisseur"
            className="text-zinc-600 hover:text-red-400 transition-colors p-1 ml-auto"
          >
            {removing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          </button>
        )}
      </div>
    </div>
  )
}

export default function AdminLlm() {
  const [configs, setConfigs] = useState<LlmConfig[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = () => api.llm.list().then(c => { setConfigs(c); setErr(null) }).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])

  const byId = (id: LlmProvider) => configs.find(c => c.provider === id)

  const setActive = async (id: LlmProvider) => {
    try { await api.llm.setActive(id); await load() } catch (e: any) { setErr(e.message) }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight">LLM</h1>
      <p className="text-xs text-zinc-500">
        Fournisseurs d'IA utilisés par le companion (résolution des partages, fiches). Renseigne une clé (cloud) ou une base URL (Ollama auto-hébergé), teste la connexion, puis choisis le fournisseur actif.
      </p>

      {err && (
        <div className="text-xs rounded px-3 py-2 bg-red-950/30 text-red-300 border border-red-900/40 flex items-center gap-1.5">
          <AlertCircle size={13} /> {err}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PROVIDERS.map(meta => (
          <ProviderCard
            key={meta.id}
            meta={meta}
            config={byId(meta.id)}
            onSaved={load}
            onActive={() => setActive(meta.id)}
          />
        ))}
      </div>
    </div>
  )
}
