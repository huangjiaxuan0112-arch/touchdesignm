// Run from desktop. Reuses the actual renderer config and matching Main CSP nonce.
import { resolveConfig } from '../desktop/node_modules/electron-vite/dist/index.mjs'
import { build, createServer } from '../desktop/node_modules/vite/dist/node/index.js'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
const require = createRequire(new URL('../desktop/package.json', import.meta.url))
const { config } = await resolveConfig({}, 'serve', 'development')
await build({ ...config.main, configFile: false })
await build({ ...config.preload, configFile: false })
const server = await createServer({ ...config.renderer, configFile: false,
  server: { ...config.renderer.server, host: '127.0.0.1', port: 5190, strictPort: true } })
await server.listen()
try {
  const env = { ...process.env, NT_MEDIA_DEV_URL: 'http://127.0.0.1:5190/' }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), ['../test/electron-projector-media.cjs'], { stdio: 'inherit', env })
  process.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve(code ?? 1)) })
} finally { await server.close() }
