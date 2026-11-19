const { app, Menu } = require('electron')
const assert = require('node:assert/strict')
const { existsSync, mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')
const { fileURLToPath } = require('node:url')

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.setPath('userData', mkdtempSync(join(tmpdir(), 'nature-touch-ui-smoke-')))
for (const name of Object.keys(process.env)) {
  if (name.startsWith('NATURE_TOUCH_IPAD_')) delete process.env[name]
}
delete process.env.ELECTRON_RENDERER_URL

const serial = require('../desktop/node_modules/serialport')
let serialAccessAttempts = 0
serial.SerialPort.list = async () => {
  serialAccessAttempts += 1
  throw new Error('Serial enumeration is disabled in this UI smoke test')
}
serial.SerialPort.prototype.open = () => {
  serialAccessAttempts += 1
  throw new Error('Serial access is disabled in this UI smoke test')
}

const evidence = { errors: [], windows: [], serialAccessAttempts: 0 }
const entry = resolve(__dirname, '../desktop/out-exhibition/main/main.js')
const menuTemplates = []
const buildMenu = Menu.buildFromTemplate.bind(Menu)
Menu.buildFromTemplate = template => {
  menuTemplates.push(template.map(item => ({
    label: item.label,
    submenu: item.submenu?.map(subitem => subitem.label) ?? [],
  })))
  return buildMenu(template)
}
let mainWindow
let finished = false
let timeout

function finish(error) {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  evidence.serialAccessAttempts = serialAccessAttempts
  if (error) {
    evidence.errors.push(error.stack ?? String(error))
    process.exitCode = 1
  }
  console.log(JSON.stringify({ result: error ? 'FAIL' : 'PASS', entry, ...evidence }))
  app.exit(error ? 1 : 0)
}

async function waitForRoot() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await mainWindow.webContents.executeJavaScript(
      'Boolean(document.querySelector("#root")?.children.length)',
      true,
    )) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Renderer root did not mount')
}

async function verifyMainWindow() {
  await waitForRoot()
  await new Promise(resolve => setTimeout(resolve, 250))
  const windowInfo = await mainWindow.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('#root')
    const rect = root?.getBoundingClientRect()
    const assets = [...document.querySelectorAll('script[src],link[rel="stylesheet"]')]
      .map(element => element.getAttribute('src') || element.getAttribute('href'))
    return {
      title: document.title,
      bodyText: document.body.innerText.trim().slice(0, 1000),
      rootChildren: root?.children.length ?? 0,
      rootWidth: rect?.width ?? 0,
      rootHeight: rect?.height ?? 0,
      experienceCards: document.querySelectorAll('[data-experience]').length,
      preloadApi: typeof window.natureTouch,
      assets,
    }
  })()`, true)
  const rendererPath = dirname(fileURLToPath(mainWindow.webContents.getURL()))
  const missingAssets = windowInfo.assets.filter(asset =>
    !existsSync(resolve(rendererPath, decodeURIComponent(asset))),
  )
  const menuLabels = menuTemplates.flat()
  evidence.window = {
    visible: mainWindow.isVisible(),
    bounds: mainWindow.getBounds(),
    url: mainWindow.webContents.getURL(),
    ...windowInfo,
    missingAssets,
    menuLabels,
  }

  assert.equal(evidence.window.visible, true, 'Main window should become visible')
  assert.equal(windowInfo.title, 'Nature Touch')
  assert(windowInfo.rootChildren > 0, 'React root should contain the Main UI')
  assert(windowInfo.rootWidth > 100 && windowInfo.rootHeight > 100, 'Main UI should have visible layout bounds')
  assert.equal(windowInfo.experienceCards, 3, 'All three experience cards should render')
  assert.equal(windowInfo.preloadApi, 'object', 'Preload API should be available')
  assert.deepEqual(missingAssets, [], 'Renderer entry assets should resolve from the built output')
  assert(menuLabels.some(item => item.label === '现场负责人'), 'Site manager menu should be present')
  assert.equal(serialAccessAttempts, 0, 'UI startup must not access serial ports')
  finish()
}

app.on('browser-window-created', (_event, window) => {
  const record = { readyToShow: false, finishedLoad: false, url: '' }
  evidence.windows.push(record)
  window.once('ready-to-show', () => { record.readyToShow = true })
  window.webContents.once('did-finish-load', () => {
    record.finishedLoad = true
    record.url = window.webContents.getURL()
    if (!record.url.endsWith('/renderer/index.html')) return
    mainWindow = window
    void verifyMainWindow().catch(finish)
  })
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) {
      record.url = url
      evidence.errors.push(`did-fail-load ${code} ${description} ${url}`)
    }
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    evidence.errors.push(`render-process-gone ${JSON.stringify(details)}`)
  })
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) evidence.errors.push(`renderer console: ${String(message).slice(0, 500)}`)
  })
})

process.on('uncaughtException', finish)
process.on('unhandledRejection', finish)
timeout = setTimeout(() => finish(new Error('Main UI smoke test timed out')), 35_000)

try {
  require(entry)
} catch (error) {
  finish(error)
}
