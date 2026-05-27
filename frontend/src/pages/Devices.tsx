import { useEffect, useState } from 'react'
import { api, Credential, Device, DeviceConfig } from '../api'
import { Wifi, WifiOff, Trash2, ChevronDown, ChevronUp, Save, KeyRound } from 'lucide-react'

const CONTENT_TYPES = ['movie', 'episode', 'live_channel', 'vod', 'music']
const APP_NAMES: Record<string, string> = { iptv: 'IPTV (Xtream)', plex: 'Plex', kodi: 'Kodi' }
const DEFAULT_CONFIG: DeviceConfig = { xtream_server: '', xtream_user: '', xtream_pass: '', xtream_ext: 'ts', plex_server_id: '', app_mappings: {}, xtream_credential_id: null, tvoverlay_enabled: false, overlay_player_duration: 0 }

function ConfigPanel({ deviceId, capabilities, credentials }: { deviceId: string; capabilities: { app: string }[]; credentials: Credential[] }) {
  const [cfg, setCfg] = useState<DeviceConfig>(DEFAULT_CONFIG)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.devices.getConfig(deviceId).then(setCfg).catch(() => {})
  }, [deviceId])

  const set = (k: keyof DeviceConfig, v: string) => setCfg(prev => ({ ...prev, [k]: v }))
  const setMapping = (type: string, app: string) =>
    setCfg(prev => ({ ...prev, app_mappings: { ...prev.app_mappings, [type]: app } }))

  const xtreamCreds = credentials.filter(c => c.type === 'xtream')
  const useProfile = cfg.xtream_credential_id !== null

  const save = async () => {
    setSaving(true)
    try {
      await api.devices.saveConfig(deviceId, cfg)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const appOptions = ['', 'plex', 'iptv', 'kodi']

  return (
    <div className="mt-3 pt-3 border-t border-zinc-800 space-y-4">

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wide">Xtream / IPTV</div>
          <div className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setCfg(p => ({ ...p, xtream_credential_id: xtreamCreds[0]?.id ?? null }))}
              className={`px-2 py-0.5 rounded transition-colors ${useProfile ? 'bg-amber-500 text-black' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
            >Profil</button>
            <button
              type="button"
              onClick={() => setCfg(p => ({ ...p, xtream_credential_id: null }))}
              className={`px-2 py-0.5 rounded transition-colors ${!useProfile ? 'bg-amber-500 text-black' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
            >Manuel</button>
          </div>
        </div>

        {useProfile ? (
          <div className="space-y-2">
            {xtreamCreds.length === 0 ? (
              <div className="text-xs text-zinc-500 py-2">
                Aucun profil Xtream. <a href="/credentials" className="text-amber-400 hover:underline">En créer un</a>.
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <KeyRound size={13} className="text-amber-400" />
                <select
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-zinc-500"
                  value={cfg.xtream_credential_id ?? ''}
                  onChange={e => set('xtream_credential_id' as any, e.target.value ? Number(e.target.value) as any : null as any)}
                >
                  {xtreamCreds.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Server URL</label>
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                placeholder="http://elon-iptv.com:8080"
                value={cfg.xtream_server}
                onChange={e => set('xtream_server', e.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Username</label>
                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  placeholder="user"
                  value={cfg.xtream_user}
                  onChange={e => set('xtream_user', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Password</label>
                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  type="password"
                  placeholder="••••••••"
                  value={cfg.xtream_pass}
                  onChange={e => set('xtream_pass', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Extension</label>
                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  placeholder="ts"
                  value={cfg.xtream_ext}
                  onChange={e => set('xtream_ext', e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div>
          <div className="text-xs text-zinc-400 font-medium mb-2 uppercase tracking-wide">Plex</div>
        <div className="mb-4">
          <label className="text-xs text-zinc-500 block mb-1">Machine Identifier</label>
          <input
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
            placeholder="728a8f0043d36a117c9b21d3998a4a6aa2faee74"
            value={cfg.plex_server_id}
            onChange={e => set('plex_server_id', e.target.value)}
          />
        </div>

        <div className="text-xs text-zinc-400 font-medium mb-2 uppercase tracking-wide">App par type de contenu</div>
          <div className="grid grid-cols-2 gap-2">
            {CONTENT_TYPES.map(type => (
              <div key={type} className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 w-24 shrink-0">{type}</span>
                <select
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-zinc-500"
                  value={cfg.app_mappings[type] ?? ''}
                  onChange={e => setMapping(type, e.target.value)}
                >
                  {appOptions.map(a => <option key={a} value={a}>{a ? (APP_NAMES[a] ?? a) : '— auto —'}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>

      <div>
        <div className="text-xs text-zinc-400 font-medium mb-2 uppercase tracking-wide">Modules</div>
        <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
          <input
            type="checkbox"
            className="accent-amber-500"
            checked={cfg.tvoverlay_enabled}
            onChange={e => setCfg(prev => ({ ...prev, tvoverlay_enabled: e.target.checked }))}
          />
          <span className="text-sm text-zinc-200">Overlay notifications</span>
          <span className="text-xs text-zinc-500">— card avec miniature sur l'écran du device pendant la lecture</span>
        </label>
        {cfg.tvoverlay_enabled && (
          <div className="flex items-center gap-2 pl-6 mt-1">
            <span className="text-xs text-zinc-500 w-44 shrink-0">Auto-hide après (secondes)</span>
            <input
              type="number" min={0} max={600}
              className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-zinc-500"
              value={cfg.overlay_player_duration}
              onChange={e => setCfg(prev => ({ ...prev, overlay_player_duration: Math.max(0, Math.min(600, parseInt(e.target.value || '0'))) }))}
            />
            <span className="text-xs text-zinc-600">0 = reste affiché pendant tout le film</span>
          </div>
        )}
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded transition-colors"
      >
        <Save size={12} />
        {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save & push to device'}
      </button>
    </div>
  )
}

export default function Devices() {
  const [devices, setDevices] = useState<Device[]>([])
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = async () => setDevices(await api.devices.list())

  useEffect(() => {
    load()
    api.credentials.list().then(setCredentials).catch(() => {})
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  const remove = async (id: string) => {
    if (!confirm('Remove this device?')) return
    await api.devices.remove(id)
    load()
  }

  const toggle = (id: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Devices</h1>
      <p className="text-sm text-zinc-500">
        Les agents se connectent au Hub au démarrage. La config Xtream est poussée automatiquement à la connexion.
      </p>

      {devices.length === 0 && (
        <div className="text-sm text-zinc-600 py-8 text-center">No devices registered.</div>
      )}

      <div className="space-y-3">
        {devices.map(d => (
          <div key={d.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {d.ws_connected
                  ? <Wifi size={14} className="text-green-400 mt-0.5 shrink-0" />
                  : <WifiOff size={14} className="text-zinc-600 mt-0.5 shrink-0" />
                }
                <div>
                  <div className="font-medium text-sm">{d.name}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {d.id} · {d.platform} {d.ip ? `· ${d.ip}` : ''}
                  </div>
                  <div className="text-xs text-zinc-600 mt-0.5">
                    Last seen {new Date(d.last_seen).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggle(d.id)}
                  className="text-zinc-500 hover:text-zinc-200 transition-colors p-1"
                  title="Configure"
                >
                  {expanded.has(d.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <button
                  onClick={() => remove(d.id)}
                  className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {d.capabilities.length > 0 && !expanded.has(d.id) && (
              <div className="mt-3 pt-3 border-t border-zinc-800">
                <div className="text-xs text-zinc-500 mb-2">Capabilities</div>
                <div className="flex flex-wrap gap-2">
                  {d.capabilities.map((c, i) => (
                    <div key={i} className="bg-zinc-800 rounded px-2 py-1 text-xs">
                      <span className="text-zinc-200 font-medium">{c.app}</span>
                      <span className="text-zinc-500 ml-1">{c.can_receive.join(', ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {expanded.has(d.id) && (
              <ConfigPanel deviceId={d.id} capabilities={d.capabilities} credentials={credentials} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
