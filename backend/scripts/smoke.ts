// Test fonctionnel de l'adaptateur pg : exerce les chemins SQL délicats sur la base
// cible, puis nettoie ses lignes de test. Doit afficher "SMOKE OK".
//   DATABASE_URL=... npx tsx scripts/smoke.ts
import { db } from '../src/db'

function assert(cond: any, msg: string) {
  if (!cond) throw new Error('ASSERT: ' + msg)
}

async function main() {
  // 1. INSERT ... RETURNING id (placeholders ?→$N)
  const now = Date.now()
  const pl = await db.execute({
    sql: "INSERT INTO playlists (owner_user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING id",
    args: [1, '__smoke__', now, now],
  })
  const plId = Number((pl.rows[0] as any).id)
  assert(plId > 0, 'RETURNING id')

  // 2. transaction : deux items puis commit
  const tx = await db.transaction('write')
  try {
    await tx.execute({ sql: "INSERT INTO playlist_items (playlist_id, position, app, title, created_at) VALUES (?, ?, ?, ?, ?)", args: [plId, 0, 'iptv', 'A', now] })
    await tx.execute({ sql: "INSERT INTO playlist_items (playlist_id, position, app, title, created_at) VALUES (?, ?, ?, ?, ?)", args: [plId, 1, 'iptv', 'B', now] })
    await tx.commit()
  } catch (e) { await tx.rollback(); throw e }
  const cnt = await db.execute({ sql: "SELECT count(*) AS n FROM playlist_items WHERE playlist_id = ?", args: [plId] })
  assert(Number((cnt.rows[0] as any).n) === 2, 'transaction commit count=2')

  // 3. rollback ne persiste pas
  const tx2 = await db.transaction('write')
  await tx2.execute({ sql: "INSERT INTO playlist_items (playlist_id, position, app, title, created_at) VALUES (?, ?, ?, ?, ?)", args: [plId, 9, 'iptv', 'C', now] })
  await tx2.rollback()
  const cnt2 = await db.execute({ sql: "SELECT count(*) AS n FROM playlist_items WHERE playlist_id = ?", args: [plId] })
  assert(Number((cnt2.rows[0] as any).n) === 2, 'rollback laisse count=2')

  // 4. batch atomique
  await db.batch([
    { sql: "INSERT INTO playlist_items (playlist_id, position, app, title, created_at) VALUES (?, ?, ?, ?, ?)", args: [plId, 2, 'iptv', 'D', now] },
    { sql: "INSERT INTO playlist_items (playlist_id, position, app, title, created_at) VALUES (?, ?, ?, ?, ?)", args: [plId, 3, 'iptv', 'E', now] },
  ], 'write')
  const cnt3 = await db.execute({ sql: "SELECT count(*) AS n FROM playlist_items WHERE playlist_id = ?", args: [plId] })
  assert(Number((cnt3.rows[0] as any).n) === 4, 'batch count=4')

  // 5. ON CONFLICT upsert (favorites UNIQUE(user_id, app, ref_id))
  for (const t of ['t1', 't2']) {
    await db.execute({
      sql: "INSERT INTO favorites (user_id, app, ref_id, title, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, app, ref_id) DO UPDATE SET title = excluded.title",
      args: [1, '__smoke__', 'ref1', t, now],
    })
  }
  const fav = await db.execute({ sql: "SELECT title, created_at FROM favorites WHERE user_id = ? AND app = ?", args: [1, '__smoke__'] })
  assert(fav.rows.length === 1, 'upsert = 1 ligne')
  assert((fav.rows[0] as any).title === 't2', 'upsert a mis à jour le titre')

  // 6. BIGINT relu en number (pas en string)
  assert(typeof (fav.rows[0] as any).created_at === 'number', 'created_at BIGINT → number')

  // 7. rowsAffected sur UPDATE/DELETE
  const del = await db.execute({ sql: "DELETE FROM favorites WHERE user_id = ? AND app = ?", args: [1, '__smoke__'] })
  assert(del.rowsAffected === 1, 'rowsAffected DELETE=1')

  // Nettoyage
  await db.execute({ sql: "DELETE FROM playlists WHERE id = ?", args: [plId] }) // cascade items
  const left = await db.execute({ sql: "SELECT count(*) AS n FROM playlist_items WHERE playlist_id = ?", args: [plId] })
  assert(Number((left.rows[0] as any).n) === 0, 'cascade delete items')

  console.log('SMOKE OK')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
