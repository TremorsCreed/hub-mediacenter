import { useEffect, useState } from 'react'
import { api, Credential } from '../api'
import { Plus, Trash2, Save, X, KeyRound, Music2, Link2 } from 'lucide-react'

type CredType = Credential['type']

const EMPTY_XTREAM = { server: '', user: '', pass: '', ext: 'ts' }
const EMPTY_SPOTIFY = { client_id: '', client_secret: '', redirect_uri: '' }

export default function Credentials() {
  const [items, setItems] = useState<Credential[]>([])
  const [editing, setEditing] = useState<{ id?: number; name: string; type: CredType; data: any } | null>(null)
  const [saving, setSaving] = useState(false)
  const [m3uUrl, setM3uUrl] = useState('')
  const [urlErr, setUrlErr] = useState<string | null>(null)

  // Pré-remplit le formulaire Xtream depuis une URL get.php / M3U
  // (ex. http://host:port/get.php?username=X&password=Y&output=ts)
  const fillFromUrl = () => {
    setUrlErr(null)
    try {
      const u = new URL(m3uUrl.trim())
      const user = u.searchParams.get('username') ?? ''
      const pass = u.searchParams.get('password') ?? ''
      if (!user || !pass) { setUrlErr('username / password introuvables dans l\'URL'); return }
      const ext = u.searchParams.get('output') ?? 'ts'
      setEditing(s => s && { ...s, name: s.name || u.hostname, data: { server: u.origin, user, pass, ext } })
      setM3uUrl('')
    } catch {
      setUrlErr('URL invalide')
    }
  }

  const load = async () => setItems(await api.credentials.list())
  useEffect(() => { load() }, [])

  const startNew = () => setEditing({ name: '', type: 'xtream', data: { ...EMPTY_XTREAM } })
  const startNewSpotify = () => setEditing({ name: 'Spotify app', type: 'spotify_app', data: { ...EMPTY_SPOTIFY } })

  const startEdit = (c: Credential) => setEditing({
    id: c.id, name: c.name, type: c.type,
    data: c.type === 'spotify_app'
      ? { client_id: c.data.client_id ?? '', client_secret: c.data.client_secret ?? '', redirect_uri: c.data.redirect_uri ?? '' }
      : { server: c.data.server ?? '', user: c.data.user ?? '', pass: c.data.pass ?? '', ext: c.data.ext ?? 'ts' }
  })

  const save = async () => {
    if (!editing || !editing.name.trim()) return
    setSaving(true)
    try {
      const payload = { name: editing.name.trim(), type: editing.type, data: editing.data as any }
      if (editing.id) await api.credentials.update(editing.id, payload)
      else await api.credentials.create(payload)
      setEditing(null)
      await load()
    } finally { setSaving(false) }
  }

  const remove = async (c: Credential) => {
    if (!confirm(`Supprimer le profil "${c.name}" ?\nLes devices qui le référencent seront détachés.`)) return
    await api.credentials.remove(c.id)
    await load()
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Credentials</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={startNew}
            className="flex items-center gap-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded transition-colors"
          >
            <Plus size={13} /> Xtream
          </button>
          <button
            onClick={startNewSpotify}
            className="flex items-center gap-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded transition-colors"
          >
            <Music2 size={13} className="text-green-400" /> Spotify app
          </button>
        </div>
      </div>

      <p className="text-xs text-zinc-500">
        Profils réutilisables : Xtream IPTV (à associer à un device) et l'app Spotify (client_id / client_secret pour l'OAuth des membres).
      </p>

      {editing && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            {editing.type === 'spotify_app'
              ? <Music2 size={14} className="text-green-400" />
              : <KeyRound size={14} className="text-amber-400" />}
            <span className="text-sm font-medium">
              {editing.id ? 'Modifier' : 'Nouveau'} {editing.type === 'spotify_app' ? 'app Spotify' : 'profil Xtream'}
            </span>
            <button onClick={() => setEditing(null)} className="ml-auto text-zinc-500 hover:text-zinc-300"><X size={14} /></button>
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Nom du profil *</label>
            <input
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
              value={editing.name}
              onChange={e => setEditing(s => s && { ...s, name: e.target.value })}
              placeholder={editing.type === 'spotify_app' ? 'Spotify app' : 'Xtream principal'}
            />
          </div>
          {editing.type === 'spotify_app' ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Client ID</label>
                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
                  value={editing.data.client_id}
                  onChange={e => setEditing(s => s && { ...s, data: { ...s.data, client_id: e.target.value } })}
                  placeholder="depuis developer.spotify.com"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Client Secret</label>
                <input
                  type="password"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
                  value={editing.data.client_secret}
                  onChange={e => setEditing(s => s && { ...s, data: { ...s.data, client_secret: e.target.value } })}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Redirect URI</label>
                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
                  value={editing.data.redirect_uri}
                  onChange={e => setEditing(s => s && { ...s, data: { ...s.data, redirect_uri: e.target.value } })}
                  placeholder="http://127.0.0.1:8020/api/spotify/callback"
                />
                <p className="text-[10px] text-zinc-600 mt-1">
                  Doit être déclaré à l'identique dans le dashboard Spotify. Spotify n'accepte http que pour 127.0.0.1 — en LAN/prod, utilise du https.
                </p>
              </div>
            </div>
          ) : (
          <div className="space-y-3">
            {/* Import rapide depuis une URL get.php / M3U fournie par le provider */}
            <div className="bg-zinc-950/60 border border-zinc-800 rounded p-2.5">
              <label className="text-[11px] text-zinc-500 flex items-center gap-1.5 mb-1.5"><Link2 size={12} /> Coller l'URL M3U / get.php du provider (pré-remplit tout)</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
                  value={m3uUrl}
                  onChange={e => setM3uUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); fillFromUrl() } }}
                  placeholder="http://host:port/get.php?username=…&password=…&output=ts"
                />
                <button onClick={fillFromUrl} disabled={!m3uUrl.trim()} className="text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-3 py-1.5 rounded transition-colors">Remplir</button>
              </div>
              {urlErr && <p className="text-[11px] text-red-400 mt-1">{urlErr}</p>}
            </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-zinc-500 block mb-1">Serveur</label>
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
                value={editing.data.server}
                onChange={e => setEditing(s => s && { ...s, data: { ...s.data, server: e.target.value } })}
                placeholder="http://example.com:8080"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Utilisateur</label>
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
                value={editing.data.user}
                onChange={e => setEditing(s => s && { ...s, data: { ...s.data, user: e.target.value } })}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Mot de passe</label>
              <input
                type="password"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
                value={editing.data.pass}
                onChange={e => setEditing(s => s && { ...s, data: { ...s.data, pass: e.target.value } })}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Extension stream</label>
              <select
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none"
                value={editing.data.ext}
                onChange={e => setEditing(s => s && { ...s, data: { ...s.data, ext: e.target.value } })}
              >
                <option value="ts">ts</option>
                <option value="m3u8">m3u8</option>
                <option value="mp4">mp4</option>
              </select>
            </div>
          </div>
          </div>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={() => setEditing(null)} className="text-sm text-zinc-500 hover:text-zinc-300 px-3 py-1.5">Annuler</button>
            <button
              onClick={save}
              disabled={saving || !editing.name.trim()}
              className="flex items-center gap-1.5 text-sm bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-40 disabled:bg-zinc-700 disabled:text-zinc-400 px-4 py-1.5 rounded transition-colors"
            >
              <Save size={13} /> {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      {items.length === 0 && !editing && (
        <div className="text-sm text-zinc-600 py-12 text-center border border-dashed border-zinc-800 rounded">
          Aucun profil. Crée-en un pour partager les credentials entre plusieurs devices.
        </div>
      )}

      <div className="space-y-2">
        {items.map(c => (
          <div key={c.id} className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 hover:border-zinc-700 transition-colors">
            <button onClick={() => startEdit(c)} className="text-left flex-1">
              <div className="text-sm font-medium flex items-center gap-2">
                {c.type === 'spotify_app'
                  ? <Music2 size={12} className="text-green-400" />
                  : <KeyRound size={12} className="text-amber-400" />} {c.name}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                {c.type === 'spotify_app'
                  ? <>{c.data.client_id ? `client_id ${String(c.data.client_id).slice(0, 8)}…` : <span className="text-zinc-700">(client_id non défini)</span>}</>
                  : <>{c.type} · {c.data.server || <span className="text-zinc-700">(serveur non défini)</span>}</>}
              </div>
            </button>
            <button onClick={() => remove(c)} className="text-zinc-600 hover:text-red-400 transition-colors p-1">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
