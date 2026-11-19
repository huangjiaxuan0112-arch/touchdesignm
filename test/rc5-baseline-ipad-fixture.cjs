// Offline browser-client acceptance. No real iPad, LAN interface or serial port is used.
const { app, BrowserWindow, ipcMain, session } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { join, dirname } = require('node:path')
const { tmpdir } = require('node:os')
const Module = require('node:module')
const https = require('node:https')
const { createHash } = require('node:crypto')
const profile = process.argv.includes('--exhibition') ? 'exhibition' : 'mock'
const root = join(__dirname, '..')
const output = fs.mkdtempSync(join(tmpdir(), 'nature-touch-ipad-loopback-'))
app.setPath('userData', join(output, 'profile'))
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-background-media-suspend')
for (const name of Object.keys(process.env)) if (name.startsWith('NATURE_TOUCH_IPAD_')) delete process.env[name]
delete process.env.ELECTRON_RENDERER_URL
const evidence = { profile, scope: 'LOOPBACK_BROWSER_CLIENT_NOT_PHYSICAL_IPAD', checks: [], phases: [], media: [], commands: [], rounds: [], errors: [], hardwareAccessAttempts: 0 }
const serial = require('../desktop/node_modules/serialport')
const forbidden = () => { evidence.hardwareAccessAttempts++; throw Error('Native Arduino access forbidden in loopback acceptance') }
serial.SerialPort.list = forbidden
serial.SerialPort.prototype.open = forbidden
serial.SerialPort.prototype.write = forbidden
let port, main, ipad, projection, finishing = false
const handlers = {}
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => {
  handlers[channel] = listener
  handle(channel, async (event, ...args) => {
    if (event.sender.getURL().includes('projector.html')) assert(['projector:media-report', 'exhibition:get-snapshot'].includes(channel))
    const result = await listener(event, ...args)
    if (channel === 'experience:dispatch') evidence.commands.push({ ...args[0], accepted: result?.accepted ?? result?.acknowledgement?.accepted ?? false })
    return result
  })
}
const createServer = https.createServer
https.createServer = (...args) => {
  const server = createServer(...args)
  server.once('listening', () => { port = server.address().port })
  return server
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const js = (window, code) => window.webContents.executeJavaScript(code, true)
async function wait(check, timeout = 15000) {
  const until = Date.now() + timeout
  while (Date.now() < until) { if (await check()) return; await pause(40) }
  throw Error('Timed out: ' + check.toString())
}
const watchdog = setTimeout(() => finish(Error('Offline acceptance watchdog')), 155000)
function finish(error) {
  if (finishing) return
  finishing = true
  clearTimeout(watchdog)
  if (error) evidence.errors.push(error.stack ?? String(error))
  evidence.hardwareAccessAttempts === 0 || evidence.errors.push('Hardware API attempted')
  evidence.result = evidence.errors.length ? 'FAIL' : 'PASS'
  evidence.finishedUtc = new Date().toISOString()
  fs.mkdirSync(join(root, '.validation/ipad-lan-acceptance-20261105'), { recursive: true })
  for (const file of [join(output, 'results.json'), join(root, '.validation/ipad-lan-acceptance-20261105/loopback-' + profile + '-results.json')]) fs.writeFileSync(file, JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ result: evidence.result, profile, evidence: join(output, 'results.json'), rounds: evidence.rounds, checks: evidence.checks, errors: evidence.errors }))
  // app.exit closes only this isolated test process and all its test windows/sockets.
  app.exit(evidence.errors.length ? 1 : 0)
}
app.on('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false)
  window.webContents.on('console-message', (_event, _level, message) => {
    if (message.startsWith('projector.media ')) try { evidence.media.push(JSON.parse(message.slice(16))) } catch {}
  })
  const send = window.webContents.send.bind(window.webContents)
  window.webContents.send = (channel, ...args) => {
    if (window === main && channel === 'exhibition:event') evidence.phases.push({ ...args[0], at: Date.now() })
    return send(channel, ...args)
  }
  if (!main) {
    main = window
    window.webContents.once('did-finish-load', () => run().then(() => finish(), finish))
  }
})
async function run() {
  await wait(() => port && BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('projector.html')))
  projection = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('projector.html'))
  await wait(() => !projection.webContents.isLoadingMainFrame())
  const runtime = await js(main, 'window.natureTouch.getRuntimeInfo()')
  assert.equal(runtime.exhibitionDeviceSource, profile === 'mock' ? 'mock' : 'firmware')
  // Separate browser session: this exception trusts exactly the existing TEST certificate on loopback.
  const browserSession = session.fromPartition('ipad-loopback-' + Date.now())
  const certificate = fs.readFileSync(join(__dirname, 'fixtures/ipad-test-cert.pem'))
  const expectedFingerprint = new (require('node:crypto').X509Certificate)(certificate).fingerprint256
  browserSession.setCertificateVerifyProc((request, done) => {
    const fingerprint = new (require('node:crypto').X509Certificate)(request.certificate.data).fingerprint256
    done(request.hostname === '127.0.0.1' && fingerprint === expectedFingerprint ? 0 : -3)
  })
  ipad = new BrowserWindow({ width: 1024, height: 768, show: false, webPreferences: { session: browserSession, nodeIntegration: false, contextIsolation: true } })
  await ipad.loadURL('https://127.0.0.1:' + port + '/')
  await wait(() => js(ipad, '!document.querySelector("#login-panel").hidden'))
  await js(ipad, `document.querySelector('#password').value='NatureTouch-Loopback-Only-20261105';document.querySelector('#login-form').requestSubmit();true`)
  await wait(() => js(ipad, '!document.querySelector("#control-panel").hidden && document.querySelector("#connection").textContent === "网络已连接"'))
  const state = () => js(ipad, 'fetch("/api/state").then(r=>r.json())')
  const phase = value => wait(async () => (await state()).phase === value, 40000)
  const initial = await state()
  evidence.initial = initial
  assert.equal(initial.runtimeMode, profile)
  assert.equal(initial.phase, 'READY')
  if (profile === 'exhibition') {
    assert.equal(initial.device.connectionState, 'disconnected')
    assert.equal(initial.device.identified, false)
    assert.equal(initial.device.verified, false)
    assert.equal(initial.canSelect, false)
    assert(await js(ipad, `[...document.querySelectorAll('[data-experience]')].every(b=>b.disabled) && document.querySelector('footer').textContent.includes('真实设备未连接')`))
    const refusal = await js(ipad, `fetch('/api/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({experienceId:'WIND'})}).then(async r=>({status:r.status,body:await r.json()}))`)
    assert.equal(refusal.status, 503)
    assert.equal(refusal.body.error, 'DEVICE_UNAVAILABLE')
    assert.equal((await state()).phase, 'READY')
    assert.equal(evidence.commands.filter(c => c.type === 'START').length, 0)
    evidence.checks.push('Exhibition network connected + lifecycle READY + device disconnected are distinct; disabled UI and forged POST cannot START or substitute Mock')
    return
  }
  assert.equal(initial.device.connectionState, 'simulated')
  assert.equal(initial.device.identified, false)
  assert(await js(ipad, `document.querySelector('footer').textContent.includes('模拟设备（非真实硬件）')`))
  await js(projection, `window.__video=document.querySelector('video');window.__plays=0;const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(this===window.__video)window.__plays++;return play.call(this)};true`)
  for (const mode of ['WIND', 'WAVE', 'BUBBLE']) {
    await wait(() => js(ipad, `!document.querySelector('[data-experience="${mode}"]').disabled`))
    await js(projection, 'window.__plays=0;true')
    await js(ipad, `document.querySelector('[data-experience="${mode}"]').click();document.querySelector('[data-experience="${mode}"]').click();true`)
    await phase('WAITING')
    const ack = await state(), started = ack.startAcknowledgedAtMs
    assert.equal(ack.experienceId, mode)
    assert.equal(ack.device.state, 'RUNNING')
    await wait(() => evidence.media.some(r => r.event === 'playing' && r.operationId === ack.operationId))
    const src = await js(projection, 'document.querySelector("video").currentSrc')
    assert(src.includes(mode === 'BUBBLE' ? 'bubble-20s' : mode.toLowerCase() + '-20s'))
    const rejectRepeat = async () => {
      const result = await js(ipad, `fetch('/api/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({experienceId:'WAVE'})}).then(r=>r.status)`)
      assert.equal(result, 409)
    }
    await rejectRepeat()
    await phase('EXPERIENCE')
    const fifth = await js(projection, '({same:window.__video===document.querySelector("video"),src:window.__video.currentSrc,time:window.__video.currentTime,plays:window.__plays,paused:window.__video.paused})')
    assert(fifth.same && !fifth.paused && fifth.time >= 4.5 && fifth.time < 7)
    assert.equal(fifth.src, src)
    assert.equal(fifth.plays, 1)
    await rejectRepeat()
    await phase('AWAIT_COMPLETION')
    assert.equal((await state()).device.state, 'RUNNING')
    await wait(() => evidence.media.some(r => r.event === 'ended' && r.operationId === ack.operationId), 4000)
    assert(await js(projection, '!window.__video.hasAttribute("src") && window.__video.paused && window.__plays === 1'))
    await rejectRepeat()
    await phase('COOLDOWN')
    const completed = Date.now()
    assert.equal((await state()).device.state, 'COMPLETED')
    assert(completed - started >= 24900)
    await rejectRepeat()
    await pause(2500)
    assert.equal((await state()).phase, 'COOLDOWN')
    await phase('READY')
    const ready = Date.now()
    assert(ready - completed >= 2900)
    assert(ready - started >= 27900)
    const playing = evidence.media.find(r => r.event === 'playing' && r.operationId === ack.operationId)
    const ended = evidence.media.find(r => r.event === 'ended' && r.operationId === ack.operationId)
    assert(ended.elapsedMs >= 19000 && ended.elapsedMs <= 21000)
    evidence.rounds.push({ mode, operationId: ack.operationId, ackToPlayingMs: playing.ackToPlayingMs, movieElapsedMs: ended.elapsedMs, completedAfterAckMs: completed - started, readyAfterAckMs: ready - started, fifth })
    console.log('ROUND PASS ' + mode)
  }
  assert.equal(evidence.commands.filter(c => c.type === 'START' && c.accepted).length, 3)
  assert.equal(new Set(evidence.phases.filter(s => s.phase === 'WAITING').map(s => s.operationId)).size, 3)
  // Lost SSE disables input immediately; polling cannot reenable it or submit another START.
  await js(ipad, 'eventStream.close();eventStream.onerror();true')
  assert(await js(ipad, `[...document.querySelectorAll('[data-experience]')].every(b=>b.disabled)`))
  await js(ipad, 'connect()')
  await wait(() => js(ipad, `document.querySelector('#connection').textContent === '网络已连接' && !document.querySelector('[data-experience]').disabled`))
  assert.equal(evidence.commands.filter(c => c.type === 'START' && c.accepted).length, 3)
  evidence.checks.push('Three browser cards -> authenticated HTTPS -> Main lifecycle -> one Mock START per mode -> continuous 20s Projector -> 25s completion -> 3s cooldown; duplicate clicks and HTTP repeats rejected')
  evidence.checks.push('SSE disconnect disables controls; reconnect restores current state without SELECT or START')
}
process.on('uncaughtException', finish)
process.on('unhandledRejection', finish)
// Only replace network binding with the class's pre-existing test loopback adapter IN MEMORY.
// Production Main lifecycle, source choice, readiness gates and source files stay unchanged.
const entry = join(root, 'desktop', profile === 'mock' ? 'out/main/main.js' : 'out-exhibition-rc5-valve/main/main.js')
let code = fs.readFileSync(entry, 'utf8')
evidence.productionMainSha256 = createHash('sha256').update(code).digest('hex')
assert.equal(code.split('new IpadLanServer(config, lifecycle, false, readRuntimeStatus)').length, 2)
code = code.replace('new IpadLanServer(config, lifecycle, false, readRuntimeStatus)', 'new IpadLanServer(config, lifecycle, true, readRuntimeStatus)')
const configLine = /^  const ipadConfig = readIpadLanServerConfig\([^\n]+$/m
assert(configLine.test(code))
global.__natureTouchLoopbackConfig = { bindAddress: '127.0.0.1', port: 0, password: 'NatureTouch-Loopback-Only-20261105',
  tlsKey: fs.readFileSync(join(__dirname, 'fixtures/ipad-test-key.pem'), 'utf8'),
  tlsCertificate: fs.readFileSync(join(__dirname, 'fixtures/ipad-test-cert.pem'), 'utf8'), staticDirectory: join(root, 'desktop/ipad') }
code = code.replace(configLine, '  const ipadConfig = global.__natureTouchLoopbackConfig;')
const compiled = new Module(entry, module)
compiled.filename = entry
compiled.paths = Module._nodeModulePaths(dirname(entry))
compiled._compile(code, entry)
