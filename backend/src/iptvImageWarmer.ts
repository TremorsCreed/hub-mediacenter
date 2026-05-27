// Préchauffe les vignettes IPTV dans le cache disque en arrière-plan.
// Appelé après chaque réponse /streams : on warm les logos retournés (parallélisme
// modéré pour ne pas saturer le serveur upstream surchargé en soirée).
//
// Les vignettes restent ensuite servies depuis le disque local (route /api/iptv/image)
// même quand Elon IPTV rame.

import { createHash } from 'node:crypto'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const IMAGE_CACHE_DIR = join(process.env.DB_PATH ? dirname(process.env.DB_PATH) : process.cwd(), 'iptv-image-cache')
if (!existsSync(IMAGE_CACHE_DIR)) mkdirSync(IMAGE_CACHE_DIR, { recursive: true })

const inFlight = new Set<string>()  // évite de re-warm la même URL en parallèle

function pathFor(url: string) {
  return join(IMAGE_CACHE_DIR, createHash('md5').update(url).digest('hex'))
}

async function warmOne(url: string): Promise<void> {
  const p = pathFor(url)
  if (existsSync(p)) return
  if (inFlight.has(url)) return
  inFlight.add(url)
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) } as any)
    if (!r.ok) return
    const buf = Buffer.from(await r.arrayBuffer())
    writeFileSync(p, buf)
    const ct = r.headers.get('content-type') ?? 'image/png'
    writeFileSync(p + '.ct', ct)
  } catch { /* swallow, on retentera plus tard si user revoit */ }
  finally { inFlight.delete(url) }
}

/**
 * Lance le warm d'une liste d'URLs en arrière-plan.
 * - Skip celles déjà en cache (test fichier instantané)
 * - Skip celles déjà en cours de warm
 * - Parallélisme cappé pour ne pas étouffer le serveur upstream
 * - Pas d'attente : retourne immédiatement, les fetch tournent en background
 */
export function warmImages(urls: (string | undefined)[], parallelism = 4) {
  const todo = urls.filter((u): u is string => !!u && !existsSync(pathFor(u)) && !inFlight.has(u))
  if (todo.length === 0) return
  let i = 0
  for (let w = 0; w < parallelism; w++) {
    (async () => {
      while (i < todo.length) {
        const url = todo[i++]
        await warmOne(url)
      }
    })()
  }
}
