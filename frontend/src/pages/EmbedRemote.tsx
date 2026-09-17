import { useEffect, useState } from 'react'
import { streamUrl, RemotePlayer } from '../remote'

// Page d'embed autonome (pas d'auth, pas de layout Hub) pour intégrer le
// mirroir d'écran dans un tiers (ex: carte iframe Home Assistant).
// ws-scrcpy fige la taille de son canvas video sur celle de la fenetre AU
// CHARGEMENT, et son calcul de centrage devient faux hors d'une certaine
// plage de tailles (bug observe hors de ~1024x576). On charge donc l'iframe
// a une taille logique fixe connue pour bien fonctionner, puis on la reduit
// visuellement par un scale CSS pour l'adapter au conteneur reel.
const LOGICAL_W = 1024
const LOGICAL_H = 576

export default function EmbedRemote({ ip }: { ip: string }) {
  const [player] = useState<RemotePlayer>('mse')
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const update = () => setScale(window.innerWidth / LOGICAL_W)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const src = streamUrl(ip, player)
  const frameH = Math.round(LOGICAL_H * scale)

  return (
    <div style={{ width: '100vw', height: frameH, overflow: 'hidden', background: '#000' }}>
      <iframe
        src={src}
        title="Miroir d'ecran"
        allow="autoplay; fullscreen"
        style={{ width: LOGICAL_W, height: LOGICAL_H, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      />
    </div>
  )
}
