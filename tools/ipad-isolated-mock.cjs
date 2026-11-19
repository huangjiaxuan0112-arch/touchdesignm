// Manual iPad acceptance only: existing Mock Main + isolated profile + no native serial.
const { app, ipcMain } = require('electron')
const { join } = require('node:path')
const { readFileSync, mkdirSync } = require('node:fs')
const root = join(__dirname, '..')
const entry = join(root, 'desktop/out/main/main.js')
if (!readFileSync(entry, 'utf8').includes('const EXHIBITION_DEVICE_SOURCE = "mock";')) {
  throw Error('Mock build required. Refusing to load an Exhibition or unknown build.')
}
if (process.argv.includes('--open-air-bench')) throw Error('Bench flags are forbidden in isolated Mock acceptance.')
const profile = join(root, '.local/ipad-isolated-mock/user-data')
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
const serial = require('../desktop/node_modules/serialport')
const forbidden = () => { throw Error('Native serial is disabled in isolated iPad Mock acceptance.') }
serial.SerialPort.list = forbidden
serial.SerialPort.prototype.open = forbidden
serial.SerialPort.prototype.write = forbidden
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => handle(channel, (...args) => {
  if (/^(firmware|serial):/.test(channel)) forbidden()
  return listener(...args)
})
console.info('ISOLATED MOCK: native serial disabled; separate profile; existing Main/Lifecycle/Projector.')
require(entry)
