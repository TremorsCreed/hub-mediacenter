// Vérification rapide de la connexion + du schéma sur la base cible (pg01).
// Lance initDb (idempotent), puis affiche la liste des tables et le nombre de profils.
//   DATABASE_URL=... npx tsx scripts/db-check.ts
import { db, initDb } from '../src/db'

async function main() {
  await initDb()
  const tables = await db.execute(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
  )
  const users = await db.execute('SELECT count(*) AS n FROM users')
  console.log('Tables (%d):', tables.rows.length)
  console.log(tables.rows.map((r: any) => r.table_name).join(', '))
  console.log('Profils:', (users.rows[0] as any).n)
  process.exit(0)
}

main().catch((e) => {
  console.error('Échec:', e)
  process.exit(1)
})
