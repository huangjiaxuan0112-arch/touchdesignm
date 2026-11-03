// Real Electron UI with Mock services. Serial access is blocked before Main loads.
const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-background-media-suspend')

const output = resolve(process.env.NATURE_TOUCH_UI_RESULTS_DIR || resolve(__dirname, '../desktop/out/interaction-check'))
mkdirSync(output, { recursive: true })
const evidence = { checks: [], commands: [], overlaps: [], errors: [] }
const countedCommands = new Map()
const serial = require('../desktop/node_modules/serialport')
serial.SerialPort.list = async () => { throw Error('COM discovery forbidden by UI test') }
serial.SerialPort.prototype.open = () => { throw Error('COM access forbidden by UI test') }

let rejectStop = false
let holdStartResponse = false
let clampPlayerDuration = false
let releaseStartResponse
let startResponseHeld
const startResponseIsHeld = new Promise(resolve => { startResponseHeld = resolve })
const originalHandle = ipcMain.handle.bind(ipcMain)

function commandFrom(channel, args) {
  if (channel === 'experience:dispatch' && args[1] && typeof args[1] === 'object') return args[1]
  const legacy = {
    'experience:select': ['SELECT', 'mock'],
    'experience:start': ['START', 'mock'],
    'experience:stop': ['STOP', 'mock'],
    'firmware:select': ['SELECT', 'firmware'],
    'firmware:start': ['START', 'firmware'],
    'firmware:stop': ['STOP', 'firmware'],
  }[channel]
  if (!legacy || !args[1] || typeof args[1] !== 'object') return undefined
  return {
    type: legacy[0],
    mode: legacy[1],
    requestId: args[1].requestId,
    operationId: args[1].operationId,
  }
}

ipcMain.handle = (channel, listener) => originalHandle(channel, async (...args) => {
  const command = commandFrom(channel, args)
  if (command && ['SELECT', 'START', 'STOP'].includes(command.type)) {
    const key = `${command.mode}:${command.type}:${command.requestId}`
    if (!countedCommands.has(key)) {
      countedCommands.set(key, { ...command, channel })
      evidence.commands.push({ ...command, channel })
    }
  }
  if (channel === 'experience:dispatch' && args[1]?.type === 'STOP' && rejectStop) {
    throw Error('Injected STOP failure')
  }
  let result = await listener(...args)
  if (channel === 'experience:dispatch' && args[1]?.type === 'STATUS' && clampPlayerDuration) {
    clampPlayerDuration = false
    result = { ...result, snapshot: { ...result.snapshot, durationMs: 1 } }
  }
  if (channel === 'experience:dispatch' && args[1]?.type === 'START' && holdStartResponse) {
    holdStartResponse = false
    startResponseHeld()
    await new Promise(resolve => { releaseStartResponse = resolve })
  }
  return result
})

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const count = (type, mode = 'mock') =>
  [...countedCommands.values()].filter(command => command.type === type && command.mode === mode).length
function pass(name) { evidence.checks.push({ name, result: 'PASS' }) }
function finish(code) {
  writeFileSync(resolve(output, 'results.json'), JSON.stringify(evidence, null, 2))
  app.exit(code)
}

let win
let finished = false
const js = source => win.webContents.executeJavaScript(source, true)
async function wait(source, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (await js(source)) return } catch {}
    await pause(100)
  }
  throw Error(`Timed out: ${source}`)
}
async function clickCard(id) {
  await wait(`!!document.querySelector('[data-experience="${id}"]:not(:disabled)')`)
  await js(`document.querySelector('[data-experience="${id}"]').click()`)
}
async function returnHome() {
  await js(`(()=>{window.__lastMedia=[...document.querySelectorAll('.experience-dialog video,.experience-dialog audio')];document.querySelector('[aria-label="Back to experiences"]').click()})()`)
  await wait(`!document.querySelector('.experience-dialog')`)
}
function mediaPlaying() {
  return `!document.querySelector('.experience-dialog video')?.paused&&!!document.querySelector('.experience-dialog audio')&&!document.querySelector('.experience-dialog audio').paused`
}

process.on('uncaughtException', error => {
  evidence.errors.push(error.stack)
  if (!finished) { finished = true; finish(1) }
})

app.once('browser-window-created', (_event, browserWindow) => {
  win = browserWindow
  win.webContents.setBackgroundThrottling(false)
  win.webContents.once('did-finish-load', async () => {
    try {
      win.setContentSize(1920, 1248)
      win.show()
      win.focus()
      win.webContents.focus()
      await wait(`!!document.querySelector('[data-experience="WAVE"]')`)
      const posters = await js(`([...document.querySelectorAll('.nature-card__poster')].length===3 && [...document.querySelectorAll('.nature-card__poster')].every(image=>image.complete&&image.naturalWidth>0))`)
      assert.equal(posters, true, 'home should show the three existing posters')
      assert.equal(await js(`!!document.querySelector('[aria-label="Device mode"]')`), false,
        'the exhibition UI must not expose firmware mode or ARM controls')
      assert.equal(await js(`document.body.innerText.includes('Arm Real Arduino Simulation Test')`), false)
      assert.equal(await js(`[...document.querySelectorAll('.nature-card video')].filter(video=>!video.paused).length`), 0)
      pass('Home displays posters; previews are available without autoplay')
      await js(`window.natureTouch.logMediaError('video-load-failed')`)
      const logPath = resolve(app.getPath('userData'), 'logs', 'app.jsonl')
      const logDeadline = Date.now() + 5000
      let mediaErrorRow
      while (Date.now() < logDeadline) {
        try {
          mediaErrorRow = readFileSync(logPath, 'utf8').split('\n')
            .filter(Boolean).map(line => JSON.parse(line))
            .find(row => row.event === 'media.error' && row.reason === 'video-load-failed')
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
        if (mediaErrorRow) break
        await pause(50)
      }
      assert.ok(mediaErrorRow, 'media errors should be written to the Electron userData log')
      assert.match(mediaErrorRow.appCommit, /^[0-9a-f]{40}$/)
      assert.equal(mediaErrorRow.hardwareConfigVersion, 'UNVERSIONED')
      pass('Media error is persisted with build and hardware configuration identity')

      const selectsBeforeCancel = count('SELECT'), startsBeforeCancel = count('START'), stopsBeforeCancel = count('STOP')
      await js(`(()=>{
        window.__holdMediaReadiness=new MutationObserver(()=>{
          for(const media of document.querySelectorAll('.experience-dialog video,.experience-dialog audio')){
            if(media.__readinessHeld)continue;
            Object.defineProperty(media,'readyState',{configurable:true,get:()=>0});
            media.__readinessHeld=true;
          }
        });
        window.__holdMediaReadiness.observe(document.documentElement,{childList:true,subtree:true});
      })()`)
      await clickCard('WAVE')
      await wait(`!!document.querySelector('.experience-dialog video')&&!!document.querySelector('.experience-dialog audio')&&document.querySelector('[data-experience-player]')?.dataset.playbackPhase==='preparing'`)
      assert(await js(`[...document.querySelectorAll('.experience-dialog video,.experience-dialog audio')].every(element=>element.readyState===0)`),
        'media readiness must remain pending until the user exits')
      await returnHome()
      await js(`window.__holdMediaReadiness.disconnect()`)
      await pause(300)
      assert.equal(count('SELECT'), selectsBeforeCancel + 1, 'loading cancellation follows one SELECT')
      assert.equal(count('START'), startsBeforeCancel, 'exiting during media preparation must not send START')
      assert.equal(count('STOP'), stopsBeforeCancel, 'media preparation without an operation must not send STOP')
      pass('Exit during media preparation cancels readiness and cannot trigger a late START')

      const baseSelects = count('SELECT'), baseStarts = count('START'), baseStops = count('STOP')
      clampPlayerDuration = true
      await js(`(()=>{const card=document.querySelector('[data-experience="WIND"]');card.click();card.click();card.click()})()`)
      await wait(`!!document.querySelector('.experience-dialog video')&&!!document.querySelector('.experience-dialog audio')`)
      await wait(`document.querySelector('.experience-dialog video').readyState>=3&&document.querySelector('.experience-dialog audio').readyState>=3`)
      await wait(`document.querySelector('[data-experience-player]')?.dataset.playbackPhase==='playing'`)
      await pause(250)
      assert.equal(count('SELECT'), baseSelects + 1, 'repeated card clicks must issue one SELECT')
      assert.equal(count('START'), baseStarts + 1, 'repeated card clicks must issue one START')
      assert.equal(count('STOP'), baseStops, 'the player must not end the device operation from its local duration')
      assert.equal((await js(`window.natureTouch.getExperienceSnapshot('mock')`)).experience.state, 'RUNNING',
        'device state must remain authoritative when media duration differs')
      assert(await js(mediaPlaying()), 'WIND video and MP3 must actually play')
      assert(await js(`document.querySelector('.experience-dialog video').loop&&document.querySelector('.experience-dialog video').muted`))
      pass('Repeated clicks START once; media plays and local duration cannot stop device')

      const startsBeforeBufferRecovery = count('START')
      await js(`(()=>{const audio=document.querySelector('.experience-dialog audio');audio.pause();audio.dispatchEvent(new Event('waiting'))})()`)
      await wait(`document.querySelector('[data-experience-player]')?.dataset.playbackPhase==='buffering'&&document.querySelector('.experience-dialog video').paused`)
      await js(`document.querySelector('.experience-dialog audio').play()`)
      await wait(`!document.querySelector('.experience-dialog audio').paused&&document.querySelector('[data-experience-player]')?.dataset.playbackPhase==='playing'`)
      assert.equal(await js(`document.querySelector('.experience-dialog video').paused`), false,
        'audio buffering recovery must resume the paused video')
      assert.equal(count('START'), startsBeforeBufferRecovery, 'buffering recovery must not issue another START')
      pass('Audio buffering recovery resumes video without another device START')

      rejectStop = true
      await js(`document.querySelector('[aria-label="Back to experiences"]').click()`)
      await wait(`!!document.querySelector('.experience-player__error')`)
      assert(await js(`!!document.querySelector('.experience-dialog[open]')`), 'failed STOP must retain the player')
      assert.equal((await js(`window.natureTouch.getExperienceSnapshot('mock')`)).experience.state, 'RUNNING')
      rejectStop = false
      const stopsBeforeRetry = count('STOP')
      await returnHome()
      assert.equal(count('STOP'), stopsBeforeRetry + 1, 'retry should submit one STOP')
      assert.equal((await js(`window.natureTouch.getExperienceSnapshot('mock')`)).experience.state, 'IDLE')
      assert(await js(`window.__lastMedia.every(element=>element.paused&&element.currentTime===0)`), 'STOP must clean both media elements')
      pass('STOP failure is surfaced; retry confirms STOP, clears media and returns home')

      const startsBeforeLate = count('START'), stopsBeforeLate = count('STOP')
      holdStartResponse = true
      await clickCard('WAVE')
      await startResponseIsHeld
      assert.equal((await js(`window.natureTouch.getExperienceSnapshot('mock')`)).experience.state, 'RUNNING')
      await returnHome()
      releaseStartResponse()
      await pause(500)
      assert.equal(count('START'), startsBeforeLate + 1, 'late START response must not dispatch another START')
      assert.equal(count('STOP'), stopsBeforeLate + 2,
        'Back and the late START confirmation each submit a STOP intent for the same operation')
      const lateStopIntents = [...countedCommands.values()]
        .filter(command => command.type === 'STOP' && command.mode === 'mock')
        .slice(stopsBeforeLate)
      assert.equal(new Set(lateStopIntents.map(command => command.operationId)).size, 1,
        'late STOP intents must remain scoped to the same operation')
      assert.equal((await js(`window.natureTouch.getExperienceSnapshot('mock')`)).experience.state, 'IDLE')
      pass('Exit during a delayed START confirmation remains IDLE; repeated STOP intent is idempotent')

      const startsBeforeFault = count('START'), stopsBeforeFault = count('STOP')
      await clickCard('BUBBLE')
      await wait(`document.querySelector('[data-experience-player]')?.dataset.playbackPhase==='playing'`)
      await js(`window.natureTouch.simulateExperienceFault('UI_TEST_FAULT')`)
      await wait(`document.querySelector('[data-experience-player]')?.dataset.playbackPhase==='error'`)
      assert(await js(`[...document.querySelectorAll('.experience-dialog video,.experience-dialog audio')].every(element=>element.paused&&element.currentTime===0)`))
      await returnHome()
      assert.equal(count('START'), startsBeforeFault + 1)
      assert.equal(count('STOP'), stopsBeforeFault, 'FAULT navigation must not claim device STOP')
      assert.equal((await js(`window.natureTouch.getExperienceSnapshot('mock')`)).experience.state, 'FAULT')
      pass('FAULT clears media, preserves FAULT, and allows navigation without STOP/START')

      const startsBeforeRecovery = count('START')
      await clickCard('WAVE')
      await wait(`document.querySelector('[data-experience-player]')?.dataset.playbackPhase==='playing'`)
      assert.equal(count('START'), startsBeforeRecovery + 1, 'explicit card selection may recover Mock once')
      const stopsBeforeDisconnect = count('STOP')
      await js(`window.natureTouch.simulateConnectionLoss()`)
      await wait(`document.querySelector('[data-experience-player]')?.dataset.playbackPhase==='error'`)
      await returnHome()
      assert.equal(count('STOP'), stopsBeforeDisconnect, 'disconnect navigation must not claim device STOP')
      assert.equal((await js(`window.natureTouch.getExperienceSnapshot('mock')`)).experience.state, 'FAULT')
      assert.equal(count('START'), startsBeforeRecovery + 1, 'disconnect must not auto-restart')
      pass('Mock disconnect cleans media and does not auto-recover or restart')

      assert(!evidence.commands.some(command => command.mode === 'firmware' || command.channel.startsWith('firmware:')))
      assert(!evidence.errors.length)
      pass('No firmware START, serial connect, or physical-port access')
      finished = true
      finish(0)
    } catch (error) {
      evidence.errors.push(error.stack)
      evidence.failureUi = await js(`({dialog:!!document.querySelector('.experience-dialog'),phase:document.querySelector('[data-experience-player]')?.dataset.playbackPhase,error:document.querySelector('.experience-player__error')?.textContent})`).catch(() => null)
      if (!finished) { finished = true; finish(1) }
    }
  })
})

require('../desktop/out/main/main.js')
setTimeout(() => {
  if (win) return
  win = BrowserWindow.getAllWindows()[0]
  if (win) win.webContents.once('did-finish-load', () => {})
}, 0)
setTimeout(() => {
  if (!finished) {
    evidence.errors.push('Electron UI interaction test timed out')
    finished = true
    finish(1)
  }
}, 150_000)
