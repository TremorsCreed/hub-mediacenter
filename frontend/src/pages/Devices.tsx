import { useEffect, useState } from 'react'
import { api, Device } from '../api'
import { Wifi, WifiOff, Trash2 } from 'lucide-react'

export default function Devices() {
  const [devices, setDevices] = useState<Device[]>([])

  const load = async () => setDevices(await api.devices.list())

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  const remove = async (id: string) => {
    if (!confirm('Remove this device?')) return
    await api.devices.remove(id)
    load()
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Devices</h1>
      <p className="text-sm text-zinc-500">
        Agents register themselves on startup via WebSocket or <code className="bg-zinc-800 px-1 rounded text-xs">POST /api/devices/register</code>.
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
              <button
                onClick={() => remove(d.id)}
                className="text-zinc-600 hover:text-red-400 transition-colors p-1"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {d.capabilities.length > 0 && (
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
          </div>
        ))}
      </div>
    </div>
  )
}
