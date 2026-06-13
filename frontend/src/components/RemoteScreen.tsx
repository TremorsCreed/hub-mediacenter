import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Pin, PinOff, Maximize2, Minimize2, ExternalLink, RefreshCw } from 'lucide-react'
import { remoteBaseUrl } from '../remote'
import { usePersistedState } from '../usePersistedState'

// Miroir d'écran (ws-scrcpy) embarqué : PIP flottant épinglable (coin bas-droite)
// ou plein écran. Ouvert par l'événement 'hub:open-remote' (boutons « Remote »).
// Si épinglé, réapparaît tout seul au rechargement de la page.
// ws-scrcpy ne supporte pas de deep-link fiable (proxy WS dynamique) → on charge
// sa page liste ; l'utilisateur clique le device + un lecteur (1 clic).
export default function RemoteScreen() {
  const [pinned, setPinned] = usePersistedState('hub.remote.pinned', false)
  const [open, setOpen] = useState(pinned)
  const [full, setFull] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const onOpen = () => { setOpen(true); setFull(false) }
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

  const close = () => { setOpen(false); setFull(false); setPinned(false) }
  const src = remoteBaseUrl()

  const Header = (
    <header className="h-9 shrink-0 border-b border-zinc-800 flex items-center gap-1.5 px-2 bg-zinc-900">
      <span className="text-[11px] font-medium text-zinc-300 px-1 truncate">Écran</span>
      <span className="text-[10px] text-zinc-600 truncate hidden sm:inline">clique le device puis un lecteur</span>
      <div className="ml-auto flex items-center">
        <button onClick={() => setReloadKey(k => k + 1)} title="Recharger" className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 transition-colors"><RefreshCw size={13} /></button>
        <button onClick={() => setPinned(p => !p)} title={pinned ? 'Détacher' : 'Épingler (PIP persistant)'}
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

  const Frame = (
    <iframe
      key={reloadKey}
      src={src}
      title="Miroir d'écran"
      className="flex-1 w-full bg-black min-h-0"
      allow="autoplay; fullscreen"
    />
  )

  if (full) {
    return createPortal(
      <div className="fixed inset-0 z-[200] bg-black/85 flex items-center justify-center p-4" onClick={() => setFull(false)}>
        <div className="w-full max-w-5xl h-[85vh] bg-zinc-950 border border-zinc-800 rounded-xl flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
          {Header}
          {Frame}
        </div>
      </div>,
      document.body
    )
  }

  // PIP flottant, au-dessus de la barre « lecture en cours »
  return createPortal(
    <div className="fixed bottom-[72px] right-4 z-[150] w-[400px] bg-zinc-950 border border-zinc-700 rounded-lg shadow-2xl flex flex-col overflow-hidden">
      {Header}
      <div className="h-[260px] flex flex-col">{Frame}</div>
    </div>,
    document.body
  )
}
