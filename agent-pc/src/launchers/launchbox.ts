// Gestion locale de LaunchBox : reset de l'état (taskkill + relance) quand
// MarquesasServer reste coincé sur "A game is currently being played".
//
// Le bug du plugin MarquesasServer : oGame.Play() pose isInGame=true mais
// ne le reset jamais si le démarrage du jeu échoue côté Windows (chemin
// invalide, ROM manquante, etc.). Aucun endpoint HTTP côté MarquesasServer
// ne permet de débloquer ; seule solution : tuer le process LaunchBox.exe.

import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { existsSync } from 'node:fs'

const DEFAULT_LB_PATHS = [
  'C:\\Program Files\\LaunchBox\\LaunchBox.exe',
  'C:\\Program Files (x86)\\LaunchBox\\LaunchBox.exe',
  'C:\\Users\\Public\\LaunchBox\\LaunchBox.exe',
  'F:\\LaunchBox\\LaunchBox.exe',
  'D:\\LaunchBox\\LaunchBox.exe',
  'E:\\LaunchBox\\LaunchBox.exe',
]

function findLaunchBox(): string | null {
  if (process.env.LAUNCHBOX_EXE && existsSync(process.env.LAUNCHBOX_EXE)) {
    return process.env.LAUNCHBOX_EXE
  }
  for (const p of DEFAULT_LB_PATHS) {
    if (existsSync(p)) return p
  }
  return null
}

function execPS(cmd: string, timeoutMs = 8000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
      windowsHide: true,
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => stdout += d.toString())
    child.stderr.on('data', d => stderr += d.toString())
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, timeoutMs)
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }) })
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, stdout, stderr }) })
  })
}

export interface ResetResult {
  ok: boolean
  killed: boolean
  relaunched: boolean
  detail: string
}

/**
 * Tue LaunchBox.exe (et BigBox.exe au passage si présent), puis le relance.
 * Si `relaunch` est false, on tue sans relancer.
 */
export async function resetLaunchBox(opts: { relaunch?: boolean } = {}): Promise<ResetResult> {
  if (platform() !== 'win32') {
    return { ok: false, killed: false, relaunched: false, detail: 'not on Windows' }
  }

  const exePath = findLaunchBox()

  // Étape 1 : kill (force) — LaunchBox + BigBox au cas où
  const killCmd = `Get-Process -Name LaunchBox,BigBox -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Write-Output "killed"`
  const killRes = await execPS(killCmd, 8000)
  const killed = killRes.stdout.includes('killed') && killRes.code === 0

  // Petit délai pour laisser le process se nettoyer
  await new Promise(r => setTimeout(r, 1500))

  // Étape 2 : relance (optionnelle)
  let relaunched = false
  let detail = killed ? 'LaunchBox tué.' : 'Aucun process LaunchBox à tuer (ou échec).'

  if (opts.relaunch !== false) {
    if (!exePath) {
      detail += ' Impossible de retrouver LaunchBox.exe pour le relancer (définis LAUNCHBOX_EXE).'
      return { ok: killed, killed, relaunched: false, detail }
    }
    try {
      // Spawn detached pour que LaunchBox survive si on quitte l'agent
      const child = spawn(exePath, [], { detached: true, stdio: 'ignore', windowsHide: false })
      child.unref()
      relaunched = true
      detail += ` Relancé depuis ${exePath}.`
    } catch (e) {
      detail += ` Échec relance: ${(e as Error).message}.`
    }
  }

  return { ok: killed || relaunched, killed, relaunched, detail }
}
