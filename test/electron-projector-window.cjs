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
delete process.env.ELECTRON_RENDERER_URL
const evidence = { checks: [], projectorIpc: [], errors: [] }
const serial = require('../desktop/node_modules/serialport')
serial.SerialPort.list = async () => { throw Error('COM enumeration forbidden') }
serial.SerialPort.prototype.open = () => { throw Error('COM open forbidden') }
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => handle(channel, (...args) => {
  if (args[0].sender.getURL().includes('projector.html')) {
    evidence.projectorIpc.push(channel)
    assert(['exhibition:get-snapshot','projector:media-report'].includes(channel), 'Projector can only subscribe or report media')
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
const watchdog = setTimeout(() => finish(Error('Projector test timed out')), 45000)
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
      assert.equal(await js(main, `document.querySelectorAll('[data-experience]').length`), 3)
      assert.equal(await js(projection, `document.querySelector('h1').textContent`), 'Standby')
      assert.equal(await js(projection, `document.querySelectorAll('audio, button').length`), 0)
      assert.equal(await js(projection, `typeof window.natureTouch`), 'undefined')
      assert.deepEqual(await js(projection, `Object.keys(window.natureTouchProjector)`), ['subscribeExhibition', 'developmentPreview', 'reportMedia'])
      evidence.checks.push('Main still shows three cards; separate Projector shows Standby with one inactive video and no control API')

      // Confirm live forwarding without issuing any device or experience command.
      projection.webContents.send('exhibition:event', {
        revision: 1, phase: 'STARTING', experienceId: 'WIND', operationId: null, faultCode: null,
      })
      await wait(() => js(projection, `document.querySelector('[data-projector-standby]').dataset.phase==='STARTING'`))
      assert.equal(await js(projection, `document.querySelector('h1').textContent`), 'Standby')
      const before = await js(main, `window.natureTouch.getExhibitionSnapshot()`)
      assert.equal(before.phase, 'READY', 'fixture notification must not affect Main lifecycle')
      evidence.checks.push('Existing lifecycle subscription receives revisions; this step stays Standby in every phase')

      assert.equal(await js(projection, `window.natureTouchProjector.developmentPreview`), false)
      assert(await js(projection, `document.querySelectorAll('video').length===1 && document.querySelector('video').paused && !document.querySelector('video').hasAttribute('src')`))
      evidence.checks.push('Uncorrelated STARTING does not preload or play; production preview is hidden')

      // Force single-display inventory to exercise native window placement and hotplug handling.
      const getDisplays = screen.getAllDisplays.bind(screen)
      const primary = screen.getPrimaryDisplay()
      evidence.displayCount = getDisplays().length
      screen.getAllDisplays = () => [primary]
      screen.emit('display-removed', {}, primary)
      await wait(() => !projection.isFullScreen())
      const a = main.getBounds(), b = projection.getBounds()
      assert(!(a.x < b.x+b.width && b.x < a.x+a.width && a.y < b.y+b.height && b.y < a.y+a.height))
      evidence.checks.push('Single-screen fallback is windowed and does not overlap Main')

      projection.close()
      await wait(() => !projector())
      assert(!main.isDestroyed())
      const open = menus.flatMap(menu => menu.items.flatMap(item => item.submenu?.items ?? []))
        .find(item => item.label === '打开 Projector')
      assert(open)
      open.click(open, main)
      await wait(async () => projector() && await js(projector(), `document.querySelector('[data-projector-standby]')?.dataset.phase==='READY'`))
      projection = projector()
      assert.notEqual(projection, undefined)
      assert.deepEqual(await js(main, `window.natureTouch.getExhibitionSnapshot()`), before)
      assert(evidence.projectorIpc.length >= 2)
      assert(evidence.projectorIpc.every(channel => channel === 'exhibition:get-snapshot'))
      evidence.checks.push('Closing and reopening through Main menu changes no lifecycle state and sends zero START/SELECT/STOP')
      screen.getAllDisplays = getDisplays
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
