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
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
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
  const evidenceDirectory = process.env.NATURE_TOUCH_TEST_RESULTS || join(root, '.validation/10s-preparing-25s-projector')
  fs.mkdirSync(evidenceDirectory, { recursive: true })
  for (const file of [join(output, 'results.json'), join(evidenceDirectory, 'loopback-' + profile + '-results.json')]) fs.writeFileSync(file, JSON.stringify(evidence, null, 2))
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
  evidence.rendererProcessIds = { main: main.webContents.getOSProcessId(), projector: projection.webContents.getOSProcessId() }
  assert.notEqual(evidence.rendererProcessIds.main, evidence.rendererProcessIds.projector)
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
  ipad = new BrowserWindow({ x: main.getBounds().x, y: main.getBounds().y, width: Math.min(1024, main.getBounds().width), height: 768,
    show: false, webPreferences: { session: browserSession, nodeIntegration: false, contextIsolation: true } })
  await ipad.loadURL('https://127.0.0.1:' + port + '/')
  ipad.showInactive()
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
  await js(projection, `window.__video=document.querySelector('video');window.__plays=0;window.__loads=0;
    const play=HTMLMediaElement.prototype.play,load=HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.play=function(){if(this===window.__video)window.__plays++;return play.call(this)};
    HTMLMediaElement.prototype.load=function(){if(this===window.__video&&this.hasAttribute('src'))window.__loads++;return load.call(this)};true`)
  await js(ipad, `window.__preparingVisibility=[];
    const overlay=document.querySelector('#preparing');
    new MutationObserver(()=>window.__preparingVisibility.push({visible:!overlay.hidden,at:Date.now()}))
      .observe(overlay,{attributeFilter:['hidden']});true`)
  const preparingState = () => js(ipad, `(() => {
    const overlay = document.querySelector('#preparing'), stage = overlay.querySelector('[data-mode]');
    const mode = stage.dataset.mode, breath = stage.querySelector('.nt-preparing__breath');
    const progress = stage.querySelector(mode === 'bubble' ? '.nt-preparing__b5' : '.nt-preparing__'+mode+'grow');
    return { visible: !overlay.hidden && getComputedStyle(overlay).display !== 'none',
      mode, title: stage.querySelector('h1').textContent, breathDuration: getComputedStyle(breath).animationDuration,
      breathCycles: getComputedStyle(breath).animationIterationCount,
      duration: getComputedStyle(progress).animationDuration.split(',')[0],
      animationMs: progress.getAnimations()[0]?.currentTime,
      opacity: Number(getComputedStyle(progress).opacity), dash: parseFloat(getComputedStyle(progress).strokeDashoffset) };
  })()`)
  for (const mode of ['BUBBLE', 'WIND', 'WAVE']) {
    await wait(() => js(ipad, `!document.querySelector('[data-experience="${mode}"]').disabled`))
    await js(projection, 'window.__plays=0;window.__loads=0;true')
    await js(ipad, 'window.__preparingVisibility=[];true')
    await js(ipad, `document.querySelector('[data-experience="${mode}"]').click();document.querySelector('[data-experience="${mode}"]').click();true`)
    await phase('WAITING')
    const ack = await state(), started = ack.startAcknowledgedAtMs
    assert.equal(ack.experienceId, mode)
    assert.equal(ack.device.state, 'RUNNING')
    await wait(() => evidence.media.some(r => r.event === 'playing' && r.operationId === ack.operationId))
    const movie = await js(projection, `({src:window.__video.currentSrc, duration:window.__video.duration,
      width:window.__video.videoWidth, height:window.__video.videoHeight, muted:window.__video.muted, loop:window.__video.loop})`)
    assert(movie.src.includes(mode.toLowerCase() + '-25s-silent'))
    assert.deepEqual([movie.duration, movie.width, movie.height, movie.muted, movie.loop], [25, 1920, 1080, true, false])
    await wait(async () => (await preparingState()).visible)
    const preparing = await preparingState()
    assert.equal(preparing.mode, mode.toLowerCase())
    assert.equal(preparing.title, { WIND:'風', WAVE:'波', BUBBLE:'泡' }[mode] + 'の体験を準備しています。')
    assert.deepEqual([preparing.breathDuration, preparing.breathCycles, preparing.duration], ['5s', '2', '10s'])
    assert(mode === 'BUBBLE' ? preparing.opacity === 0 : preparing.dash > 85)
    const rejectRepeat = async () => {
      const result = await js(ipad, `fetch('/api/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({experienceId:'WAVE'})}).then(r=>r.status)`)
      assert.equal(result, 409)
    }
    await rejectRepeat()
    await wait(() => Date.now() - started >= 9000)
    let nearEnd
    const animationSamples = []
    await wait(async () => {
      nearEnd = await preparingState()
      animationSamples.push(nearEnd)
      return nearEnd.visible && (mode === 'BUBBLE' ? nearEnd.opacity >= .85 : nearEnd.dash < 10)
    }, 1000).catch(error => {
      evidence.animationSamples = animationSamples
      throw error
    })
    await phase('EXPERIENCE')
    await wait(() => js(ipad, `document.querySelector('#preparing').hidden && document.querySelector('#phase').textContent === 'EXPERIENCE'`))
    const visibility = await js(ipad, 'window.__preparingVisibility')
    assert.deepEqual(visibility.map(event => event.visible), [true, false])
    const preparingMs = visibility[1].at - visibility[0].at
    assert(preparingMs >= 9700 && preparingMs < 10300)
    const tenth = await js(projection, '({same:window.__video===document.querySelector("video"),src:window.__video.currentSrc,time:window.__video.currentTime,plays:window.__plays,loads:window.__loads,paused:window.__video.paused,readyState:window.__video.readyState})')
    assert(tenth.same && !tenth.paused && tenth.time >= 9.5 && tenth.time < 11.5, JSON.stringify(tenth))
    assert.equal(tenth.src, movie.src)
    assert.equal(tenth.plays, 1)
    assert.equal(tenth.loads, 1)
    await rejectRepeat()
    await phase('AWAIT_COMPLETION')
    assert.equal((await state()).device.state, 'RUNNING')
    await wait(() => evidence.media.some(r => r.event === 'ended' && r.operationId === ack.operationId), 4000)
    await wait(() => js(projection, `!window.__video.hasAttribute('src') && window.__video.paused &&
      document.querySelector('h1')?.textContent === 'Standby' && window.__plays === 1 && window.__loads === 1`))
    const standbyAfterAckMs = Date.now() - started
    assert(standbyAfterAckMs >= 24700 && standbyAfterAckMs < 26500)
    await rejectRepeat()
    await phase('COOLDOWN')
    const completed = Date.now()
    assert.equal((await state()).device.state, 'COMPLETED')
    assert(completed - started >= 29900 && completed - started < 30700)
    await rejectRepeat()
    await pause(2500)
    assert.equal((await state()).phase, 'COOLDOWN')
    await phase('READY')
    const ready = Date.now()
    assert(ready - completed >= 2900)
    assert(ready - started >= 32900 && ready - started < 33700)
    const playing = evidence.media.find(r => r.event === 'playing' && r.operationId === ack.operationId)
    const ended = evidence.media.find(r => r.event === 'ended' && r.operationId === ack.operationId)
    assert(playing.ackToPlayingMs >= 0 && playing.ackToPlayingMs < 500)
    assert(ended.elapsedMs >= 24500 && ended.elapsedMs <= 25500)
    assert.equal(ended.currentTime, 25)
    assert.equal(evidence.commands.filter(c => c.type === 'START' && c.operationId === ack.operationId && c.accepted).length, 1)
    evidence.rounds.push({ mode, operationId: ack.operationId, preparingMs, ackToPlayingMs: playing.ackToPlayingMs,
      movieElapsedMs: ended.elapsedMs, standbyAfterAckMs, completedAfterAckMs: completed - started,
      readyAfterAckMs: ready - started, preparing, nearEnd, tenth })
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
  evidence.checks.push('Three browser cards -> authenticated HTTPS -> 10s mode-specific Preparing -> continuous 25s Projector -> 30s Mock completion -> 3s cooldown; one START per mode; duplicate clicks and HTTP repeats rejected')
  evidence.checks.push('SSE disconnect disables controls; reconnect restores current state without SELECT or START')
}
process.on('uncaughtException', finish)
process.on('unhandledRejection', finish)
// Only replace network binding with the class's pre-existing test loopback adapter IN MEMORY.
// Production Main lifecycle, source choice, readiness gates and source files stay unchanged.
const entry = join(root, 'desktop', profile === 'mock' ? 'out/main/main.js' : 'out-exhibition/main/main.js')
let code = fs.readFileSync(entry, 'utf8')
if (profile === 'mock') assert.match(code, /const EXHIBITION_DEVICE_SOURCE = "mock";/)
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
