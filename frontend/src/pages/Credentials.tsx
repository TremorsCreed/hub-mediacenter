import { useEffect, useState } from 'react'
import { api, Credential } from '../api'
import { Plus, Trash2, Save, X, KeyRound } from 'lucide-react'

type XtreamData = { server: string; user: string; pass: string; ext: string }

const EMPTY_XTREAM: XtreamData = { server: '', user: '', pass: '', ext: 'ts' }

export default function Credentials() {
  const [items, setItems] = useState<Credential[]>([])
  const [editing, setEditing] = useState<{ id?: number; name: string; type: 'xtream'; data: XtreamData } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => setItems(await api.credentials.list())
  useEffect(() => { load() }, [])

  const startNew = () => setEditing({ name: '', type: 'xtream', data: { ...EMPTY_XTREAM } })

  const startEdit = (c: Credential) => setEditing({
    id: c.id, name: c.name, type: c.type,
    data: {
      server: c.data.server ?? '',
      user: c.data.user ?? '',
      pass: c.data.pass ?? '',
      ext: c.data.ext ?? 'ts'
    }
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
        <h1 className="text-xl font-semibold">Credentials</h1>
        <button
          onClick={startNew}
          className="flex items-center gap-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded transition-colors"
        >
          <Plus size={13} /> Nouveau profil
        </button>
      </div>

      <p className="text-xs text-zinc-500">
        Profils réutilisables (Xtream IPTV pour l'instant). Associe-les à un device depuis l'onglet Devices.
      </p>

      {editing && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <KeyRound size={14} className="text-amber-400" />
            <span className="text-sm font-medium">{editing.id ? 'Modifier' : 'Nouveau'} profil Xtream</span>
            <button onClick={() => setEditing(null)} className="ml-auto text-zinc-500 hover:text-zinc-300"><X size={14} /></button>
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Nom du profil *</label>
            <input
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
              value={editing.name}
              onChange={e => setEditing(s => s && { ...s, name: e.target.value })}
              placeholder="Xtream principal"
            />
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
                <KeyRound size={12} className="text-amber-400" /> {c.name}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                {c.type} · {c.data.server || <span className="text-zinc-700">(serveur non défini)</span>}
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
