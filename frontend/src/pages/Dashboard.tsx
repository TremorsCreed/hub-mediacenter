import { useEffect, useState } from 'react'
import { api, Device, PlaybackState } from '../api'
import { Wifi, WifiOff, Circle } from 'lucide-react'

function statusColor(status: string) {
  if (status === 'playing') return 'text-green-400'
  if (status === 'paused') return 'text-yellow-400'
  return 'text-zinc-600'
}

export default function Dashboard() {
  const [devices, setDevices] = useState<Device[]>([])
  const [states, setStates] = useState<PlaybackState[]>([])

  useEffect(() => {
    const load = async () => {
      const [d, s] = await Promise.all([api.devices.list(), api.state.all()])
      setDevices(d)
      setStates(s)
    }
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  const connected = devices.filter(d => d.ws_connected).length
  const playing = states.filter(s => s.status === 'playing').length

  const stateByDevice = Object.fromEntries(states.map(s => [s.device_id, s]))

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Devices registered', value: devices.length },
          { label: 'Agents connected', value: connected },
          { label: 'Currently playing', value: playing }
        ].map(({ label, value }) => (
          <div key={label} className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-sm text-zinc-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Devices</h2>
        <div className="space-y-2">
          {devices.length === 0 && (
            <p className="text-sm text-zinc-600">No devices registered yet. Install an agent on your devices.</p>
          )}
          {devices.map(d => {
            const state = stateByDevice[d.id]
            return (
              <div key={d.id} className="flex items-center justify-between bg-zinc-900 rounded-lg px-4 py-3 border border-zinc-800">
                <div className="flex items-center gap-3">
                  {d.ws_connected
                    ? <Wifi size={15} className="text-green-400" />
                    : <WifiOff size={15} className="text-zinc-600" />
                  }
                  <div>
                    <div className="text-sm font-medium">{d.name}</div>
                    <div className="text-xs text-zinc-500">{d.platform} {d.ip ? `· ${d.ip}` : ''}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {state && state.status !== 'stopped' ? (
                    <>
                      <Circle size={7} className={`fill-current ${statusColor(state.status)}`} />
                      <span className="text-zinc-300">{state.title ?? state.status}</span>
                      <span className="text-zinc-600">{state.app}</span>
                    </>
                  ) : (
                    <span className="text-zinc-600 text-xs">idle</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
