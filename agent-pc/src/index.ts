// Hub MediaCenter — Agent PC
// Lance le client WebSocket et reste actif jusqu'à Ctrl+C.

import { config, platformLabel } from './config.js'
import { localIp } from './ip.js'
import { notify } from './notify.js'
import { start } from './ws.js'

console.log('======================================')
console.log('  Hub MediaCenter — Agent PC')
console.log('======================================')
console.log(`device_id   : ${config.device_id}`)
console.log(`device_name : ${config.device_name}`)
console.log(`platform    : ${platformLabel()}`)
console.log(`local IP    : ${localIp(config.hub_url) ?? '(none detected)'}`)
console.log(`hub URL     : ${config.hub_url}`)
console.log('--------------------------------------')
console.log('Édite config.json pour changer device_name ou hub_url.')
console.log('Ctrl+C pour arrêter.')
console.log('--------------------------------------')

process.on('SIGINT', () => {
  console.log('\n[main] shutting down...')
  notify('Hub MediaCenter', 'Agent arrêté')
  process.exit(0)
})

process.on('uncaughtException', (e) => {
  console.error('[uncaught]', e)
})

start()
