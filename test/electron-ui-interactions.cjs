const { app, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve } = require('node:path')

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-background-media-suspend')

const output = mkdtempSync(resolve(tmpdir(), 'nature-touch-v3-ui-'))
const evidence = { checks: [], commands: [], errors: [] }
const serial = require('../desktop/node_modules/serialport')
serial.SerialPort.list = async () => { throw Error('COM discovery forbidden by V3 UI test') }
serial.SerialPort.prototype.open = () => { throw Error('COM access forbidden by V3 UI test') }

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

  await js(`document.querySelector('[data-experience="WIND"]').click()`)
  await wait(`!!document.querySelector('.experience-dialog video')`)
  await wait(`document.querySelector('[data-experience-player]')?.dataset.exhibitionPhase==='WAITING'`)
  assert.equal(countAccepted('SELECT'), 1)
  assert.equal(countAccepted('START'), 1)
  assert.equal(await js(`!!document.querySelector('.experience-dialog button, .experience-dialog [role="button"]')`), false)
  assert.equal(await js(`document.querySelector('.experience-dialog video').controls`), false)
  assert.equal(await js(`document.querySelector('.experience-dialog video').loop`), false)
  assert.equal(await js(`document.querySelector('.experience-dialog video').paused`), true,
    'formal video must remain paused during Waiting')
  const operation = (await js(`window.natureTouch.getExhibitionSnapshot()`)).operationId
  const duringWaiting = await js(`window.natureTouch.getExperienceSnapshot('mock')`)
  assert.equal(duringWaiting.experience.state, 'RUNNING')
  const audienceStop = await dispatch({
    type: 'STOP', mode: 'mock', requestId: 'audience-stop', operationId: operation,
  })
  assert.match(audienceStop.error, /Audience STOP is unavailable during an exhibition experience/)
  const duplicateStart = await dispatch({
    type: 'START', mode: 'mock', requestId: 'duplicate-start', operationId: `${operation}-duplicate`,
  })
  assert.match(duplicateStart.error, /cannot START during WAITING/i)
  const alternateSelect = await dispatch({
    type: 'SELECT', mode: 'mock', experienceId: 'WAVE', requestId: 'audience-switch',
  })
  assert.match(alternateSelect.error, /in progress or cooling down/i)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' })
  await pause(200)
  assert.equal(await js(`!!document.querySelector('.experience-dialog[open]')`), true,
    'Escape must not close the active experience')
  pass('Waiting locks audience controls and rejects direct STOP, START, SELECT, and Escape')

  await wait(`document.querySelector('[data-experience-player]')?.dataset.exhibitionPhase==='EXPERIENCE'`, 8_000)
  await wait(`!document.querySelector('.experience-dialog video').paused`)
  await pause(350)
  const videoTime = await js(`document.querySelector('.experience-dialog video').currentTime`)
  assert(videoTime > 0, 'formal video must advance after the 5-second Waiting period')
  const activeCommands = evidence.commands.filter(command =>
    ['SELECT', 'START', 'STOP'].includes(command.type))
  assert.equal(countAccepted('START'), 1, 'one exhibition may send only one accepted START')
  assert.equal(countAccepted('STOP'), 0, 'successful exhibition playback must not send STOP')
  assert.equal(activeCommands.filter(command => command.type === 'STOP').length, 1,
    'only the rejected audience STOP attempt should be observed')
  pass('The 15-second formal video starts after Waiting without duplicate START or STOP')

  await wait(`document.querySelector('[data-experience-player]')?.dataset.exhibitionPhase==='COOLDOWN'`, 25_000)
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
  pass('Only device COMPLETED enters an enforced 8-second cooldown before READY')

  await js(`document.querySelector('[data-experience="WAVE"]').click()`)
  await wait(`document.querySelector('[data-experience-player]')?.dataset.exhibitionPhase==='EXPERIENCE'`, 8_000)
  await wait(`!document.querySelector('.experience-dialog video').paused`)
  const startsBeforeDisconnect = countAccepted('START')
  await js(`window.natureTouch.simulateConnectionLoss()`)
  await wait(`document.querySelector('[data-experience-player]')?.dataset.exhibitionPhase==='FAULT'`)
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
  pass('Disconnect clears active media and cannot auto-recover the exhibition')

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

require('../desktop/out/main/main.js')
