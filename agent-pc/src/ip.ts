import { networkInterfaces } from 'node:os'

/**
 * Première IPv4 non-loopback.
 * Si hubUrl est fourni, on préfère une IP qui partage les 3 premiers octets du hub
 * (typiquement même subnet /24) — évite de choisir une interface vEthernet/VPN.
 */
export function localIp(hubUrl?: string): string | undefined {
  const hubHost = hubUrl?.replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').split(':')[0]?.split('/')[0]
  const hubPrefix = hubHost && /^\d/.test(hubHost) ? hubHost.split('.').slice(0, 3).join('.') + '.' : null

  const nets = networkInterfaces()
  const all: string[] = []
  for (const ifs of Object.values(nets)) {
    for (const net of ifs ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue
      if (hubPrefix && net.address.startsWith(hubPrefix)) return net.address
      all.push(net.address)
    }
  }
  return all[0]
}
