const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const vm = require('node:vm')
const file = join(__dirname, '../tools/ipad-isolated-mock.cjs')
const code = readFileSync(file, 'utf8')
function boot(build = 'const EXHIBITION_DEVICE_SOURCE = "mock";') {
  const paths = [], loaded = [], handlers = new Map()
  class SerialPort { open() {} write() {} }
  SerialPort.list = () => []
  const modules = {
    electron: { app: { setPath: (...args) => paths.push(args) }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) } },
    'node:path': require('node:path'),
    'node:fs': { readFileSync: () => build, mkdirSync() {} },
    '../desktop/node_modules/serialport': { SerialPort },
  }
  vm.runInNewContext(code, { require: name => modules[name] ?? loaded.push(name),
    __dirname: join(__dirname, '../tools'), process: { argv: [] }, console: { info() {} } })
  return { paths, loaded, handlers, SerialPort, ipc: modules.electron.ipcMain }
}
test('isolated iPad launcher refuses an Exhibition or unknown build before Main is loaded', () => {
  assert.throws(() => boot('const EXHIBITION_DEVICE_SOURCE = "firmware";'), /Mock build required/)
  assert.throws(() => boot('unknown'), /Mock build required/)
})
test('isolated iPad launcher loads only the existing Mock Main with a separate profile', () => {
  const state = boot()
  assert.match(state.paths[0][1], /[\\/]\.local[\\/]ipad-isolated-mock[\\/]user-data$/)
  assert.equal(state.loaded.length, 1)
  assert.match(state.loaded[0], /[\\/]desktop[\\/]out[\\/]main[\\/]main\.js$/)
})
test('isolated iPad launcher blocks native serial discovery, open and write', () => {
  const { SerialPort } = boot()
  assert.throws(() => SerialPort.list(), /Native serial is disabled/)
  assert.throws(() => new SerialPort().open(), /Native serial is disabled/)
  assert.throws(() => new SerialPort().write('START'), /Native serial is disabled/)
})
test('isolated iPad launcher rejects hardware IPC but preserves existing runtime and Projector handlers', () => {
  const state = boot()
  let called = 0
  for (const name of ['firmware:start','serial:connect','projector:media-report','app:get-runtime-info']) state.ipc.handle(name, () => ++called)
  assert.throws(() => state.handlers.get('firmware:start')(), /Native serial is disabled/)
  assert.throws(() => state.handlers.get('serial:connect')(), /Native serial is disabled/)
  assert.equal(called, 0)
  assert.equal(state.handlers.get('projector:media-report')(), 1)
  assert.equal(state.handlers.get('app:get-runtime-info')(), 2)
})
