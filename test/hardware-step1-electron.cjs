// Opt-in REAL USB check. Never included in npm test. Requires isolated loads.
const { app, BrowserWindow } = require('electron')
const { SerialPort } = require('../desktop/node_modules/serialport')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const assert = require('node:assert/strict')

if (!process.argv.includes('--loads-isolated')) throw new Error('Explicit --loads-isolated confirmation required')
const portPath = process.argv[process.argv.indexOf('--port') + 1]
if (!process.argv.includes('--port') || !/^COM\d+$/i.test(portPath)) throw new Error('Choose a discovered Windows COM port with --port COMn')
const evidence = { timestamp: new Date().toISOString(), kind: 'REAL Electron UI + native SerialPort', portPath,
  loadsIsolatedConfirmed: true, writes: [], incoming: [], checks: {}, errors: [] }
const originalWrite = SerialPort.prototype.write
SerialPort.prototype.write = function (data, ...args) {
  const text = data.toString()
  const command = JSON.parse(text)
  assert.ok(['IDENTIFY', 'STATUS_QUERY'].includes(command.type), 'Only read-only serial requests permitted')
  evidence.writes.push(text)
  return originalWrite.call(this, data, ...args)
}
const originalEmit = SerialPort.prototype.emit
SerialPort.prototype.emit = function (event, ...args) {
  if (event === 'data') evidence.incoming.push(args[0].toString())
  return originalEmit.call(this, event, ...args)
}
const output = resolve(__dirname, '../docs/evidence/hardware-step1-real.json')
const loaded = new Promise((done) => app.once('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => done(window))
}))
require('../desktop/out/main/main.js')
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
async function waitFor(window, expression, timeout = 15000) {
  const until = Date.now() + timeout
  do {
    if (await window.webContents.executeJavaScript(expression)) return
    await pause(100)
  } while (Date.now() < until)
  throw new Error(`Timed out: ${expression}`)
}

;(async () => {
  try {
    const window = await loaded
    await waitFor(window, "!!document.querySelector('[aria-label=\"Device mode\"]')")
    evidence.ports = await window.webContents.executeJavaScript('window.natureTouch.listSerialPorts()')
    assert.ok(evidence.ports.some((port) => port.path === portPath), 'Chosen port must be dynamically discovered')
    await window.webContents.executeJavaScript(`{
      const select = document.querySelector('[aria-label="Device mode"]');
      select.value = 'real'; select.dispatchEvent(new Event('change', { bubbles: true }));
    }`)
    await waitFor(window, `!!Array.from(document.querySelectorAll('[aria-label="COM port"] option')).find(o => o.value === ${JSON.stringify(portPath)})`)
    await window.webContents.executeJavaScript(`{
      const select = document.querySelector('[aria-label="COM port"]');
      select.value = ${JSON.stringify(portPath)}; select.dispatchEvent(new Event('change', { bubbles: true }));
    }`)
    evidence.checks.confirmationRequired = await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Connect + IDENTIFY').disabled")
    assert.equal(evidence.checks.confirmationRequired, true)
    await window.webContents.executeJavaScript("document.querySelector('.device-connection input[type=checkbox]').click()")
    await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Connect + IDENTIFY').click()")
    await waitFor(window, "document.querySelector('.device-connection [role=status]').textContent.includes('connected (') || document.querySelector('.device-connection [role=status]').textContent.includes('faulted')")
    await waitFor(window, "document.querySelector('[aria-label=\"Arduino status\"]') || document.querySelector('.device-connection [role=status]').textContent.includes('faulted')")
    evidence.connectedSnapshot = await window.webContents.executeJavaScript('window.natureTouch.getFirmwareState()')
    evidence.visibleText = await window.webContents.executeJavaScript("document.querySelector('.device-connection').innerText")
    assert.equal(evidence.connectedSnapshot.identified, true, evidence.visibleText)
    evidence.checks.identify = true
    // IDENTIFY becomes visible before the connection's initial STATUS completes.
    await waitFor(window, "!Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'STATUS_QUERY').disabled")
    evidence.checks.realCardsDisabled = await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('[data-experience]')).every(b => b.disabled)")
    assert.equal(evidence.checks.realCardsDisabled, true)
    const count = evidence.writes.length
    for (const call of ["selectFirmwareExperience('WIND','blocked1')", "startFirmwareExperience('blocked2','op1')", "recoverFirmware('blocked3')", "pingSerial()", "getDiagnosticStatus()", "connectSerial('COM3',9600)"]) {
      const rejected = await window.webContents.executeJavaScript(`window.natureTouch.${call}.then(() => false, () => true)`)
      assert.equal(rejected, true, call)
    }
    assert.equal(evidence.writes.length, count)
    evidence.checks.mainProcessMutationGuard = true
    await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'STATUS_QUERY').click()")
    // React may not commit busy=true before executeJavaScript returns from click().
    await pause(150)
    await waitFor(window, "!Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'STATUS_QUERY').disabled")
    evidence.statusSnapshot = await window.webContents.executeJavaScript('window.natureTouch.getFirmwareState()')
    evidence.checks.statusQuery = evidence.writes.slice(count).some((line) => JSON.parse(line).type === 'STATUS_QUERY')
    assert.equal(evidence.checks.statusQuery, true)
    await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Disconnect Arduino').click()")
    await waitFor(window, "document.querySelector('.device-connection [role=status]').textContent.includes('disconnected')")
    evidence.checks.explicitDisconnect = true
    if (process.argv.includes('--wait-for-unplug')) {
      await pause(150)
      await window.webContents.executeJavaScript("document.querySelector('.device-connection input[type=checkbox]').click()")
      await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Connect + IDENTIFY').click()")
      await waitFor(window, "!!document.querySelector('[aria-label=\"Arduino status\"]')")
      await waitFor(window, "!Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'STATUS_QUERY').disabled")
      evidence.stage = 'WAITING_FOR_OPERATOR_USB_UNPLUG'
      mkdirSync(resolve(output, '..'), { recursive: true })
      writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n')
      console.log(evidence.stage)
      await waitFor(window, "document.querySelector('.device-connection [role=status]').textContent.includes('faulted')", 240000)
      evidence.unplugSnapshot = await window.webContents.executeJavaScript('window.natureTouch.getFirmwareState()')
      evidence.unplugVisibleText = await window.webContents.executeJavaScript("document.querySelector('.device-connection').innerText")
      const unplugCount = evidence.writes.length
      await pause(2500)
      assert.equal(evidence.writes.length, unplugCount, 'No reconnect or commands after unplug')
      assert.equal(evidence.unplugSnapshot.identified, false)
      evidence.checks.physicalUsbUnplug = true
      evidence.stage = 'COMPLETE'
    } else evidence.checks.physicalUsbUnplug = 'NOT TESTED — operator unplug required'
    evidence.result = evidence.checks.physicalUsbUnplug === true ? 'PASS' : 'PASS (physical unplug pending)'
  } catch (error) {
    evidence.result = 'FAIL'
    evidence.errors.push(error.stack || String(error))
  } finally {
    mkdirSync(resolve(output, '..'), { recursive: true })
    writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n')
    console.log(JSON.stringify({ result: evidence.result, output, errors: evidence.errors }))
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    app.quit()
  }
})()
