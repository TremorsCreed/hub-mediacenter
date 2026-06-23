// Lance le back-remplissage des œuvres sur la base cible, puis affiche un récap.
//   DATABASE_URL=... npx tsx scripts/backfill.ts
import { db } from '../src/db'
import { backfillWorks } from '../src/migrations/backfillWorks'

async function main() {
  await backfillWorks()
  const works = await db.execute('SELECT count(*) AS n FROM works')
  const res = await db.execute('SELECT count(*) AS n FROM iptv_resolutions')
  const anchored = await db.execute('SELECT count(*) AS n FROM playlist_items WHERE work_id IS NOT NULL')
  console.log('works:', (works.rows[0] as any).n, '| iptv_resolutions:', (res.rows[0] as any).n, '| playlist_items ancrés:', (anchored.rows[0] as any).n)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
