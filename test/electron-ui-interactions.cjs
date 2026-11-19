const { app, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve } = require('node:path')

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-background-media-suspend')

const output = mkdtempSync(resolve(tmpdir(), 'nature-touch-v3-ui-'))
app.setPath('userData', resolve(output, 'profile'))
for (const name of Object.keys(process.env)) if (name.startsWith('NATURE_TOUCH_IPAD_')) delete process.env[name]
delete process.env.ELECTRON_RENDERER_URL
const evidence = { checks: [], commands: [], errors: [], hardwareAccessAttempts: 0 }
const serial = require('../desktop/node_modules/serialport')
const forbidden = () => { evidence.hardwareAccessAttempts++; throw Error('COM access forbidden by V3 UI test') }
serial.SerialPort.list = forbidden
serial.SerialPort.prototype.open = forbidden
serial.SerialPort.prototype.write = forbidden

const originalHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => originalHandle(channel, async (...args) => {
  const command = channel === 'experience:dispatch' ? args[1] : undefined
  let result
  try {
    result = await listener(...args)
  } catch (error) {
    if (command && ['SELECT', 'START', 'STOP'].includes(command.type)) {
      evidence.commands.push({ ...command, channel, accepted: false, error: error.message })
    }
    throw error
  }
  if (command && ['SELECT', 'START', 'STOP'].includes(command.type)) {
    evidence.commands.push({
      ...command,
      channel,
      accepted: result?.accepted ?? result?.acknowledgement?.accepted ?? false,
    })
  }
  return result
})

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const countAccepted = type => evidence.commands.filter(command => command.type === type && command.accepted).length
function pass(name) { evidence.checks.push({ name, result: 'PASS' }) }

let win
let finished = false
let timeout
function finish(error) {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  if (!error && evidence.hardwareAccessAttempts) error = Error('Native serial API attempted')
  if (error) evidence.errors.push(error.stack ?? String(error))
  writeFileSync(resolve(output, 'results.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ result: error ? 'FAIL' : 'PASS', evidence: resolve(output, 'results.json'), ...evidence }))
  app.exit(error ? 1 : 0)
}

const js = source => win.webContents.executeJavaScript(source, true)
async function wait(source, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (await js(source)) return } catch {}
    await pause(100)
  }
  throw Error(`Timed out: ${source}`)
}

function dispatch(command) {
  return js(`window.natureTouch.dispatchExperienceCommand(${JSON.stringify(command)})
    .then(value=>({accepted:value?.accepted??value?.acknowledgement?.accepted??false}))
    .catch(error=>({error:error.message}))`)
}

async function run() {
  win.webContents.setBackgroundThrottling(false)
  win.setContentSize(1920, 1248)
  win.show()
  win.focus()
  win.webContents.focus()
  await wait(`!!document.querySelector('[data-experience="WIND"]')`)
  assert.equal(await js(`document.querySelectorAll('[data-experience]').length`), 3)
  assert.equal(await js(`!!document.querySelector('[aria-label="Device mode"]')`), false)
  pass('Home exposes only the three Mock exhibition experiences')

  await js(`window.__phases=[];window.natureTouch.subscribeExhibition(s=>window.__phases.push({...s,at:Date.now()}));
    window.__holdMedia=true;
    window.__mediaReady=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'readyState');
    Object.defineProperty(HTMLMediaElement.prototype,'readyState',{configurable:true,get(){
      return window.__holdMedia && this.matches('.experience-dialog__video') ? 1 : window.__mediaReady.get.call(this)
    }});true`)
  await js(`document.querySelector('[data-experience="WIND"]').click()`)
  await wait(`!!document.querySelector('.experience-dialog video')`)
  await wait(`window.__mediaReady.get.call(document.querySelector('.experience-dialog video'))>=3`)
  await pause(1_200)
  assert.equal((await js(`window.natureTouch.getExhibitionSnapshot()`)).phase, 'STARTING')
  assert.equal(countAccepted('START'), 0, 'media preloading must not start the device')
  assert.equal(await js(`!!document.querySelector('[data-preparing],.experience-dialog[open]')`), false)
  await js(`window.__preloadedVideo=document.querySelector('.experience-dialog video');
    window.__holdMedia=false;window.__preloadedVideo.dispatchEvent(new Event('canplay'));true`)
  await wait(`!!document.querySelector('[data-preparing="WIND"]')`)
  assert.equal(countAccepted('SELECT'), 1)
  assert.equal(countAccepted('START'), 1, 'Waiting follows one confirmed START')
  assert.equal(await js(`!!document.querySelector('.experience-dialog[open]')`), false,
    'PreparingPage is the only visible Waiting UI')
  assert(await js(`window.__preloadedVideo.paused && window.__preloadedVideo.currentTime===0`))
  assert.equal(await js(`document.querySelectorAll('audio').length`), 0)
  await pause(1_000)
  assert(await js(`!!document.querySelector('[data-preparing="WIND"]')`))
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' })
  await wait(`!document.querySelector('[data-preparing="WIND"]')`)
  await wait(`document.querySelector('[data-experience-player]')?.dataset.exhibitionPhase==='EXPERIENCE'`)
  const phases = await js('window.__phases')
  const waitingAt = phases.find(s=>s.phase==='WAITING').at
  const experienceAt = phases.find(s=>s.phase==='EXPERIENCE').at
  assert(experienceAt-waitingAt>=9_800 && experienceAt-waitingAt<11_000)
  assert(await js(`window.__preloadedVideo===document.querySelector('.experience-dialog video')`), 'preloaded media must be retained')
  pass('Slow preloading remains STARTING; one START then PreparingPage for ten seconds, without playing media')
  assert.equal(countAccepted('SELECT'), 1)
  assert.equal(countAccepted('START'), 1)
  assert.equal(await js(`!!document.querySelector('.experience-dialog button, .experience-dialog [role="button"]')`), false)
  assert.equal(await js(`document.querySelector('.experience-dialog video').controls`), false)
  assert.equal(await js(`document.querySelector('.experience-dialog video').loop`), false)
  assert.equal(await js(`document.querySelector('.experience-dialog video').paused`), false,
    'formal video must start when the experience phase begins')
  const operation = (await js(`window.natureTouch.getExhibitionSnapshot()`)).operationId
  const duringExperience = await js(`window.natureTouch.getExperienceSnapshot('mock')`)
  assert.equal(duringExperience.experience.state, 'RUNNING')
  const audienceStop = await dispatch({
    type: 'STOP', mode: 'mock', requestId: 'audience-stop', operationId: operation,
  })
  assert.match(audienceStop.error, /Audience STOP is unavailable during an exhibition experience/)
  const duplicateStart = await dispatch({
    type: 'START', mode: 'mock', requestId: 'duplicate-start', operationId: `${operation}-duplicate`,
  })
  assert.match(duplicateStart.error, /cannot START during EXPERIENCE/i)
  const alternateSelect = await dispatch({
    type: 'SELECT', mode: 'mock', experienceId: 'WAVE', requestId: 'audience-switch',
  })
  assert.match(alternateSelect.error, /in progress or cooling down/i)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' })
  await pause(200)
  assert.equal(await js(`!!document.querySelector('.experience-dialog[open]')`), true,
    'Escape must not close the active experience')
  pass('Experience locks audience controls and rejects direct STOP, START, SELECT, and Escape')

  await wait(`document.querySelector('[data-experience-player]')?.dataset.exhibitionPhase==='EXPERIENCE'`, 8_000)
  await wait(`!document.querySelector('.experience-dialog video').paused`)
  await pause(350)
  const videoTime = await js(`document.querySelector('.experience-dialog video').currentTime`)
  assert(videoTime > 0, 'formal video must advance during the 15-second Experience phase')
  const activeCommands = evidence.commands.filter(command =>
    ['SELECT', 'START', 'STOP'].includes(command.type))
  assert.equal(countAccepted('START'), 1, 'one exhibition may send only one accepted START')
  assert.equal(countAccepted('STOP'), 0, 'successful exhibition playback must not send STOP')
  assert.equal(activeCommands.filter(command => command.type === 'STOP').length, 1,
    'only the rejected audience STOP attempt should be observed')
  pass('The 15-second formal video starts directly after Preparing without duplicate START or STOP')

  await wait(`window.natureTouch.getExhibitionSnapshot().then(s=>s.phase==='AWAIT_COMPLETION')`, 25_000)
  assert.equal((await js(`window.natureTouch.getExperienceSnapshot('mock')`)).experience.state, 'RUNNING')
  await pause(3_000)
  assert.equal((await js(`window.natureTouch.getExhibitionSnapshot()`)).phase, 'AWAIT_COMPLETION')
  assert.equal(countAccepted('START'), 1)
  pass('At 25 seconds media stops but the 30-second device simulation is still locked in AWAIT_COMPLETION')
  await wait(`window.natureTouch.getExhibitionSnapshot().then(s=>s.phase==='COOLDOWN')`, 10_000)
  await wait(`!document.querySelector('.experience-dialog')`)
  const completed = await js(`window.natureTouch.getExperienceSnapshot('mock')`)
  assert.equal(completed.experience.state, 'COMPLETED',
    'Mock device completion, not video ended, must authorize cooldown')
  const cooling = await js(`window.natureTouch.getExhibitionSnapshot()`)
  assert.equal(cooling.phase, 'COOLDOWN')
  assert.equal(await js(`document.querySelector('[data-experience="WIND"]').disabled`), true)
  const cooldownSelect = await dispatch({
    type: 'SELECT', mode: 'mock', experienceId: 'BUBBLE', requestId: 'cooldown-select',
  })
  assert.match(cooldownSelect.error, /in progress or cooling down/i)
  await wait(`window.natureTouch.getExhibitionSnapshot().then(snapshot=>snapshot.phase==='READY')`, 12_000)
  assert.equal(await js(`document.querySelector('[data-experience="WIND"]').disabled`), false)
  assert.equal(countAccepted('START'), 1)
  const cooldownPhases=await js(`window.__phases`)
  const cooldownPhase=cooldownPhases.find(p=>p.phase==='COOLDOWN')
  const readyPhase=cooldownPhases.find(p=>p.phase==='READY'&&p.at>cooldownPhase.at)
  assert(readyPhase.at-cooldownPhase.at>=2900 && readyPhase.at-cooldownPhase.at<4500)
  pass('Only device COMPLETED enters an enforced 3-second cooldown before READY')

  await js(`document.querySelector('[data-experience="WAVE"]').click()`)
  await wait(`!!document.querySelector('[data-preparing="WAVE"]')`)
  assert.equal(countAccepted('START'), 2, 'one START per selected mode')
  const startsBeforeDisconnect = countAccepted('START')
  await js(`window.natureTouch.simulateConnectionLoss()`)
  await wait(`document.querySelector('[data-experience-player]')?.dataset.exhibitionPhase==='FAULT'`)
  assert.equal(await js(`!!document.querySelector('[data-preparing]')`), false)
  await js(`const v=document.querySelector('.experience-dialog video');v.dispatchEvent(new Event('canplay'));v.dispatchEvent(new Event('loadeddata'));true`)
  await pause(10_200)
  assert.equal(await js(`(()=>{const video=document.querySelector('.experience-dialog video');return video.paused&&video.currentTime===0})()`), true,
    'disconnect must stop and clear exhibition media')
  const disconnected = await js(`window.natureTouch.getExperienceSnapshot('mock')`)
  assert.equal(disconnected.experience.state, 'FAULT')
  const recoveredBySelect = await dispatch({
    type: 'SELECT', mode: 'mock', experienceId: 'BUBBLE', requestId: 'disconnect-auto-recovery',
  })
  assert.match(recoveredBySelect.error, /in progress or cooling down/i)
  assert.equal(countAccepted('START'), startsBeforeDisconnect)
  assert.equal((await js(`window.natureTouch.getExperienceSnapshot('mock')`)).experience.state, 'FAULT')
  pass('Disconnect during Waiting cancels its deadline, clears media and ignores late readiness without restarting')

  assert.equal(evidence.errors.length, 0)
  assert.equal(evidence.commands.some(command => command.mode === 'firmware'), false)
  assert.equal(evidence.commands.some(command => command.channel.startsWith('firmware:')), false)
  pass('No firmware command, COM enumeration, port open, or physical hardware access')
}

process.on('uncaughtException', error => finish(error))
process.on('unhandledRejection', error => finish(error))
timeout = setTimeout(() => finish(Error('Electron V3 lifecycle test timed out')), 90_000)

app.once('browser-window-created', (_event, browserWindow) => {
  win = browserWindow
  win.webContents.once('did-finish-load', () => {
    void run().then(() => finish(), error => finish(error))
  })
})

const entry = require.resolve('../desktop/out/main/main.js')
assert.match(readFileSync(entry, 'utf8'), /const EXHIBITION_DEVICE_SOURCE = "mock";/)
require(entry)
