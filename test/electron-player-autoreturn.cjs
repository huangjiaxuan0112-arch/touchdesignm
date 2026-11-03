// Exercise actual media and automatic return without accessing physical ports.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
app.setPath('userData', resolve(__dirname, '../desktop/out/player-test-profile'))
const results = []
function finish(error) {
  writeFileSync(resolve(__dirname, '../desktop/out/player-autoreturn-results.json'), JSON.stringify({ results, error: error?.stack ?? null }, null, 2))
  app.exit(error ? 1 : 0)
}
const serial = require('../desktop/node_modules/serialport')
serial.SerialPort.list = async () => []
serial.SerialPort.prototype.open = () => { throw Error('Physical ports forbidden in this test') }
app.commandLine.appendSwitch('disable-background-media-suspend')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
const pause = ms => new Promise(r => setTimeout(r, ms))
const deadline = setTimeout(() => finish(Error('Playback test timed out')), 100000)
async function check(win, mode, browser = false) {
  const js = source => win.webContents.executeJavaScript(source, true)
  async function wait(source, timeout = 20000) {
    const until = Date.now() + timeout
    while (Date.now() < until) { if (await js(source)) return; await pause(100) }
    throw Error('Timeout: ' + source)
  }
  win.webContents.setBackgroundThrottling(false)
  win.show(); win.focus()
  await js(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});true`)
  await wait(`!!document.querySelector('[data-experience="${mode}"]')`)
  if (browser) assert.equal(await js('typeof window.natureTouch'), 'undefined')
  await js(`document.querySelector('[data-experience="${mode}"]').click()`)
  await wait(`document.querySelector('.experience-dialog video')?.currentTime > 0.1`)
  const started = Date.now()
  assert.equal(await js(`document.querySelectorAll('[aria-label="Pause video"], [aria-label="Play video"], [aria-label="Stop experience"]').length`), 0)
  const first = await js(`document.querySelector('.experience-dialog video').currentTime`)
  await pause(1200)
  assert(await js(`document.querySelector('.experience-dialog video').currentTime`) > first + 0.5)
  await pause(11000)
  assert(await js(`!!document.querySelector('.experience-dialog[open]')`), 'Must keep playing until 15 seconds')
  await wait(`!document.querySelector('.experience-dialog')`, 6000)
  assert(Date.now() - started < 17000)
  if (!browser) assert(['IDLE', 'COMPLETED'].includes(await js('(async()=> (await window.natureTouch.getExperienceState()).state)()')))
  console.log('PASS', browser ? 'browser' : 'desktop', mode, 'advances, no pause/stop, returns after 15s')
  results.push({ mode, browser, durationMs: Date.now() - started })
}
app.once('browser-window-created', (_, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      for (const mode of ['WIND', 'WAVE', 'BUBBLE']) await check(win, mode)
      const browser = new BrowserWindow({ webPreferences: { contextIsolation: true, nodeIntegration: false } })
      await browser.loadFile(resolve(__dirname, '../desktop/out/renderer/index.html'))
      await check(browser, 'WIND', true)
      clearTimeout(deadline); finish()
    } catch (error) { console.error(error); finish(error) }
  })
})
require('../desktop/out/main/main.js')
