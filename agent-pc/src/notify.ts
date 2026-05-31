// Notifications système. Implémentations natives pour éviter node-notifier
// (qui embarque des binaires qui ne survivent pas au bundle esbuild + pkg).
// - Windows : PowerShell Toast XML (Windows 10+)
// - macOS   : osascript display notification
// - Linux   : notify-send (si installé)
// Fail silencieux : pas critique pour le fonctionnement de l'agent.

import { spawn } from 'node:child_process'
import { platform } from 'node:os'

let warned = false

export function notify(title: string, message: string) {
  try {
    const os = platform()
    if (os === 'win32') {
      // Toast Windows via PowerShell. Échappe les apostrophes simples.
      const t = title.replace(/'/g, "''")
      const m = message.replace(/'/g, "''")
      const ps = `
$ErrorActionPreference = 'SilentlyContinue'
[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime] | Out-Null
$tpl = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$txt = $tpl.GetElementsByTagName('text')
[void]$txt.Item(0).AppendChild($tpl.CreateTextNode('${t}'))
[void]$txt.Item(1).AppendChild($tpl.CreateTextNode('${m}'))
$toast = [Windows.UI.Notifications.ToastNotification]::new($tpl)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Hub MediaCenter').Show($toast)
`.trim()
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], {
        detached: true, stdio: 'ignore', windowsHide: true,
      }).unref()
    } else if (os === 'darwin') {
      const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('notify-send', [title, message], { detached: true, stdio: 'ignore' }).unref()
    }
  } catch (e) {
    if (!warned) {
      console.warn('[notify] backend unavailable:', (e as Error).message)
      warned = true
    }
  }
}
