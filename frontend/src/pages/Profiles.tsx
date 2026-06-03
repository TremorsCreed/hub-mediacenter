import { useEffect, useState } from 'react'
import { api, User } from '../api'
import { useUser, initials } from '../UserContext'
import { ShieldCheck, Plus, Trash2, Pencil, X, Loader2, Nfc } from 'lucide-react'

const COLORS = ['#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#f97316', '#64748b']

const LANGS = ['FR', 'EN', 'DE', 'ES', 'IT', 'MULTI']

interface FormState {
  id?: number
  name: string
  avatar_color: string
  is_admin: boolean
  pin: string
  nfc_token: string
  hasNfc: boolean
  clearNfc: boolean
  preferred_lang: string
}

const emptyForm: FormState = { name: '', avatar_color: COLORS[0], is_admin: false, pin: '', nfc_token: '', hasNfc: false, clearNfc: false, preferred_lang: 'FR' }

export default function Profiles() {
  const { refresh: refreshContext } = useUser()
  const [users, setUsers] = useState<User[]>([])
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () => api.users.list().then(setUsers).catch(() => {})
  useEffect(() => { load() }, [])

  const openCreate = () => { setError(null); setForm({ ...emptyForm }) }
  const openEdit = (u: User) => {
    setError(null)
    setForm({ id: u.id, name: u.name, avatar_color: u.avatar_color, is_admin: u.is_admin, pin: '', nfc_token: '', hasNfc: u.has_nfc, clearNfc: false, preferred_lang: u.preferred_lang ?? 'FR' })
  }

  const save = async () => {
    if (!form || saving) return
    if (!form.name.trim()) { setError('Le nom est requis'); return }
    if (form.is_admin && !form.id && form.pin.length < 4) { setError('Un profil admin nécessite un PIN (4 chiffres min)'); return }
    setSaving(true)
    setError(null)
    try {
      // nfc_token : clearNfc → null (retire) · valeur saisie → associe · sinon inchangé
      const nfcPatch = form.clearNfc ? { nfc_token: null } : (form.nfc_token.trim() ? { nfc_token: form.nfc_token.trim() } : {})
      if (form.id) {
        await api.users.update(form.id, {
          name: form.name.trim(),
          avatar_color: form.avatar_color,
          is_admin: form.is_admin,
          preferred_lang: form.preferred_lang,
          ...(form.pin ? { pin: form.pin } : {}),
          ...nfcPatch,
        })
      } else {
        await api.users.create({
          name: form.name.trim(),
          avatar_color: form.avatar_color,
          is_admin: form.is_admin,
          preferred_lang: form.preferred_lang,
          ...(form.is_admin && form.pin ? { pin: form.pin } : {}),
          ...(form.nfc_token.trim() ? { nfc_token: form.nfc_token.trim() } : {}),
        })
      }
      setForm(null)
      await load()
      await refreshContext()
    } catch (e: any) {
      setError(e.message || 'Échec de l\'enregistrement')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (u: User) => {
    if (!confirm(`Supprimer le profil « ${u.name} » ? Son historique sera dissocié.`)) return
    try {
      await api.users.remove(u.id)
      await load()
      await refreshContext()
    } catch (e: any) {
      alert(e.message || 'Suppression impossible')
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Profils</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 bg-amber-500 text-black text-sm font-medium rounded px-3 py-1.5 hover:bg-amber-400 transition-colors"
        >
          <Plus size={15} /> Nouveau profil
        </button>
      </div>

      <div className="space-y-2">
        {users.map(u => (
          <div key={u.id} className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-semibold text-black/80 shrink-0" style={{ backgroundColor: u.avatar_color }}>
              {initials(u.name)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium flex items-center gap-1.5">
                {u.name}
                {u.is_admin && <ShieldCheck size={13} className="text-amber-400" />}
                {u.has_nfc && <Nfc size={13} className="text-cyan-400" />}
              </div>
              <div className="text-xs text-zinc-500">
                {u.is_admin ? 'Administrateur' : 'Membre'}{u.has_nfc ? ' · carte NFC' : ''}
              </div>
            </div>
            <button onClick={() => openEdit(u)} className="text-zinc-500 hover:text-zinc-200 p-1.5 transition-colors" title="Modifier">
              <Pencil size={15} />
            </button>
            <button onClick={() => remove(u)} className="text-zinc-500 hover:text-red-400 p-1.5 transition-colors" title="Supprimer">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      {/* Formulaire création / édition */}
      {form && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setForm(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md p-5 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setForm(null)} className="absolute top-3 right-3 text-zinc-500 hover:text-white"><X size={18} /></button>
            <h2 className="text-base font-semibold mb-4">{form.id ? 'Modifier le profil' : 'Nouveau profil'}</h2>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-widest">Nom</label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500/60"
                  placeholder="Prénom"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-widest">Couleur</label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setForm({ ...form, avatar_color: c })}
                      className={`w-8 h-8 rounded-lg transition-transform ${form.avatar_color === c ? 'ring-2 ring-white scale-110' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-widest">Langue préférée</label>
                <select
                  value={form.preferred_lang}
                  onChange={e => setForm({ ...form, preferred_lang: e.target.value })}
                  className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500/60"
                >
                  {LANGS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="accent-amber-500" checked={form.is_admin} onChange={e => setForm({ ...form, is_admin: e.target.checked })} />
                <span className="text-sm text-zinc-200">Administrateur</span>
              </label>

              {form.is_admin && (
                <div>
                  <label className="text-xs text-zinc-500 uppercase tracking-widest">
                    {form.id ? 'Nouveau PIN (laisser vide pour ne pas changer)' : 'PIN administrateur'}
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={form.pin}
                    onChange={e => setForm({ ...form, pin: e.target.value })}
                    className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm tracking-widest focus:outline-none focus:border-amber-500/60"
                    placeholder="••••"
                  />
                </div>
              )}

              {/* Carte NFC (Zaparoo) — association manuelle pour l'instant ; le scan
                  pour enregistrer arrivera avec l'intégration Zaparoo. */}
              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
                  <Nfc size={12} /> Carte NFC (Zaparoo)
                </label>
                {form.id && form.hasNfc && !form.clearNfc ? (
                  <div className="mt-1 flex items-center gap-2 text-sm text-zinc-300">
                    <span className="flex items-center gap-1.5 text-cyan-400"><Nfc size={14} /> Carte associée</span>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, clearNfc: true, nfc_token: '' })}
                      className="text-xs text-zinc-500 hover:text-red-400"
                    >
                      Retirer
                    </button>
                  </div>
                ) : form.clearNfc ? (
                  <div className="mt-1 flex items-center gap-2 text-sm text-zinc-500">
                    La carte sera retirée.
                    <button type="button" onClick={() => setForm({ ...form, clearNfc: false })} className="text-xs text-amber-400 hover:text-amber-300">Annuler</button>
                  </div>
                ) : (
                  <input
                    value={form.nfc_token}
                    onChange={e => setForm({ ...form, nfc_token: e.target.value })}
                    className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500/60"
                    placeholder="Token de la carte (optionnel)"
                  />
                )}
                <p className="text-[10px] text-zinc-600 mt-1">Scanner pour enregistrer arrivera avec Zaparoo.</p>
              </div>

              {error && <div className="text-xs text-red-400">{error}</div>}

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setForm(null)} className="text-sm text-zinc-400 hover:text-zinc-200 px-3 py-2">Annuler</button>
                <button onClick={save} disabled={saving} className="flex items-center gap-2 bg-amber-500 text-black text-sm font-medium rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : 'Enregistrer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
