const { spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')
const { resolve } = require('node:path')
const electron = createRequire(resolve('package.json'))('electron')
for (const scenario of ['preload-error','play-reject','closed-preload','closed-playing','reload','fault','disconnect']) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(electron, ['../test/electron-projector-link.cjs', '--scenario='+scenario], { env, encoding:'utf8' })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
