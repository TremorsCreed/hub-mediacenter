import { useEffect, useState } from 'react'
import { api, CompanionInboxItem } from '../api'
import CompanionFicheCard from '../components/CompanionFicheCard'
import { Loader2, Inbox as InboxIcon, Film, Tv, User, ChevronRight, Trash2 } from 'lucide-react'

// Badge de niveau de confiance (couleur claire, lisible sans la couleur seule).
const CONF: Record<string, { label: string; cls: string }> = {
  high:   { label: 'Sûr',    cls: 'bg-emerald-500/15 text-emerald-300 border border-emerald-700/50' },
  medium: { label: 'Moyen',  cls: 'bg-amber-500/15 text-amber-300 border border-amber-700/50' },
  low:    { label: 'Incertain', cls: 'bg-zinc-500/15 text-zinc-300 border border-zinc-600/50' },
}

// Évènement global pour rafraîchir le badge de nav après une décision.
function notifyInboxChanged() {
  try { window.dispatchEvent(new Event('hub:inbox-changed')) } catch { /* ignore */ }
}

type Tab = 'pending' | 'wishlist'

export default function Inbox() {
  const [tab, setTab] = useState<Tab>('pending')
  const [items, setItems] = useState<CompanionInboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<CompanionInboxItem | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)

  const load = (status: Tab) => {
    setLoading(true)
    return api.companion.inbox(status)
      .then(list => setItems(list.filter(i => i.status === status)))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(tab) }, [tab])

  const onDecided = (id: number) => {
    setItems(prev => prev.filter(i => i.id !== id))
    setOpen(null)
    notifyInboxChanged()
    // Une décision peut faire passer l'item d'un onglet à l'autre : on recharge
    // l'onglet courant pour refléter l'état exact côté backend.
    load(tab)
  }

  // Suppression d'un item (icône poubelle) : retire de la liste et notifie le badge.
  const onDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    if (deleting != null) return
    setDeleting(id)
    try {
      await api.companion.delete(id)
      setItems(prev => prev.filter(i => i.id !== id))
      if (open?.id === id) setOpen(null)
      notifyInboxChanged()
    } catch {
      /* on laisse l'item en place si la suppression échoue */
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Découvertes</h1>
      <p className="text-xs text-zinc-500">
        Les partages reçus depuis ton téléphone companion. Ouvre une fiche pour valider (ajout playlist), mettre en wishlist ou ignorer.
      </p>

      <div className="flex items-center gap-2">
        {([['pending', 'À traiter'], ['wishlist', 'Wishlist']] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { if (tab !== key) { setOpen(null); setTab(key) } }}
            className={`text-xs rounded-full px-3 py-1 transition-colors ${
              tab === key
                ? 'bg-zinc-100 text-zinc-900 font-medium'
                : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:border-zinc-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="py-16 flex justify-center text-zinc-500"><Loader2 size={20} className="animate-spin" /></div>
      )}

      {!loading && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-600 gap-3 border border-dashed border-zinc-800 rounded-lg">
          <InboxIcon size={28} />
          <div className="text-sm">
            {tab === 'pending'
              ? 'Rien à traiter. Partage un film ou une série depuis ton téléphone.'
              : 'Ta wishlist est vide.'}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {items.map(item => {
          const cand = item.candidates?.[0]
          const isSeries = (cand?.type ?? '') === 'series'
          const conf = item.confidence ?? cand?.confidence
          return (
            <button
              key={item.id}
              onClick={() => setOpen(item)}
              className="w-full flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg p-3 hover:border-zinc-700 transition-colors text-left"
            >
              <div className="w-12 h-16 rounded overflow-hidden shrink-0 bg-zinc-800 flex items-center justify-center text-zinc-600">
                {item.thumb
                  ? <img src={item.thumb} alt="" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                  : (isSeries ? <Tv size={18} /> : <Film size={18} />)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {item.resolved_title ?? cand?.title ?? item.caption ?? 'Élément à identifier'}
                  </span>
                  {conf && <span className={`text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 shrink-0 ${CONF[conf]?.cls ?? CONF.low.cls}`}>{CONF[conf]?.label}</span>}
                </div>
                {item.caption && item.caption !== item.resolved_title && (
                  <div className="text-xs text-zinc-500 truncate mt-0.5">{item.caption}</div>
                )}
                {item.author && (
                  <div className="text-[11px] text-zinc-600 flex items-center gap-1 mt-0.5"><User size={10} /> {item.author}</div>
                )}
              </div>
              <span
                role="button"
                tabIndex={0}
                title="Supprimer"
                aria-label="Supprimer"
                onClick={e => onDelete(e, item.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onDelete(e as any, item.id) }}
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
              >
                {deleting === item.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              </span>
              <ChevronRight size={16} className="text-zinc-600 shrink-0" />
            </button>
          )
        })}
      </div>

      {open && (
        <CompanionFicheCard
          item={open}
          onClose={() => setOpen(null)}
          onDecided={() => onDecided(open.id)}
        />
      )}
    </div>
  )
}
