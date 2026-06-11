import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, EpgEntry, IptvStream } from '../api'
import { Loader2, Play, X, Tv, Clock } from 'lucide-react'

const CHANNEL_W = 168
const ROW_H = 56
const HEADER_H = 34
const PX_PER_MIN = 6          // 1h = 360px
const WINDOW_BEFORE_H = 1     // on montre 1h avant maintenant
const WINDOW_TOTAL_H = 12     // fenêtre totale de 12h
const MAX_CHANNELS = 100      // plafond de chaînes affichées dans le guide

const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })

export default function EpgGuide({ credId, channels, onPlay }: {
  credId: number
  channels: IptvStream[]
  onPlay: (s: IptvStream) => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [epg, setEpg] = useState<Record<string, EpgEntry[]>>({})
  const [loading, setLoading] = useState(false)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const [selected, setSelected] = useState<{ ch: IptvStream; p: EpgEntry } | null>(null)
  const didCenter = useRef(false)

  const shown = useMemo(() => channels.slice(0, MAX_CHANNELS), [channels])

  // Fenêtre temporelle (alignée sur l'heure courante, arrondie à 30 min)
  const windowStart = useMemo(() => {
    const d = new Date()
    d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0)
    return Math.floor(d.getTime() / 1000) - WINDOW_BEFORE_H * 3600
  }, [])
  const windowEnd = windowStart + WINDOW_TOTAL_H * 3600
  const TLW = ((windowEnd - windowStart) / 60) * PX_PER_MIN

  const xOf = (ts: number) => Math.max(0, Math.min(TLW, ((ts - windowStart) / 60) * PX_PER_MIN))

  // Horloge (déplace la ligne "now" chaque minute)
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60000)
    return () => clearInterval(t)
  }, [])

  // Chargement EPG des chaînes affichées
  useEffect(() => {
    if (!shown.length) { setEpg({}); return }
    setLoading(true)
    didCenter.current = false
    api.iptv.epgBatch(credId, shown.map(c => c.stream_id))
      .then(setEpg)
      .catch(() => setEpg({}))
      .finally(() => setLoading(false))
  }, [credId, shown])

  // Centre le scroll sur "maintenant" au premier chargement
  useEffect(() => {
    if (loading || didCenter.current || !scrollRef.current) return
    scrollRef.current.scrollLeft = Math.max(0, xOf(now) - 120)
    didCenter.current = true
  }, [loading, now])

  const goNow = () => {
    if (scrollRef.current) scrollRef.current.scrollTo({ left: Math.max(0, xOf(now) - 120), behavior: 'smooth' })
  }

  // Graduations horaires (toutes les 30 min)
  const ticks = useMemo(() => {
    const out: number[] = []
    for (let t = windowStart; t <= windowEnd; t += 1800) out.push(t)
    return out
  }, [windowStart, windowEnd])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-1 pb-2 shrink-0">
        <button onClick={goNow} className="flex items-center gap-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1 hover:border-amber-500/60 transition-colors">
          <Clock size={12} /> Maintenant
        </button>
        {loading && <span className="flex items-center gap-1.5 text-xs text-zinc-500"><Loader2 size={12} className="animate-spin" /> Chargement du guide…</span>}
        {channels.length > MAX_CHANNELS && <span className="text-xs text-zinc-600">{MAX_CHANNELS} premières chaînes sur {channels.length}</span>}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto border border-zinc-800 rounded-lg bg-zinc-950/40">
        <div className="relative" style={{ width: CHANNEL_W + TLW }}>
          {/* Axe horaire */}
          <div className="sticky top-0 z-30 flex bg-zinc-950 border-b border-zinc-800" style={{ height: HEADER_H }}>
            <div className="sticky left-0 z-40 bg-zinc-950 border-r border-zinc-800 shrink-0" style={{ width: CHANNEL_W }} />
            <div className="relative" style={{ width: TLW }}>
              {ticks.map(t => {
                const isHour = new Date(t * 1000).getMinutes() === 0
                return (
                  <div key={t} className="absolute top-0 bottom-0 flex items-center" style={{ left: xOf(t) }}>
                    <span className={`text-[10px] pl-1 ${isHour ? 'text-zinc-300 font-medium' : 'text-zinc-600'}`}>{fmtTime(t)}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Lignes chaînes */}
          {shown.map(ch => {
            const progs = epg[ch.stream_id] ?? []
            return (
              <div key={ch.stream_id} className="flex border-b border-zinc-800/40" style={{ height: ROW_H }}>
                <button
                  onClick={() => onPlay(ch)}
                  title={`Regarder ${ch.name}`}
                  className="sticky left-0 z-20 bg-zinc-900 border-r border-zinc-800 shrink-0 flex items-center gap-2 px-2 hover:bg-zinc-800 transition-colors text-left group"
                  style={{ width: CHANNEL_W }}
                >
                  <div className="w-9 h-9 shrink-0 bg-zinc-800 rounded overflow-hidden flex items-center justify-center">
                    {ch.logo
                      ? <img src={api.iptv.imageUrl(ch.logo)} alt="" loading="lazy" className="w-full h-full object-contain" onError={e => { e.currentTarget.style.display = 'none' }} />
                      : <Tv size={14} className="text-zinc-600" />}
                  </div>
                  <span className="text-[11px] leading-tight line-clamp-2 flex-1 min-w-0">{ch.name}</span>
                  <Play size={11} className="text-zinc-700 group-hover:text-amber-400 shrink-0" fill="currentColor" />
                </button>

                <div className="relative" style={{ width: TLW }}>
                  {loading && progs.length === 0 ? (
                    <>
                      <div className="absolute top-2 bottom-2 rounded bg-zinc-800/60 animate-pulse" style={{ left: 4, width: 150 }} />
                      <div className="absolute top-2 bottom-2 rounded bg-zinc-800/40 animate-pulse" style={{ left: 160, width: 240 }} />
                      <div className="absolute top-2 bottom-2 rounded bg-zinc-800/25 animate-pulse" style={{ left: 406, width: 200 }} />
                    </>
                  ) : progs.length > 0 ? (
                    progs.map(p => {
                      const left = xOf(p.start_ts)
                      const width = Math.max(2, xOf(p.stop_ts) - left)
                      const isNow = p.start_ts <= now && now < p.stop_ts
                      const isPast = p.stop_ts <= now
                      return (
                        <button
                          key={p.id || p.start_ts}
                          onClick={() => setSelected({ ch, p })}
                          className={`absolute top-1 bottom-1 rounded px-1.5 overflow-hidden text-left border transition-colors ${
                            isNow ? 'bg-amber-500/20 border-amber-500/60' : isPast ? 'bg-zinc-900/40 border-zinc-800/60 text-zinc-500' : 'bg-zinc-800/60 border-zinc-700/50 hover:border-zinc-500'
                          }`}
                          style={{ left, width }}
                        >
                          <div className="text-[11px] font-medium truncate leading-tight mt-0.5">{p.title}</div>
                          <div className="text-[9px] text-zinc-500 truncate">{fmtTime(p.start_ts)}</div>
                        </button>
                      )
                    })
                  ) : (
                    <div className="sticky left-0 inline-flex items-center h-full pl-3 text-[11px] text-zinc-600" style={{ width: 'min(100%, 420px)' }}>Pas de guide pour cette chaîne</div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Ligne "maintenant" */}
          {now >= windowStart && now <= windowEnd && (
            <div className="absolute w-0.5 bg-amber-500 z-10 pointer-events-none" style={{ left: CHANNEL_W + xOf(now), top: HEADER_H, bottom: 0 }}>
              <div className="absolute -top-0 -left-1 w-2.5 h-2.5 rounded-full bg-amber-500" />
            </div>
          )}
        </div>
      </div>

      {/* Détail programme */}
      {selected && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg p-5 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelected(null)} className="absolute top-3 right-3 text-zinc-500 hover:text-white"><X size={18} /></button>
            <div className="text-xs text-zinc-500 mb-1">{selected.ch.name}</div>
            <h2 className="text-lg font-semibold leading-tight pr-6">{selected.p.title}</h2>
            <div className="text-xs text-amber-400 mt-1">{fmtTime(selected.p.start_ts)} – {fmtTime(selected.p.stop_ts)}</div>
            {selected.p.desc && <p className="text-sm text-zinc-300 mt-3 max-h-48 overflow-y-auto">{selected.p.desc}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { onPlay(selected.ch); setSelected(null) }} className="flex items-center gap-1.5 bg-amber-500 text-black text-sm font-medium rounded px-4 py-2 hover:bg-amber-400">
                <Play size={14} fill="currentColor" /> Regarder la chaîne
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
