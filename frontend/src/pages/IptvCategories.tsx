import { useEffect, useMemo, useState } from 'react'
import { api, IptvCategory, IptvCategoryPref, User } from '../api'
import { Eye, EyeOff, Lock, Loader2, Tv, Film, MonitorPlay, Globe, AlertCircle, CornerDownRight } from 'lucide-react'

const TYPES = [
  { key: 'live' as const, label: 'TV', icon: Tv },
  { key: 'vod' as const, label: 'Films', icon: Film },
  { key: 'series' as const, label: 'Séries', icon: MonitorPlay },
]

type CatState = 'hidden' | 'locked' | 'visible' | null

// Gestion des catégories IPTV (admin). Deux niveaux :
// - « Tous les profils » (global) : la base — visible / verrouillée (PIN) / masquée.
// - Par profil : surcharge la base catégorie par catégorie, dans les deux sens —
//   « hérite » (suit le global), « visible » (ré-affiche un groupe restreint
//   globalement), « verrouillée » ou « masquée » (restreint plus).
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

  const isProfile = scope !== 'global'

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

  // État effectif d'une catégorie pour le scope affiché (profil : la surcharge
  // remplace la base ; sans surcharge on hérite du global)
  const effectiveFor = (catId: string): Exclude<CatState, null> => {
    const own = prefFor(catId, scope)
    if (isProfile) {
      if (own) return own
      const g = prefFor(catId, 'global')
      return g && g !== 'visible' ? g : 'visible'
    }
    return own && own !== 'visible' ? own : 'visible'
  }

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

  // Compteurs : état effectif des catégories pour le scope affiché
  const counts = useMemo(() => {
    let hidden = 0, locked = 0
    for (const c of categories) {
      const eff = effectiveFor(c.id)
      if (eff === 'hidden') hidden++
      else if (eff === 'locked') locked++
    }
    return { hidden, locked, visible: categories.length - hidden - locked }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, prefs, scope])

  if (!creds.length) {
    return <div className="text-sm text-zinc-500">Aucun profil IPTV configuré.</div>
  }

  const btnBase = 'px-2.5 py-1.5 transition-colors'

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-white mb-1">Catégories IPTV</h1>
      <p className="text-sm text-zinc-500 mb-5">
        La base « Tous les profils » s'applique partout. Chaque profil peut ensuite la
        surcharger : ré-afficher un groupe restreint, ou en restreindre d'autres.
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
          {users.map(u => <option key={u.id} value={String(u.id)}>{u.name} (surcharge le global)</option>)}
        </select>

        <span className="text-xs text-zinc-600 ml-auto">
          {counts.visible} visible{counts.visible > 1 ? 's' : ''} · {counts.hidden} masquée{counts.hidden > 1 ? 's' : ''} · {counts.locked} verrouillée{counts.locked > 1 ? 's' : ''}
        </span>
      </div>

      {/* Actions en masse */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {isProfile && (
          <button
            onClick={() => setAll('visible')}
            disabled={bulkSaving || loading || !categories.length}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-800 text-zinc-400 hover:text-emerald-400 hover:border-emerald-900/60 disabled:opacity-50 transition-colors"
          >
            {bulkSaving ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
            Tout ré-afficher pour ce profil
          </button>
        )}
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
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors"
        >
          {bulkSaving ? <Loader2 size={12} className="animate-spin" /> : isProfile ? <CornerDownRight size={12} /> : <Eye size={12} />}
          {isProfile ? 'Tout remettre sur « hérite »' : 'Tout réinitialiser (visible)'}
        </button>
        <span className="text-[11px] text-zinc-600">
          {isProfile
            ? 'Sans surcharge, le profil hérite de la base « Tous les profils ».'
            : 'Astuce : masque tout, puis ré-affiche juste ce dont tu as besoin.'}
        </span>
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
            const globalState = isProfile ? prefFor(c.id, 'global') : null
            const eff = effectiveFor(c.id)
            const busy = saving === c.id
            return (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2 bg-zinc-950/40">
                <div className="flex-1 min-w-0">
                  <div className={`text-sm truncate ${eff === 'hidden' ? 'text-zinc-600 line-through' : 'text-zinc-200'}`}>
                    {c.name}
                  </div>
                  {isProfile && globalState && globalState !== 'visible' && (
                    <div className="text-[10px] text-zinc-600 flex items-center gap-1">
                      <Globe size={9} /> base : {globalState === 'hidden' ? 'masquée' : 'verrouillée'} pour tous
                      {mine === 'visible' && <span className="text-emerald-500"> — ré-affichée pour ce profil</span>}
                    </div>
                  )}
                </div>
                {busy && <Loader2 size={13} className="animate-spin text-zinc-500" />}
                <div className="flex rounded-md overflow-hidden border border-zinc-800 shrink-0">
                  {isProfile && (
                    <button
                      onClick={() => setState(c.id, null)}
                      title="Hérite de la base « Tous les profils »"
                      className={`${btnBase} ${mine === null ? 'bg-zinc-700/40 text-zinc-200' : 'text-zinc-600 hover:text-zinc-300'}`}
                    >
                      <CornerDownRight size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => setState(c.id, isProfile ? 'visible' : null)}
                    title={isProfile ? 'Visible pour ce profil (même si restreinte globalement)' : 'Visible'}
                    className={`${btnBase} ${isProfile ? 'border-l border-zinc-800' : ''} ${
                      (isProfile ? mine === 'visible' : mine === null) ? 'bg-emerald-600/20 text-emerald-400' : 'text-zinc-600 hover:text-zinc-300'
                    }`}
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    onClick={() => setState(c.id, 'locked')}
                    title="Verrouillée (PIN demandé)"
                    className={`${btnBase} border-l border-zinc-800 ${
                      mine === 'locked' ? 'bg-amber-600/20 text-amber-400' : 'text-zinc-600 hover:text-zinc-300'
                    }`}
                  >
                    <Lock size={14} />
                  </button>
                  <button
                    onClick={() => setState(c.id, 'hidden')}
                    title="Masquée"
                    className={`${btnBase} border-l border-zinc-800 ${
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
