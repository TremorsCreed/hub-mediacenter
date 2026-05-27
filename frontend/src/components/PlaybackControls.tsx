import { useState } from 'react'
import { api } from '../api'
import { Play, Pause, Square, SkipBack, SkipForward, Volume2, VolumeX, Volume1 } from 'lucide-react'

type Action = 'play_pause' | 'play' | 'pause' | 'stop' | 'next' | 'previous' | 'volume_up' | 'volume_down' | 'mute'

export default function PlaybackControls({ deviceId, compact = false }: { deviceId: string; compact?: boolean }) {
  const [busy, setBusy] = useState<Action | null>(null)

  const send = async (action: Action) => {
    setBusy(action)
    try { await api.control.send(deviceId, action) }
    catch (e) { console.warn('control failed', e) }
    finally { setBusy(null) }
  }

  const btnClass = `p-1.5 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 transition-colors`
  const size = compact ? 14 : 16

  return (
    <div className="flex items-center gap-0.5">
      {!compact && (
        <button onClick={() => send('previous')} disabled={busy !== null} className={btnClass} title="Précédent">
          <SkipBack size={size} />
        </button>
      )}
      <button onClick={() => send('play_pause')} disabled={busy !== null} className={btnClass} title="Play / Pause">
        {busy === 'play_pause' ? <Pause size={size} /> : <Play size={size} fill="currentColor" />}
      </button>
      <button onClick={() => send('stop')} disabled={busy !== null} className={btnClass} title="Stop">
        <Square size={size} fill="currentColor" />
      </button>
      {!compact && (
        <button onClick={() => send('next')} disabled={busy !== null} className={btnClass} title="Suivant">
          <SkipForward size={size} />
        </button>
      )}
      <div className="w-px h-4 bg-zinc-700 mx-1" />
      <button onClick={() => send('volume_down')} disabled={busy !== null} className={btnClass} title="Volume −">
        <Volume1 size={size} />
      </button>
      <button onClick={() => send('volume_up')} disabled={busy !== null} className={btnClass} title="Volume +">
        <Volume2 size={size} />
      </button>
      <button onClick={() => send('mute')} disabled={busy !== null} className={btnClass} title="Mute">
        <VolumeX size={size} />
      </button>
    </div>
  )
}
