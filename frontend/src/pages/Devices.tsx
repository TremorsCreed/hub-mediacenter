import { useEffect, useState } from 'react'
import { api, Credential, Device, DeviceConfig } from '../api'
import { Wifi, WifiOff, Trash2, ChevronDown, ChevronUp, Save, KeyRound, MonitorPlay, Radar, Loader2, CheckCircle2, Download } from 'lucide-react'
import { launchRemote, canRemote } from '../remote'
import type { DiscoverResult } from '../api'

const CONTENT_TYPES = ['movie', 'episode', 'live_channel', 'vod', 'music']
const APP_NAMES: Record<string, string> = { iptv: 'IPTV (Xtream)', plex: 'Plex', kodi: 'Kodi' }
const DEFAULT_CONFIG: DeviceConfig = { xtream_server: '', xtream_user: '', xtream_pass: '', xtream_ext: 'ts', plex_server_id: '', app_mappings: {}, xtream_credential_id: null, tvoverlay_enabled: false, overlay_player_duration: 0, iptv_player: 'auto' }

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
                Aucun profil Xtream. <a href="/admin/credentials" className="text-amber-400 hover:underline">En créer un</a>.
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

        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-zinc-500 w-44 shrink-0">Lecteur IPTV</span>
          <select
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-zinc-500"
            value={cfg.iptv_player ?? 'auto'}
            onChange={e => setCfg(prev => ({ ...prev, iptv_player: e.target.value as DeviceConfig['iptv_player'] }))}
          >
            <option value="auto">Auto (live: MX Player · VOD: Just Player)</option>
            <option value="justplayer">Just Player</option>
            <option value="mxplayer">MX Player</option>
            <option value="vlc">VLC</option>
            <option value="tivimate">TiviMate</option>
          </select>
          <span className="text-xs text-zinc-600">« Auto » recommandé</span>
        </div>
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
  const [scan, setScan] = useState<DiscoverResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [apkPresent, setApkPresent] = useState<boolean | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deploying, setDeploying] = useState<string | null>(null)
  const [deployMsg, setDeployMsg] = useState<{ ip: string; ok: boolean; text: string } | null>(null)
  const [players, setPlayers] = useState<{ id: string; label: string; size: number }[]>([])
  const [playerBusy, setPlayerBusy] = useState(false)

  const load = async () => setDevices(await api.devices.list())
  const refreshApk = () => api.discover.apkStatus().then(s => setApkPresent(s.present)).catch(() => setApkPresent(null))
  const refreshPlayers = () => api.discover.players().then(setPlayers).catch(() => setPlayers([]))

  const fetchJP = async () => {
    setPlayerBusy(true)
    try { const r = await api.discover.fetchJustPlayer(); await refreshPlayers(); alert(`Just Player ${r.version} récupéré (${(r.size/1e6).toFixed(1)} Mo)`) }
    catch (e: any) { alert(e.message || 'Échec') }
    finally { setPlayerBusy(false) }
  }
  const uploadPlayer = async (file?: File) => {
    if (!file) return
    const label = prompt('Nom du lecteur (ex. MX Player, VLC) :', file.name.replace(/\.apk$/i, ''))
    if (!label) return
    setPlayerBusy(true)
    try { await api.discover.uploadPlayer(file, label); await refreshPlayers() }
    catch (e: any) { alert(e.message || 'Échec de l\'upload') }
    finally { setPlayerBusy(false) }
  }
  const removePlayer = async (id: string) => {
    if (!confirm('Retirer ce lecteur du magasin ?')) return
    try { await api.discover.removePlayer(id); await refreshPlayers() } catch (e: any) { alert(e.message) }
  }

  const runScan = async () => {
    setScanning(true)
    try { setScan(await api.discover.scan()) }
    catch (e: any) { alert(e.message || 'Échec du scan') }
    finally { setScanning(false) }
  }

  const uploadApk = async (file?: File) => {
    if (!file) return
    setUploading(true)
    try { await api.discover.uploadApk(file); await refreshApk() }
    catch (e: any) { alert(e.message || 'Échec de l\'upload') }
    finally { setUploading(false) }
  }

  const deploy = async (ip: string) => {
    setDeploying(ip); setDeployMsg(null)
    try {
      const r = await api.discover.deploy(ip)
      setDeployMsg({ ip, ok: r.status === 'ok', text: r.message })
      if (r.status === 'ok') { setTimeout(load, 3000); setTimeout(runScan, 4000) }
    } catch (e: any) {
      setDeployMsg({ ip, ok: false, text: e.message || 'Échec du déploiement' })
    } finally { setDeploying(null) }
  }

  useEffect(() => {
    load()
    api.credentials.list().then(setCredentials).catch(() => {})
    refreshApk()
    refreshPlayers()
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
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Devices</h1>
        <button
          onClick={runScan}
          disabled={scanning}
          className="flex items-center gap-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 rounded px-3 py-1.5 transition-colors"
          title="Cherche les lecteurs Android avec ADB activé (port 5555) sur le réseau"
        >
          {scanning ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />}
          {scanning ? 'Scan en cours…' : 'Scanner le réseau'}
        </button>
      </div>
      <p className="text-sm text-zinc-500">
        Les agents se connectent au Hub au démarrage. La config Xtream est poussée automatiquement à la connexion.
      </p>

      {/* Résultats du scan réseau ADB */}
      {scan && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-zinc-500">
              Sous-réseau {scan.subnet}.0/24 · {scan.devices.length} lecteur(s) ADB trouvé(s) sur {scan.scanned} adresses
            </div>
            {/* État de l'APK agent (requis pour déployer) */}
            <label className="flex items-center gap-1.5 text-xs cursor-pointer text-zinc-400 hover:text-zinc-200">
              {uploading
                ? <Loader2 size={12} className="animate-spin" />
                : apkPresent
                  ? <CheckCircle2 size={12} className="text-emerald-500" />
                  : <Download size={12} className="text-amber-400" />}
              {uploading ? 'Envoi…' : apkPresent ? 'APK agent prêt — remplacer' : 'Uploader l\'APK de l\'agent'}
              <input type="file" accept=".apk" className="hidden"
                onChange={e => uploadApk(e.target.files?.[0])} disabled={uploading} />
            </label>
          </div>

          {/* Magasin de lecteurs à sideloader (Fire TV sans Play Store…) */}
          <div className="bg-zinc-950/40 border border-zinc-800/70 rounded p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500">Lecteurs poussés au déploiement</span>
              <div className="flex items-center gap-2">
                <button onClick={fetchJP} disabled={playerBusy}
                  className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 disabled:opacity-50">
                  {playerBusy ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} Récupérer Just Player
                </button>
                <label className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer">
                  <Download size={11} /> Uploader un lecteur
                  <input type="file" accept=".apk" className="hidden" disabled={playerBusy} onChange={e => uploadPlayer(e.target.files?.[0])} />
                </label>
              </div>
            </div>
            {players.length === 0
              ? <div className="text-[11px] text-zinc-600">Aucun lecteur. Récupère Just Player (open source) et/ou uploade MX Player, VLC…</div>
              : <div className="flex flex-wrap gap-1.5">
                  {players.map(p => (
                    <span key={p.id} className="flex items-center gap-1.5 bg-zinc-800 rounded px-2 py-0.5 text-[11px] text-zinc-300">
                      {p.label} <span className="text-zinc-600">{(p.size/1e6).toFixed(1)}Mo</span>
                      <button onClick={() => removePlayer(p.id)} className="text-zinc-600 hover:text-red-400"><Trash2 size={10} /></button>
                    </span>
                  ))}
                </div>}
          </div>

          {scan.devices.length === 0 && (
            <div className="text-sm text-zinc-600 py-2">
              Aucun appareil avec ADB (port 5555) détecté. Active le « débogage réseau / ADB sur TCP » sur tes Android TV.
            </div>
          )}
          {scan.devices.map(d => (
            <div key={d.ip} className="py-2 border-t border-zinc-800/60 first:border-t-0">
              <div className="flex items-center gap-3">
                <Radar size={14} className="text-zinc-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-200">{d.ip}<span className="text-zinc-600">:{d.adb_port}</span></div>
                  {d.agent && <div className="text-[11px] text-emerald-500 flex items-center gap-1"><CheckCircle2 size={11} /> Agent installé : {d.agent.name}</div>}
                </div>
                {d.agent
                  ? <span className="text-xs text-zinc-500 shrink-0">déjà géré</span>
                  : <button
                      onClick={() => deploy(d.ip)}
                      disabled={deploying === d.ip || !apkPresent}
                      title={apkPresent ? 'Installer et lancer l\'agent Hub' : 'Uploade d\'abord l\'APK de l\'agent'}
                      className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 border border-amber-900/50 hover:border-amber-700 disabled:opacity-40 disabled:cursor-not-allowed rounded px-2 py-1 shrink-0 transition-colors"
                    >
                      {deploying === d.ip ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      {deploying === d.ip ? 'Déploiement…' : 'Déployer l\'agent'}
                    </button>}
              </div>
              {deployMsg?.ip === d.ip && (
                <div className={`mt-2 text-xs rounded px-2 py-1.5 ${deployMsg.ok ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-900/50' : 'bg-amber-950/30 text-amber-300 border border-amber-900/40'}`}>
                  {deployMsg.text}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
                {canRemote(d) && (
                  <button
                    onClick={() => launchRemote(d.ip)}
                    className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 border border-amber-900/50 hover:border-amber-700 rounded px-2 py-1 transition-colors mr-1"
                    title={`Ouvrir le miroir/contrôle de ${d.name} (scrcpy)`}
                  >
                    <MonitorPlay size={13} /> Remote
                  </button>
                )}
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
