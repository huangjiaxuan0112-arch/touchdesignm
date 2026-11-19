// Real Electron windows, read-only projector; native serial access is forbidden.
const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron')
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const output = mkdtempSync(join(tmpdir(), 'nature-touch-projector-'))
app.on('before-quit', event => event.preventDefault()) // Let the fixture record window shutdown before app.exit.
app.setPath('userData', join(output, 'profile'))
for (const name of Object.keys(process.env)) {
  if (name.startsWith('NATURE_TOUCH_IPAD_')) delete process.env[name]
}
if (process.env.NT_MEDIA_DEV_URL) process.env.ELECTRON_RENDERER_URL = process.env.NT_MEDIA_DEV_URL
else delete process.env.ELECTRON_RENDERER_URL
process.argv.push('--projector-media-preview')
const evidence = { checks: [], projectorIpc: [], errors: [] }
const serial = require('../desktop/node_modules/serialport')
serial.SerialPort.list = async () => { throw Error('COM enumeration forbidden') }
serial.SerialPort.prototype.open = () => { throw Error('COM open forbidden') }
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => handle(channel, (...args) => {
  if (args[0].sender.getURL().includes('projector.html')) {
    evidence.projectorIpc.push(channel)
    assert.equal(channel, 'exhibition:get-snapshot', 'Projector can only read the lifecycle snapshot')
  }
  assert(!/^(firmware:|serial:)/.test(channel), 'window operations must not access hardware APIs')
  assert(!/experience:(dispatch|select|start|stop)/.test(channel), 'window operations must not send control commands')
  return listener(...args)
})
const menus = []
const buildMenu = Menu.buildFromTemplate.bind(Menu)
Menu.buildFromTemplate = template => { const menu = buildMenu(template); menus.push(menu); return menu }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const js = (win, source) => win.webContents.executeJavaScript(source, true)
async function wait(check) {
  const until = Date.now() + 15000
  while (Date.now() < until) { if (await check()) return; await pause(50) }
  throw Error('Projector check timed out')
}
let finished = false
const watchdog = setTimeout(() => finish(Error('Projector test timed out')), 120000)
function finish(error) {
  if (finished) return
  finished = true
  clearTimeout(watchdog)
  if (error) evidence.errors.push(error.stack ?? String(error))
  writeFileSync(join(output, 'results.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ result: error ? 'FAIL' : 'PASS', evidence: join(output, 'results.json'), ...evidence }))
  app.exit(error ? 1 : 0)
}
const projector = () => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('projector.html'))
app.once('browser-window-created', (_, main) => {
  main.webContents.once('did-finish-load', () => {
    void (async () => {
      await wait(async () => projector() && await js(projector(), `!!document.querySelector('[data-projector-standby][data-phase="READY"]')`))
      let projection = projector()
      evidence.metrics=[]
      projection.webContents.on('console-message', (_event, _level, message) => {
        if(message.startsWith('projector.media ')) { try { evidence.metrics.push(JSON.parse(message.slice('projector.media '.length))) } catch {} }
      })
      await wait(() => js(main, `document.querySelectorAll('[data-experience]').length===3`))
      assert.equal(await js(main, `document.querySelectorAll('[data-experience]').length`), 3)
      assert.equal(await js(projection, `window.natureTouchProjector.developmentPreview`), true)
      assert.equal(await js(projection, `typeof window.natureTouch`), 'undefined')
      assert.equal(await js(projection, `document.querySelectorAll('video').length`), 1)
      await js(projection, `window.__originalVideo=document.querySelector('video')`)
      const before = await js(main, `window.natureTouch.getExhibitionSnapshot()`)
      const records = () => js(projection, `JSON.parse(document.querySelector('[data-media-records]').textContent)`)
      for (const mode of ['WIND', 'WAVE', 'BUBBLE']) {
        await js(projection, `document.querySelector('[data-preload="${mode}"]').click()`)
        await wait(() => js(projection, `document.querySelector('main').dataset.ready==='${mode}'`))
        const metadata = await js(projection, `(() => { const v=document.querySelector('video');return {duration:v.duration,paused:v.paused,time:v.currentTime,loop:v.loop,muted:v.muted,src:v.currentSrc,width:v.videoWidth,height:v.videoHeight} })()`)
        assert.equal(metadata.duration, 25)
        assert.equal(metadata.width, 1920)
        assert.equal(metadata.height, 1080)
        assert(metadata.paused && metadata.time===0 && !metadata.loop && metadata.muted)
        evidence.checks.push({ mode, metadata })
        await js(projection, `document.querySelector('[data-play]').click()`)
        await wait(() => js(projection, `document.querySelector('main').dataset.playing==='true'`))
        const until = Date.now() + 30000
        while (Date.now() < until && !(await records()).some(r => r.event==='ended' && r.mode===mode)) await pause(100)
        const ended=(await records()).find(r => r.event==='ended' && r.mode===mode)
        assert(ended, mode+' must finish once')
        assert.equal(ended.currentTime,25)
        assert(ended.elapsedMs>24000 && ended.elapsedMs<26000)
        await pause(350)
        assert(await js(projection, `document.querySelector('video')===window.__originalVideo && !document.querySelector('video').hasAttribute('src') && document.querySelector('video').paused && !!document.querySelector('h1')`))
      }
      // Stop during loading cancels late ready events; a stopped source cannot restart.
      await js(projection, `document.querySelector('[data-preload="WIND"]').click();document.querySelector('[data-stop]').click()`)
      await pause(500)
      assert(await js(projection, `document.querySelector('main').dataset.ready==='' && !document.querySelector('video').hasAttribute('src')`))
      await js(projection, `document.querySelector('[data-preload="WIND"]').click()`)
      await wait(() => js(projection, `document.querySelector('main').dataset.ready==='WIND'`))
      await js(projection, `document.querySelector('[data-play]').click()`)
      await wait(() => js(projection, `document.querySelector('main').dataset.playing==='true'`))
      await js(projection, `document.querySelector('[data-stop]').click()`)
      await pause(500)
      assert(await js(projection, `document.querySelector('video').paused && !document.querySelector('video').hasAttribute('src')`))
      // Rejected play and a real invalid resource must clear without retry.
      await js(projection, `document.querySelector('[data-preload="WAVE"]').click()`)
      await wait(() => js(projection, `document.querySelector('main').dataset.ready==='WAVE'`))
      await js(projection, `window.__realPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=()=>Promise.reject(new Error('fixture rejection'));document.querySelector('[data-play]').click()`)
      await wait(async () => (await records()).some(r => r.event==='error' && r.stage==='play-request'))
      await js(projection, `HTMLMediaElement.prototype.play=window.__realPlay;document.querySelector('[data-preload="BUBBLE"]').click()`)
      await wait(() => js(projection, `document.querySelector('main').dataset.ready==='BUBBLE'`))
      await js(projection, `const v=document.querySelector('video');v.src='data:video/mp4;base64,AAAA';v.load()`)
      await wait(async () => (await records()).some(r => r.event==='error' && r.stage==='preload'))
      await pause(500)
      assert(await js(projection, `document.querySelector('video').paused && !document.querySelector('video').hasAttribute('src')`))
      evidence.finalRecords=await records()
      assert.deepEqual(await js(main, `window.natureTouch.getExhibitionSnapshot()`), before)
      assert(evidence.projectorIpc.every(channel => channel==='exhibition:get-snapshot'))
      evidence.checks.push('Three complete silent plays; one video; no early playback/loop/retry; stop/load/play failures cleaned; Main unchanged; no hardware/control IPC')
      main.close()
      await wait(() => projection.isDestroyed())
      assert(projection.isDestroyed(), 'closing Main also closes its Projector')
      evidence.checks.push('Normal Main close also closes Projector')
    })().then(() => finish(), finish)
  })
})
process.on('uncaughtException', finish)
process.on('unhandledRejection', finish)
require('../desktop/out/main/main.js')
