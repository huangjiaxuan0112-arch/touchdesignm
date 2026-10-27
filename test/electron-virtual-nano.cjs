// Offline React -> preload -> IPC -> original serial service -> virtual Nano HEX.
const { app, BrowserWindow } = require('electron')
const { EventEmitter } = require('node:events')
const { spawn } = require('node:child_process')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { createInterface } = require('node:readline')
const assert = require('node:assert/strict')
const directory = resolve(process.env.NATURE_TOUCH_E2E_RESULTS || resolve(__dirname, '../docs/evidence/offline-recover-e2e'))
mkdirSync(directory, { recursive: true })
process.on('uncaughtException', error => {
  writeFileSync(resolve(directory, 'uncaught-error.log'), error.stack || String(error))
  app.exit(1)
})
const evidence = { method: 'Actual React/Electron + compiled HEX in AVR8js; NO COM', checks: {}, writes: [], frames: [] }
const worker = spawn('C:/Program Files/nodejs/node.exe', [resolve(__dirname, 'unified-controller/verify.mjs'), '--stdio-bridge'], {
  cwd: resolve(__dirname, '..'), env: { ...process.env, UNIFIED_RESULTS: resolve(directory, 'virtual-nano') }, windowsHide: true,
})
worker.stderr.on('data', data => require('node:fs').appendFileSync(resolve(directory, 'virtual-stderr.log'), data))
let readyResolve, activePort
const ready = new Promise(resolve => { readyResolve = resolve })
createInterface({ input: worker.stdout }).on('line', text => {
  const row = JSON.parse(text)
  if (row.kind === 'ready') readyResolve()
  if (row.kind === 'frame') {
    evidence.frames.push(row)
    activePort?.emit('data', Buffer.from(JSON.stringify(row.message) + '\n'))
  }
})
// Replace the package implementation only inside this test process, before main
// loads. Native list/open also throw, so a test defect cannot touch real COM.
const serial = require('../desktop/node_modules/serialport/dist/serialport.js')
serial.SerialPort.list = async () => { throw new Error('Native port discovery forbidden in offline test') }
serial.SerialPort.prototype.open = () => { throw new Error('Physical port open forbidden in offline test') }
class VirtualPort extends EventEmitter {
  static async list() { return [{ path: 'VIRTUAL_NANO', manufacturer: 'AVR8js — NOT USB hardware' }] }
  constructor(options) { super(); assert.equal(options.path, 'VIRTUAL_NANO'); this.isOpen = false }
  open(callback) { this.isOpen = true; activePort = this; callback() }
  close(callback) { this.isOpen = false; activePort = undefined; this.emit('close'); callback() }
  write(data, callback) {
    const line = data.toString().trim(); evidence.writes.push(JSON.parse(line))
    worker.stdin.write(JSON.stringify({ line }) + '\n'); callback()
  }
  drain(callback) { callback() }
}
serial.SerialPort = VirtualPort
const loaded = new Promise(resolve => app.once('browser-window-created', (_event, window) =>
  window.webContents.once('did-finish-load', () => resolve(window))))
require('../desktop/out/main/main.js')
let window
const js = source => window.webContents.executeJavaScript(source)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function wait(source, timeout = 20000) {
  const until = Date.now() + timeout
  do { if (await js(source)) return; await pause(100) } while (Date.now() < until)
  throw new Error('Timed out: ' + source)
}
async function click(text) {
  const selector = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)})`
  await wait(`!!(${selector}) && !(${selector}).disabled`)
  await js(`(${selector}).click()`); await pause(150)
}
;(async () => {
  try {
    await ready; window = await loaded
    await wait(`!!document.querySelector('[aria-label="Device mode"]')`)
    await js(`{ const s=document.querySelector('[aria-label="Device mode"]');s.value='real';s.dispatchEvent(new Event('change',{bubbles:true})); }`)
    await wait(`!!document.querySelector('option[value="VIRTUAL_NANO"]')`)
    await js(`{ const s=document.querySelector('[aria-label="COM port"]');s.value='VIRTUAL_NANO';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.device-connection input[type=checkbox]').click(); }`)
    await click('Connect + IDENTIFY')
    await wait(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='STATUS_QUERY').disabled`)
    const initial = await js('window.natureTouch.getFirmwareState()')
    assert.equal(initial.identified, true); assert.equal(initial.experience.state, 'IDLE')
    assert.equal(await js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='RECOVER')`), false)
    evidence.checks.identifyStatus = 'PASS'
    await js(`document.querySelector('[aria-label="Confirm simulation firmware"]').click()`)
    await click('Arm Real Arduino Simulation Test')
    await wait(`document.querySelector('.device-connection [role=status]').textContent.includes('SIMULATION TEST ARMED')`)
    for (const mode of ['WIND', 'WAVE', 'BUBBLE']) {
      await wait(`!document.querySelector('[data-experience="${mode}"]').disabled`)
      await js(`document.querySelector('[data-experience="${mode}"]').click()`); await pause(150)
      await click('Test START')
      await wait(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Test STOP').disabled`)
      assert.equal((await js('window.natureTouch.getFirmwareState()')).experience.state, 'RUNNING')
      await pause(1400)
      await click('Test STOP')
      await wait(`document.querySelector('[aria-label="Arduino status"]').textContent.includes('"state": "IDLE"')`)
      evidence.checks[mode + '_SELECT_START_STOP'] = 'PASS'
    }
    await click('Test START')
    await wait(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Test STOP').disabled`)
    worker.stdin.write(JSON.stringify({ fault: true }) + '\n')
    await wait(`document.querySelector('[aria-label="Arduino status"]').textContent.includes('"state": "FAULT"')`)
    const fault = await js('window.natureTouch.getFirmwareState()')
    assert.equal(fault.experience.faultCode, 'ACTUATOR_FAULT'); assert.equal(fault.simulationTestArmed, false)
    evidence.checks.faultSynchronization = 'PASS'
    const starts = evidence.writes.filter(request => request.type === 'START').length
    await pause(2000)
    assert.equal(evidence.writes.filter(request => request.type === 'START').length, starts)
    evidence.checks.noAutomaticRestart = 'PASS'
    worker.stdin.write(JSON.stringify({ rejectNextRecovery: true }) + '\n')
    evidence.recoveryFailureInjection = 'Virtual SRAM state race after STATUS precheck; NACK produced by compiled firmware'
    await click('RECOVER')
    await wait(`Array.from(document.querySelectorAll('[role=alert]')).some(e=>e.textContent.includes('RECOVER rejected: INVALID_STATE'))`)
    assert.equal((await js('window.natureTouch.getFirmwareState()')).experience.state, 'FAULT')
    evidence.checks.recoveryFailurePreservesFaultAndDisplaysError = 'PASS'
    worker.stdin.write(JSON.stringify({ fault: true }) + '\n')
    await pause(400)
    await click('RECOVER')
    await wait(`document.querySelector('[aria-label="Arduino status"]').textContent.includes('"state": "IDLE"')`)
    const recovered = await js('window.natureTouch.getFirmwareState()')
    assert.equal(recovered.experience.selectedExperienceId, null)
    assert.equal(recovered.experience.operationId, null)
    assert.equal(recovered.simulationTestArmed, false)
    assert.equal(await js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='RECOVER')`), false)
    await pause(1500)
    assert.equal(evidence.writes.filter(request => request.type === 'START').length, starts)
    evidence.checks.recoverVerifiedIdleNoAutomaticRestart = 'PASS'
    await click('Arm Real Arduino Simulation Test')
    assert.equal(await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Test START').disabled`), true)
    await wait(`!document.querySelector('[data-experience="WIND"]').disabled`)
    await js(`document.querySelector('[data-experience="WIND"]').click()`); await pause(150)
    await click('Test START')
    await wait(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Test STOP').disabled`)
    await click('Test STOP')
    evidence.checks.manualSelectStartAfterRecovery = 'PASS'
    await click('Disconnect Arduino')
    evidence.result = 'PASS'
  } catch (error) { evidence.result = 'FAIL'; evidence.error = error.stack || String(error) }
  finally {
    if (window && !window.isDestroyed()) await js('window.natureTouch.disconnectFirmware()').catch(() => {})
    worker.stdin.end()
    await new Promise(resolve => worker.once('exit', resolve))
    writeFileSync(resolve(directory, 'results.json'), JSON.stringify(evidence, null, 2) + '\n')
    console.log(JSON.stringify({ result: evidence.result, checks: evidence.checks, error: evidence.error }))
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    app.quit()
  }
})()
