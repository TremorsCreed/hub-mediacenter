import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, MonitorPlay, ExternalLink } from 'lucide-react'

// Modale plein écran qui embarque le miroir d'écran (ws-scrcpy) en iframe.
// Ouverte par l'événement 'hub:open-remote' (émis par les boutons « Remote »).
export default function RemoteScreen() {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const onOpen = (e: Event) => setUrl((e as CustomEvent).detail.url as string)
    window.addEventListener('hub:open-remote', onOpen)
    return () => window.removeEventListener('hub:open-remote', onOpen)
  }, [])

  // Échap ferme la modale
  useEffect(() => {
    if (!url) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setUrl(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [url])

  if (!url) return null

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4" onClick={() => setUrl(null)}>
      <div className="w-full max-w-5xl h-[85vh] bg-zinc-950 border border-zinc-800 rounded-xl flex flex-col overflow-hidden shadow-2xl"
           onClick={e => e.stopPropagation()}>
        <header className="h-11 shrink-0 border-b border-zinc-800 flex items-center gap-2 px-4">
          <MonitorPlay size={15} className="text-amber-400" />
          <span className="text-sm font-medium text-zinc-200">Écran du device</span>
          <span className="text-[11px] text-zinc-500">— sélectionne l'appareil dans la liste, puis le lecteur</span>
          <div className="ml-auto flex items-center gap-1">
            <a href={url} target="_blank" rel="noreferrer" title="Ouvrir dans un onglet"
               className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 transition-colors">
              <ExternalLink size={15} />
            </a>
            <button onClick={() => setUrl(null)} title="Fermer (Échap)"
                    className="p-1.5 rounded text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors">
              <X size={16} />
            </button>
          </div>
        </header>
        <iframe
          src={url}
          title="Miroir d'écran"
          className="flex-1 w-full bg-black"
          allow="autoplay; fullscreen"
        />
      </div>
    </div>,
    document.body
  )
}
