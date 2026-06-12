import { useEffect, useMemo, useState } from 'react'
import { api, IptvCategory, IptvCategoryPref, User } from '../api'
import { Eye, EyeOff, Lock, Loader2, Tv, Film, MonitorPlay, Globe, AlertCircle } from 'lucide-react'

const TYPES = [
  { key: 'live' as const, label: 'TV', icon: Tv },
  { key: 'vod' as const, label: 'Films', icon: Film },
  { key: 'series' as const, label: 'Séries', icon: MonitorPlay },
]

type CatState = 'hidden' | 'locked' | null

// Gestion des catégories IPTV (admin) : pour chaque groupe, trois états —
// visible, masqué (déclutter) ou verrouillé (PIN parental). Une base « globale »
// s'applique à tous les profils ; chaque profil peut avoir des restrictions en
// plus. L'état effectif d'un profil = le plus restrictif des deux.
export default function IptvCategories() {
  const [creds, setCreds] = useState<{ id: number; name: string }[]>([])
  const [credId, setCredId] = useState<number | null>(null)
  const [type, setType] = useState<'live' | 'vod' | 'series'>('live')
  const [scope, setScope] = useState<string>('global')
  const [users, setUsers] = useState<User[]>([])
  const [categories, setCategories] = useState<IptvCategory[]>([])
  const [prefs, setPrefs] = useState<IptvCategoryPref[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.iptv.credentials().then(c => { setCreds(c); if (c.length) setCredId(c[0].id) })
    api.users.list().then(setUsers)
  }, [])

  useEffect(() => {
    if (!credId) return
    setLoading(true)
    Promise.all([
      api.iptv.categories(credId, type, true),
      api.iptv.categoryPrefs(credId, type),
    ])
      .then(([cats, p]) => { setCategories(cats); setPrefs(p) })
      .catch(() => { setCategories([]); setPrefs([]) })
      .finally(() => setLoading(false))
  }, [credId, type])

  const prefFor = (catId: string, sc: string): CatState =>
    prefs.find(p => p.category_id === catId && p.scope === sc)?.state ?? null

  // Après chaque écriture on relit les prefs du serveur : l'état affiché (boutons,
  // compteurs) reflète toujours la vérité en base, pas un état local optimiste.
  const reloadPrefs = async () => {
    if (!credId) return
    const p = await api.iptv.categoryPrefs(credId, type)
    setPrefs(p)
  }

  const setState = async (catId: string, state: CatState) => {
    if (!credId) return
    setSaving(catId)
    setError(null)
    try {
      await api.iptv.setCategoryPref(credId, { type, category_id: catId, scope, state })
      await reloadPrefs()
    } catch (e: any) {
      setError(e.message || 'Échec de l\'enregistrement')
    } finally {
      setSaving(null)
    }
  }

  // Action en masse sur toutes les catégories du type/scope courant.
  // « Tout masquer » → ne reste plus qu'à rendre visibles celles qu'on veut.
  const setAll = async (state: CatState) => {
    if (!credId || !categories.length || bulkSaving) return
    setBulkSaving(true)
    setError(null)
    try {
      const ids = categories.map(c => c.id)
      await api.iptv.setCategoryPrefsBulk(credId, { type, scope, state, category_ids: ids })
      await reloadPrefs()
    } catch (e: any) {
      setError(e.message || 'Échec de l\'action en masse')
    } finally {
      setBulkSaving(false)
    }
  }

  // Compteurs pour le bandeau du scope courant
  const counts = useMemo(() => {
    const mine = prefs.filter(p => p.scope === scope)
    return {
      hidden: mine.filter(p => p.state === 'hidden').length,
      locked: mine.filter(p => p.state === 'locked').length,
    }
  }, [prefs, scope])

  if (!creds.length) {
    return <div className="text-sm text-zinc-500">Aucun profil IPTV configuré.</div>
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-white mb-1">Catégories IPTV</h1>
      <p className="text-sm text-zinc-500 mb-5">
        Masque les groupes inutiles, verrouille les sensibles (PIN demandé à l'ouverture).
        La base « Tous les profils » s'applique partout ; un profil peut être restreint en plus.
      </p>

      {/* Sélecteurs : source, type, portée */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {creds.length > 1 && (
          <select
            value={credId ?? ''}
            onChange={e => setCredId(Number(e.target.value))}
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-600"
          >
            {creds.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        <div className="flex rounded-lg overflow-hidden border border-zinc-800">
          {TYPES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setType(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                type === key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        <select
          value={scope}
          onChange={e => setScope(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-600"
        >
          <option value="global">🌍 Tous les profils</option>
          {users.map(u => <option key={u.id} value={String(u.id)}>{u.name} (en plus du global)</option>)}
        </select>

        <span className="text-xs text-zinc-600 ml-auto">
          {counts.hidden} masquée{counts.hidden > 1 ? 's' : ''} · {counts.locked} verrouillée{counts.locked > 1 ? 's' : ''}
        </span>
      </div>

      {/* Actions en masse : masquer tout puis n'autoriser que ce qu'on veut */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setAll('hidden')}
          disabled={bulkSaving || loading || !categories.length}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-800 text-zinc-400 hover:text-red-400 hover:border-red-900/60 disabled:opacity-50 transition-colors"
        >
          {bulkSaving ? <Loader2 size={12} className="animate-spin" /> : <EyeOff size={12} />}
          Tout masquer
        </button>
        <button
          onClick={() => setAll(null)}
          disabled={bulkSaving || loading || !categories.length}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-800 text-zinc-400 hover:text-emerald-400 hover:border-emerald-900/60 disabled:opacity-50 transition-colors"
        >
          {bulkSaving ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
          Tout réinitialiser (visible)
        </button>
        <span className="text-[11px] text-zinc-600">Astuce : masque tout, puis ré-affiche juste ce dont tu as besoin.</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2 mb-4">
          <AlertCircle size={14} className="shrink-0" /> {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500 py-10 justify-center">
          <Loader2 size={15} className="animate-spin" /> Chargement des catégories…
        </div>
      )}

      {!loading && (
        <div className="border border-zinc-800 rounded-lg divide-y divide-zinc-800/70 overflow-hidden">
          {categories.map(c => {
            const mine = prefFor(c.id, scope)
            const globalState = scope !== 'global' ? prefFor(c.id, 'global') : null
            const busy = saving === c.id
            return (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2 bg-zinc-950/40">
                <div className="flex-1 min-w-0">
                  <div className={`text-sm truncate ${mine === 'hidden' ? 'text-zinc-600 line-through' : 'text-zinc-200'}`}>
                    {c.name}
                  </div>
                  {globalState && (
                    <div className="text-[10px] text-zinc-600 flex items-center gap-1">
                      <Globe size={9} /> déjà {globalState === 'hidden' ? 'masquée' : 'verrouillée'} pour tous
                    </div>
                  )}
                </div>
                {busy && <Loader2 size={13} className="animate-spin text-zinc-500" />}
                <div className="flex rounded-md overflow-hidden border border-zinc-800 shrink-0">
                  <button
                    onClick={() => setState(c.id, null)}
                    title="Visible"
                    className={`px-2.5 py-1.5 transition-colors ${
                      mine === null ? 'bg-emerald-600/20 text-emerald-400' : 'text-zinc-600 hover:text-zinc-300'
                    }`}
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    onClick={() => setState(c.id, 'locked')}
                    title="Verrouillée (PIN demandé)"
                    className={`px-2.5 py-1.5 border-l border-zinc-800 transition-colors ${
                      mine === 'locked' ? 'bg-amber-600/20 text-amber-400' : 'text-zinc-600 hover:text-zinc-300'
                    }`}
                  >
                    <Lock size={14} />
                  </button>
                  <button
                    onClick={() => setState(c.id, 'hidden')}
                    title="Masquée"
                    className={`px-2.5 py-1.5 border-l border-zinc-800 transition-colors ${
                      mine === 'hidden' ? 'bg-red-600/20 text-red-400' : 'text-zinc-600 hover:text-zinc-300'
                    }`}
                  >
                    <EyeOff size={14} />
                  </button>
                </div>
              </div>
            )
          })}
          {categories.length === 0 && (
            <div className="text-sm text-zinc-600 py-8 text-center">Aucune catégorie.</div>
          )}
        </div>
      )}
    </div>
  )
}
