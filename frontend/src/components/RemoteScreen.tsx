import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Pin, PinOff, Maximize2, Minimize2, ExternalLink, RefreshCw } from 'lucide-react'
import { streamUrl, REMOTE_PLAYERS, RemotePlayer } from '../remote'
import { usePersistedState } from '../usePersistedState'

// Miroir d'écran (ws-scrcpy) embarqué : PIP flottant épinglable (coin bas-droite)
// ou plein écran. Ouvert par 'hub:open-remote'. Deep-link DIRECT vers le device
// (proxy-adb tcp:8886) → le miroir s'affiche sans clic. Si épinglé, le PIP
// réapparaît tout seul au rechargement, sur le même device + lecteur.
export default function RemoteScreen() {
  const [pin, setPin] = usePersistedState<{ ip: string; player: RemotePlayer } | null>('hub.remote.pin', null)
  const [open, setOpen] = useState<{ ip: string } | null>(() => (pin ? { ip: pin.ip } : null))
  const [full, setFull] = useState(false)
  const [player, setPlayer] = useState<RemotePlayer>(pin?.player ?? 'mse')
  const [reloadKey, setReloadKey] = useState(0)
  // Taille du PIP, redimensionnable par l'utilisateur (le rendu ws-scrcpy est
  // scalé sur la largeur ; la hauteur rogne le vide gris du player).
  const [size, setSize] = usePersistedState('hub.remote.pipsize', { w: 400, h: 225 })

  useEffect(() => {
    const onOpen = (e: Event) => { setOpen({ ip: (e as CustomEvent).detail.ip as string }); setFull(false) }
    window.addEventListener('hub:open-remote', onOpen)
    return () => window.removeEventListener('hub:open-remote', onOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (full) setFull(false); else close() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, full])

  if (!open) return null

  const pinned = !!pin && pin.ip === open.ip
  const close = () => { setOpen(null); setFull(false); setPin(null) }
  const togglePin = () => setPin(pinned ? null : { ip: open.ip, player })
  const changePlayer = (p: RemotePlayer) => { setPlayer(p); if (pinned) setPin({ ip: open.ip, player: p }) }
  const src = streamUrl(open.ip, player)

  const Header = (
    <header className="h-9 shrink-0 border-b border-zinc-800 flex items-center gap-1.5 px-2 bg-zinc-900">
      <span className="text-[11px] font-medium text-zinc-300 px-1 truncate">Écran</span>
      <select
        value={player}
        onChange={e => changePlayer(e.target.value as RemotePlayer)}
        title="Lecteur du miroir"
        className="bg-zinc-800 border border-zinc-700 rounded text-[11px] text-zinc-200 px-1 py-0.5 focus:outline-none"
      >
        {REMOTE_PLAYERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <div className="ml-auto flex items-center">
        <button onClick={() => setReloadKey(k => k + 1)} title="Recharger" className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 transition-colors"><RefreshCw size={13} /></button>
        <button onClick={togglePin} title={pinned ? 'Détacher' : 'Épingler (PIP persistant)'}
          className={`p-1.5 rounded transition-colors ${pinned ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-500 hover:text-zinc-200'}`}>
          {pinned ? <Pin size={13} /> : <PinOff size={13} />}
        </button>
        <button onClick={() => setFull(f => !f)} title={full ? 'Réduire en PIP' : 'Plein écran'} className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 transition-colors">
          {full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <a href={src} target="_blank" rel="noreferrer" title="Ouvrir dans un onglet" className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 transition-colors"><ExternalLink size={13} /></a>
        <button onClick={close} title="Fermer" className="p-1.5 rounded text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"><X size={14} /></button>
      </div>
    </header>
  )

  if (full) {
    // Plein écran : ws-scrcpy a la place, iframe normale (rendu OK).
    return createPortal(
      <div className="fixed inset-0 z-[200] bg-black/85 flex items-center justify-center p-4" onClick={() => setFull(false)}>
        <div className="w-full max-w-5xl h-[85vh] bg-zinc-950 border border-zinc-800 rounded-xl flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
          {Header}
          <iframe
            key={`full-${open.ip}-${player}-${reloadKey}`}
            src={src}
            title="Miroir d'écran"
            className="flex-1 w-full bg-black min-h-0"
            allow="autoplay; fullscreen"
          />
        </div>
      </div>,
      document.body
    )
  }

  // PIP : ws-scrcpy dimensionne son canvas selon la taille de la fenêtre au
  // chargement → dans un petit cadre, rien ne s'affiche. On rend donc l'iframe à
  // une grande taille logique puis on la réduit en CSS (transform: scale). Les
  // clics restent correctement mappés (mise à l'échelle uniforme). La largeur du
  // PIP pilote l'échelle ; la hauteur rogne le vide gris en bas.
  const LOGICAL_W = 1024, LOGICAL_H = 576
  const scale = size.w / LOGICAL_W

  // Poignée de redimensionnement (coin haut-gauche, le PIP est ancré bas-droite :
  // tirer vers le haut-gauche agrandit, vers le bas-droite réduit/rogne).
  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const sx = e.clientX, sy = e.clientY, sw = size.w, sh = size.h
    const move = (ev: MouseEvent) => {
      setSize({
        w: Math.min(960, Math.max(240, Math.round(sw + (sx - ev.clientX)))),
        h: Math.min(620, Math.max(120, Math.round(sh + (sy - ev.clientY)))),
      })
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  return createPortal(
    <div className="fixed bottom-[72px] right-4 z-[150] bg-zinc-950 border border-zinc-700 rounded-lg shadow-2xl flex flex-col overflow-hidden" style={{ width: size.w }}>
      {/* Poignée de resize */}
      <div onMouseDown={onResizeDown} title="Redimensionner"
        className="absolute top-0 left-0 w-4 h-4 z-10 cursor-nwse-resize"
        style={{ background: 'linear-gradient(135deg, #f59e0b 0 35%, transparent 35%)' }} />
      {Header}
      <div style={{ width: size.w, height: size.h, overflow: 'hidden', position: 'relative', background: '#000' }}>
        <iframe
          key={`pip-${open.ip}-${player}-${reloadKey}`}
          src={src}
          title="Miroir d'écran"
          allow="autoplay; fullscreen"
          style={{ width: LOGICAL_W, height: LOGICAL_H, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        />
      </div>
    </div>,
    document.body
  )
}
