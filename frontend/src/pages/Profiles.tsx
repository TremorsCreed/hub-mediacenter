import { useEffect, useState } from 'react'
import { api, User, Device, SpotifyStatus, TraktStatus } from '../api'
import { useUser, initials } from '../UserContext'
import { ShieldCheck, Plus, Trash2, Pencil, X, Loader2, Nfc, Music2, Clapperboard } from 'lucide-react'
import TraktLinkModal from '../components/TraktLinkModal'

// Lecteurs IPTV proposés comme défaut de profil ('' = suit le réglage du device)
const PLAYERS = [
  { value: '', label: 'Suit le réglage du device' },
  { value: 'auto', label: 'Auto (live: MX Player · VOD: Just Player)' },
  { value: 'justplayer', label: 'Just Player' },
  { value: 'mxplayer', label: 'MX Player' },
  { value: 'vlc', label: 'VLC' },
  { value: 'tivimate', label: 'TiviMate' },
]

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
  default_device_id: string
  default_player: string
}

const emptyForm: FormState = { name: '', avatar_color: COLORS[0], is_admin: false, pin: '', nfc_token: '', hasNfc: false, clearNfc: false, preferred_lang: 'FR', default_device_id: '', default_player: '' }

export default function Profiles() {
  const { refresh: refreshContext } = useUser()
  const [users, setUsers] = useState<User[]>([])
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [spotify, setSpotify] = useState<SpotifyStatus | null>(null)
  const [trakt, setTrakt] = useState<TraktStatus | null>(null)
  const [traktLink, setTraktLink] = useState<{ userId: number; name: string } | null>(null)
  const [linking, setLinking] = useState<number | null>(null)
  const [devices, setDevices] = useState<Device[]>([])

  const load = () => api.users.list().then(setUsers).catch(() => {})
  const loadSpotify = () => api.spotify.status().then(setSpotify).catch(() => setSpotify(null))
  const loadTrakt = () => api.trakt.auth.status().then(setTrakt).catch(() => setTrakt(null))
  useEffect(() => { load(); loadSpotify(); loadTrakt(); api.devices.list().then(setDevices).catch(() => {}) }, [])

  const traktFor = (userId: number) => trakt?.accounts.find(a => a.user_id === userId) ?? null
  const unlinkTrakt = async (userId: number, name: string) => {
    if (!confirm(`Délier le compte Trakt de « ${name} » ?`)) return
    try { await api.trakt.auth.unlink(userId); loadTrakt() }
    catch (e: any) { alert(e.message || 'Échec') }
  }

  // Lie un compte Spotify à un profil via une popup OAuth (le callback poste un
  // message à la fenêtre parente quand c'est terminé). cf. routes/spotify.ts.
  const linkSpotify = async (userId: number) => {
    try {
      setLinking(userId)
      const { url } = await api.spotify.loginUrl(userId)
      const popup = window.open(url, 'spotify-link', 'width=480,height=720')
      const onMsg = (ev: MessageEvent) => {
        if (ev.data?.type === 'spotify-linked') {
          window.removeEventListener('message', onMsg)
          setLinking(null)
          loadSpotify()
          try { popup?.close() } catch {}
        }
      }
      window.addEventListener('message', onMsg)
      // Sécurité : si la popup est fermée manuellement, on arrête le spinner
      const timer = setInterval(() => {
        if (popup?.closed) { clearInterval(timer); window.removeEventListener('message', onMsg); setLinking(null); loadSpotify() }
      }, 800)
    } catch (e: any) {
      setLinking(null)
      alert(e.message || 'Impossible de démarrer la liaison Spotify')
    }
  }

  const unlinkSpotify = async (userId: number, name: string) => {
    if (!confirm(`Délier le compte Spotify de « ${name} » ?`)) return
    try { await api.spotify.unlink(userId); loadSpotify() }
    catch (e: any) { alert(e.message || 'Échec') }
  }

  const spotifyFor = (userId: number) => spotify?.accounts.find(a => a.user_id === userId) ?? null

  const openCreate = () => { setError(null); setForm({ ...emptyForm }) }
  const openEdit = (u: User) => {
    setError(null)
    setForm({ id: u.id, name: u.name, avatar_color: u.avatar_color, is_admin: u.is_admin, pin: '', nfc_token: '', hasNfc: u.has_nfc, clearNfc: false, preferred_lang: u.preferred_lang ?? 'FR', default_device_id: u.default_device_id ?? '', default_player: u.default_player ?? '' })
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
          default_device_id: form.default_device_id || null,
          default_player: form.default_player || null,
          ...(form.pin ? { pin: form.pin } : {}),
          ...nfcPatch,
        })
      } else {
        const created = await api.users.create({
          name: form.name.trim(),
          avatar_color: form.avatar_color,
          is_admin: form.is_admin,
          preferred_lang: form.preferred_lang,
          ...(form.is_admin && form.pin ? { pin: form.pin } : {}),
          ...(form.nfc_token.trim() ? { nfc_token: form.nfc_token.trim() } : {}),
        })
        // Les défauts (device/lecteur) se posent via update — second appel si renseignés
        if (form.default_device_id || form.default_player) {
          await api.users.update(created.id, {
            default_device_id: form.default_device_id || null,
            default_player: form.default_player || null,
          })
        }
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
        <h1 className="text-2xl font-bold tracking-tight">Profils</h1>
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
                {spotifyFor(u.id) && <Music2 size={13} className="text-green-400" />}
                {traktFor(u.id) && <Clapperboard size={13} className="text-red-400" />}
              </div>
              <div className="text-xs text-zinc-500">
                {u.is_admin ? 'Administrateur' : 'Membre'}{u.has_nfc ? ' · carte NFC' : ''}
                {(() => { const a = spotifyFor(u.id); return a ? ` · Spotify : ${a.display_name ?? a.spotify_user_id}${a.product && a.product !== 'premium' ? ` (${a.product})` : ''}` : '' })()}
                {(() => { const a = traktFor(u.id); return a ? ` · Trakt : ${a.name ?? a.username}` : '' })()}
              </div>
            </div>
            {trakt?.app_configured && (
              traktFor(u.id) ? (
                <button onClick={() => unlinkTrakt(u.id, u.name)} className="text-red-400 hover:text-red-300 p-1.5 transition-colors" title="Délier Trakt">
                  <Clapperboard size={15} />
                </button>
              ) : (
                <button onClick={() => setTraktLink({ userId: u.id, name: u.name })} className="text-zinc-500 hover:text-red-400 p-1.5 transition-colors" title="Lier Trakt">
                  <Clapperboard size={15} />
                </button>
              )
            )}
            {spotify?.app_configured && (
              spotifyFor(u.id) ? (
                <button onClick={() => unlinkSpotify(u.id, u.name)} className="text-green-500 hover:text-red-400 p-1.5 transition-colors" title="Délier Spotify">
                  <Music2 size={15} />
                </button>
              ) : (
                <button onClick={() => linkSpotify(u.id)} disabled={linking === u.id} className="text-zinc-500 hover:text-green-400 p-1.5 transition-colors disabled:opacity-50" title="Lier Spotify">
                  {linking === u.id ? <Loader2 size={15} className="animate-spin" /> : <Music2 size={15} />}
                </button>
              )
            )}
            <button onClick={() => openEdit(u)} className="text-zinc-500 hover:text-zinc-200 p-1.5 transition-colors" title="Modifier">
              <Pencil size={15} />
            </button>
            <button onClick={() => remove(u)} className="text-zinc-500 hover:text-red-400 p-1.5 transition-colors" title="Supprimer">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      {/* Spotify : configuration de l'app + compte « Maison » (enceintes partagées) */}
      <div className="space-y-2 pt-2">
        <h2 className="text-sm font-semibold text-zinc-400 flex items-center gap-1.5">
          <Music2 size={14} className="text-green-400" /> Spotify
        </h2>
        {!spotify?.app_configured ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-xs text-zinc-400">
            L'app Spotify n'est pas encore configurée. Ajoute un credential de type <span className="text-zinc-200">spotify_app</span> (client_id / client_secret / redirect_uri) dans <span className="text-amber-400">Admin → Credentials</span>, puis chaque membre pourra lier son compte ici.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-green-500/15 text-green-400 shrink-0">
                <Music2 size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">Compte « Maison »</div>
                <div className="text-xs text-zinc-500">
                  Enceintes partagées (Echo). {(() => { const a = spotifyFor(spotify.maison_user_id); return a ? `Lié : ${a.display_name ?? a.spotify_user_id}` : 'Non lié — utilise un compte dédié pour ne pas polluer le tien.' })()}
                </div>
              </div>
              {spotifyFor(spotify.maison_user_id) ? (
                <button onClick={() => unlinkSpotify(spotify.maison_user_id, 'Maison')} className="text-green-500 hover:text-red-400 p-1.5" title="Délier">
                  <Music2 size={15} />
                </button>
              ) : (
                <button onClick={() => linkSpotify(spotify.maison_user_id)} disabled={linking === spotify.maison_user_id} className="text-zinc-500 hover:text-green-400 p-1.5 disabled:opacity-50" title="Lier le compte Maison">
                  {linking === spotify.maison_user_id ? <Loader2 size={15} className="animate-spin" /> : <Music2 size={15} />}
                </button>
              )}
            </div>
            {spotify.redirect_uri && (
              <p className="text-[10px] text-zinc-600">
                Redirect URI à déclarer dans le dashboard Spotify : <span className="text-zinc-400">{spotify.redirect_uri}</span>
              </p>
            )}
          </>
        )}
      </div>

      {/* Trakt : suivi d'activité (scrobbling), prochain épisode, listes — un compte par profil */}
      <div className="space-y-2 pt-2">
        <h2 className="text-sm font-semibold text-zinc-400 flex items-center gap-1.5">
          <Clapperboard size={14} className="text-red-400" /> Trakt
        </h2>
        {!trakt?.app_configured ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-xs text-zinc-400">
            L'app Trakt n'est pas configurée. Définis <span className="text-zinc-200">TRAKT_CLIENT_ID</span> / <span className="text-zinc-200">TRAKT_CLIENT_SECRET</span> dans l'environnement du stack, puis chaque membre pourra lier son compte (icône <Clapperboard size={11} className="inline text-red-400" />).
          </div>
        ) : (
          <p className="text-[11px] text-zinc-600">
            Lie ton compte Trakt sur ton profil ci-dessus (icône <Clapperboard size={11} className="inline text-red-400" />) pour le suivi automatique « vu », le prochain épisode et la publication de listes.
          </p>
        )}
      </div>

      {traktLink && (
        <TraktLinkModal
          userId={traktLink.userId}
          name={traktLink.name}
          onClose={() => setTraktLink(null)}
          onLinked={() => { setTraktLink(null); loadTrakt() }}
        />
      )}

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

              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-widest">Device par défaut</label>
                <select
                  value={form.default_device_id}
                  onChange={e => setForm({ ...form, default_device_id: e.target.value })}
                  className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500/60"
                >
                  <option value="">— aucun (garde la dernière cible) —</option>
                  {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-zinc-600">À l'activation du profil, la cible de lecture bascule sur ce device.</p>
              </div>

              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-widest">Lecteur IPTV du profil</label>
                <select
                  value={form.default_player}
                  onChange={e => setForm({ ...form, default_player: e.target.value })}
                  className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500/60"
                >
                  {PLAYERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
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
