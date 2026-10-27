// Explicit opt-in physical USB test; excluded from npm test. No actuator outputs.
const { app, BrowserWindow } = require('electron')
const { SerialPort } = require('../desktop/node_modules/serialport')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const assert = require('node:assert/strict')
if (!process.argv.includes('--loads-isolated')) throw new Error('--loads-isolated required')
const reconnectionOnly = process.argv.includes('--reconnection-only')
const portPath = process.argv[process.argv.indexOf('--port') + 1]
if (!process.argv.includes('--port') || !/^COM\d+$/i.test(portPath)) throw new Error('--port COMn required')
const output = resolve(__dirname, `../docs/evidence/${reconnectionOnly ? 'hardware-step2-reconnect-real' : 'hardware-step2-real'}.json`)
const evidence = { timestamp: new Date().toISOString(), portPath, kind: 'REAL Nano / Electron UI',
  loadsIsolatedConfirmed: true, writes: [], messages: [], modes: {}, checks: {}, errors: [] }
function save(stage) {
  evidence.stage = stage
  mkdirSync(resolve(output, '..'), { recursive: true })
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n')
  console.log(stage)
}
const originalWrite = SerialPort.prototype.write
SerialPort.prototype.write = function (data, ...args) {
  const request = JSON.parse(data.toString())
  assert.ok(['IDENTIFY', 'STATUS_QUERY', 'SELECT', 'START', 'STOP'].includes(request.type))
  evidence.writes.push({ at: Date.now(), request })
  return originalWrite.call(this, data, ...args)
}
let input = ''
const originalEmit = SerialPort.prototype.emit
SerialPort.prototype.emit = function (event, ...args) {
  if (event === 'data') {
    input += args[0].toString()
    let newline
    while ((newline = input.indexOf('\n')) >= 0) {
      const line = input.slice(0, newline).trim(); input = input.slice(newline + 1)
      if (line) {
        let message
        try { message = JSON.parse(line) } catch { message = { invalidLine: line } }
        evidence.messages.push({ at: Date.now(), message })
      }
    }
  }
  return originalEmit.call(this, event, ...args)
}
const loaded = new Promise((done) => app.once('browser-window-created', (_event, window) =>
  window.webContents.once('did-finish-load', () => done(window))))
require('../desktop/out/main/main.js')
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
let window, probe
const js = (source) => window.webContents.executeJavaScript(source)
async function waitFor(source, timeout = 15000) {
  const until = Date.now() + timeout
  do { if (await js(source)) return; await pause(80) } while (Date.now() < until)
  throw new Error('Timed out: ' + source)
}
async function click(text) {
  const button = `Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(text)})`
  await waitFor(`!!(${button}) && !(${button}).disabled`)
  await js(`(${button}).click()`)
  await pause(100)
}
const snapshot = () => js('window.natureTouch.getFirmwareState()')
const stateIs = (state) => `document.querySelector('[aria-label="Arduino status"]')?.textContent.includes('"state": "${state}"')`

;(async () => {
  try {
    window = await loaded
    save('UI_LOADED')
    await waitFor(`!!document.querySelector('[aria-label="Device mode"]')`)
    evidence.ports = await js('window.natureTouch.listSerialPorts()')
    assert.ok(evidence.ports.some((port) => port.path === portPath))
    await js(`{ const select = document.querySelector('[aria-label="Device mode"]'); select.value='real'; select.dispatchEvent(new Event('change',{bubbles:true})); }`)
    await waitFor(`!!document.querySelector('[aria-label="COM port"] option[value="${portPath}"]')`)
    await js(`{ const select = document.querySelector('[aria-label="COM port"]'); select.value=${JSON.stringify(portPath)}; select.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('.device-connection input[type=checkbox]').click(); }`)
    await click('Connect + IDENTIFY')
    await waitFor(stateIs('IDLE'))
    await waitFor("!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='STATUS_QUERY').disabled")
    evidence.identity = (await snapshot())
    assert.equal(evidence.identity.identified, true)
    assert.equal(evidence.identity.simulationTestArmed, false)
    const before = evidence.writes.length
    assert.equal(await js("window.natureTouch.startFirmwareExperience('denied','denied').then(()=>false,()=>true)"), true)
    assert.equal(evidence.writes.length, before)
    evidence.checks.readOnlyGuard = true
    await js("document.querySelector('[aria-label=\"Confirm simulation firmware\"]').click()")
    await click('Arm Real Arduino Simulation Test')
    await waitFor("document.querySelector('.device-connection [role=status]').textContent.includes('SIMULATION TEST ARMED')")
    assert.equal(evidence.writes.some(({ request }) => request.type === 'START'), false)
    evidence.checks.noStartOnArm = true
    if (reconnectionOnly) {
      evidence.checks.initialIdentifyAndStatus = true
      evidence.checks.initialState = evidence.identity.experience.state
      if (!['IDLE', 'COMPLETED'].includes(evidence.identity.experience.state)) {
        throw new Error(`Cannot arm reconnect test from initial ${evidence.identity.experience.state} state; no recovery command was sent.`)
      }

      save('WAITING_FOR_OPERATOR_USB_UNPLUG')
      await waitFor("document.querySelector('.device-connection [role=status]').textContent.includes('faulted')", 240000)
      evidence.unplugSnapshot = await snapshot()
      assert.equal(evidence.unplugSnapshot.simulationTestArmed, false)
      evidence.checks.authorizationClearedOnUnplug = true
      const writesAfterUnplug = evidence.writes.length
      await pause(2500)
      assert.equal(evidence.writes.length, writesAfterUnplug)
      evidence.checks.noAutomaticReconnectWhileUnplugged = true

      save('WAITING_FOR_OPERATOR_USB_REPLUG')
      const until = Date.now() + 240000
      let reappeared = false
      while (Date.now() < until) {
        const ports = await SerialPort.list()
        evidence.replugPorts = ports
        if (ports.some((port) => port.path.toUpperCase() === portPath.toUpperCase())) {
          reappeared = true
          break
        }
        await pause(500)
      }
      assert.ok(reappeared, `Port ${portPath} did not reappear after USB reconnection.`)
      const writesBeforeManualReconnect = evidence.writes.length
      await pause(2500)
      assert.equal(evidence.writes.length, writesBeforeManualReconnect)
      assert.equal((await snapshot()).simulationTestArmed, false)
      evidence.checks.noAutomaticReconnectAfterReplug = true

      await click('Connect + IDENTIFY')
      await waitFor("!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='STATUS_QUERY').disabled")
      evidence.reconnectedSnapshot = await snapshot()
      assert.equal(evidence.reconnectedSnapshot.identified, true)
      assert.equal(evidence.reconnectedSnapshot.simulationTestArmed, false)
      assert.ok(['IDLE', 'FAULT'].includes(evidence.reconnectedSnapshot.experience.state))
      assert.equal(evidence.reconnectedSnapshot.experience.operationId, null)
      const reconnectWrites = evidence.writes.slice(writesBeforeManualReconnect).map(({ request }) => request.type)
      assert.deepEqual(reconnectWrites, ['IDENTIFY', 'STATUS_QUERY'])
      evidence.checks.manualReconnectIdentifyStatusOnly = true
      evidence.checks.postPowerCycleState = evidence.reconnectedSnapshot.experience

      await js("document.querySelector('[aria-label=\"Confirm simulation firmware\"]').click()")
      await click('Arm Real Arduino Simulation Test')
      await waitFor("document.querySelector('.device-connection [role=status]').textContent.includes('SIMULATION TEST ARMED')")
      evidence.rearmedSnapshot = await snapshot()
      assert.equal(evidence.rearmedSnapshot.simulationTestArmed, true)
      assert.equal(evidence.writes.some(({ request }) => request.type === 'START' || request.type === 'SELECT'), false)
      evidence.checks.explicitRearmRequired = true
      await click('Disarm simulation test')
      await click('Disconnect Arduino')
      await waitFor("document.querySelector('.device-connection [role=status]').textContent.includes('disconnected')")
      evidence.finalSnapshot = await snapshot()
      assert.equal(evidence.finalSnapshot.simulationTestArmed, false)
      evidence.checks.disarmedAndDisconnected = true
      evidence.result = 'PASS'
      return
    }

    for (const mode of ['WIND', 'WAVE', 'BUBBLE']) {
      save(mode + '_STARTING')
      const result = evidence.modes[mode] = {}
      await waitFor(`!document.querySelector('[data-experience="${mode}"]').disabled`)
      await js(`document.querySelector('[data-experience="${mode}"]').click()`)
      await waitFor(`document.querySelector('[aria-label="Arduino status"]').textContent.includes('"selectedExperienceId": "${mode}"')`)
      await click('Test START')
      await waitFor("!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Test STOP').disabled")
      result.stopRun = await snapshot()
      assert.equal(result.stopRun.experience.state, 'RUNNING')
      await pause(1300)
      await click('Test STOP')
      await waitFor(stateIs('IDLE'))
      await waitFor("!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='STATUS_QUERY').disabled")
      result.stopped = await snapshot()
      assert.equal(result.stopped.experience.operationId, null)
      await js(`document.querySelector('[data-experience="${mode}"]').click()`)
      await pause(100)
      await click('Test START')
      await waitFor("!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Test STOP').disabled")
      result.naturalRun = await snapshot()
      assert.equal(result.naturalRun.experience.state, 'RUNNING')
      await waitFor(stateIs('COMPLETED'), 40000)
      result.completed = await snapshot()
      const operationId = result.naturalRun.experience.operationId
      const complete = evidence.messages.filter(({ message }) => message.name === 'COMPLETED' && message.operationId === operationId)
      assert.equal(complete.length, 1)
      result.hostObservedMs = complete[0].at - evidence.messages.find(({ message }) => message.type === 'ACK' && message.command === 'START' && message.operationId === operationId).at
      const actionEvents = evidence.messages.filter(({ message }) => message.name === 'ACTUATOR_EVENT' && message.operationId === operationId).map(({ message }) => message)
      result.actionCount = actionEvents.length
      assert.equal(actionEvents.length, { WIND: 12, WAVE: 10, BUBBLE: 31 }[mode])
      assert.equal(new Set(actionEvents.map((event) => event.atMs)).size, actionEvents.length)
      assert.ok(actionEvents.every((event) => event.hardwareOutputsEnabled === false))
      const starts = evidence.writes.filter(({ request }) => request.type === 'START').length
      await pause(1500)
      assert.equal(evidence.writes.filter(({ request }) => request.type === 'START').length, starts)
      assert.equal((await snapshot()).experience.state, 'COMPLETED')
      result.result = 'PASS'
      save(mode + '_PASS')
    }
    assert.equal(evidence.writes.filter(({ request }) => request.type === 'START').length, 6)
    evidence.checks.noDuplicateStarts = true
    // Test host lease without dropping USB power: same service/transport, longer heartbeat.
    await click('Disconnect Arduino')
    await waitFor("document.querySelector('.device-connection [role=status]').textContent.includes('disconnected')")
    require('../desktop/node_modules/tsx/dist/cjs/index.cjs')
    const { ArduinoFirmwareService } = require('../desktop/electron/serial/arduino-firmware-service.ts')
    const { NativeSerialTransport } = require('../desktop/electron/serial/native-serial-transport.ts')
    probe = new ArduinoFirmwareService(new NativeSerialTransport(), { readOnly: true, allowSimulationTest: true, heartbeatIntervalMs: 15000 })
    await probe.connect(portPath)
    await probe.armSimulationTest(true, true)
    await probe.selectExperience('leaseSelect', 'WIND')
    await probe.start('leaseStart', 'leaseOperation')
    save('HOST_LEASE_TEST_SILENT_USB_STILL_POWERED')
    await pause(6500)
    const response = await probe.queryStatus('leaseStatus')
    evidence.hostLease = response
    if (response.snapshot.state !== 'FAULT' || response.snapshot.faultCode !== 'HOST_TIMEOUT') {
      // Cancel the incompatible simulation before stopping this validation run.
      if (response.snapshot.state === 'RUNNING') evidence.compatibilityCleanupStop = await probe.stop('leaseStop', 'leaseOperation')
      throw new Error('INSTALLED_FIRMWARE_MISMATCH: no HOST_TIMEOUT FAULT after 6500 ms with no accepted host traffic. Stop; no firmware upload authorized.')
    }
    evidence.checks.hostLeaseTimeout = true
    await probe.disconnect(); probe = undefined
    await pause(150)
    await js("document.querySelector('.device-connection input[type=checkbox]').click()")
    await click('Connect + IDENTIFY')
    await waitFor(stateIs('IDLE'))
    await waitFor("!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='STATUS_QUERY').disabled")
    assert.equal((await snapshot()).simulationTestArmed, false)
    evidence.checks.reconnectReadOnlyNoRestart = true
    if (process.argv.includes('--wait-for-unplug')) {
      save('WAITING_FOR_OPERATOR_USB_UNPLUG')
      await waitFor("document.querySelector('.device-connection [role=status]').textContent.includes('faulted')", 240000)
      evidence.unplugSnapshot = await snapshot()
      assert.equal(evidence.unplugSnapshot.simulationTestArmed, false)
      const count = evidence.writes.length
      await pause(2500)
      assert.equal(evidence.writes.length, count)
      evidence.checks.physicalUsbUnplug = true
    } else evidence.checks.physicalUsbUnplug = 'NOT TESTED'
    evidence.result = 'PASS'
  } catch (error) {
    evidence.result = 'FAIL'
    evidence.errors.push(error.stack || String(error))
  } finally {
    if (probe) await probe.disconnect().catch(() => {})
    if (window && !window.isDestroyed()) await js('window.natureTouch.disconnectFirmware()').catch(() => {})
    save('COMPLETE')
    for (const instance of BrowserWindow.getAllWindows()) instance.destroy()
    app.quit()
  }
})()
