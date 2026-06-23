// Diagnostic local de la résolution d'épisode (sans toucher la prod).
//   DATABASE_URL=... npx tsx scripts/debug-resolve.ts
import { listActiveCredentialIds, getSeriesList, findAllInList } from '../src/iptvVodCache'
import { getXtreamCred, xtreamCall } from '../src/routes/iptv'

const SHOW = 'Monarch: Legacy of Monsters'
const SEASON = 2, EPISODE = 9

async function main() {
  const creds = await listActiveCredentialIds()
  console.log('credentials actifs:', creds)
  for (const credId of creds) {
    console.log(`\n=== credential #${credId} ===`)
    let list: any[] = []
    try { list = await getSeriesList(credId) } catch (e) { console.log('  getSeriesList échec:', (e as Error).message); continue }
    console.log('  séries en cache:', list.length)
    const cands = findAllInList(list, SHOW)
    console.log('  candidates pour', JSON.stringify(SHOW), ':', cands.length)
    for (const c of cands.slice(0, 8)) {
      process.stdout.write(`   - ${c.stream_id} | ${c.name} (${c.language ?? '?'}) → `)
      try {
        const cred = await getXtreamCred(String(credId))
        if (!cred) { console.log('cred null'); continue }
        const data: any = await xtreamCall(cred, 'get_series_info', { series_id: c.stream_id })
        const eps: any[] = data?.episodes?.[String(SEASON)] ?? []
        const ep = eps.find((e: any) => Number(e.episode_num) === EPISODE)
        console.log(ep ? `S${SEASON}E${EPISODE} TROUVÉ (ep id ${ep.id})` : `pas de S${SEASON}E${EPISODE} (saisons: ${Object.keys(data?.episodes ?? {}).join(',') || 'aucune'})`)
      } catch (e) { console.log('get_series_info échec:', (e as Error).message) }
    }
  }
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
