// Actual 15-second native media playback + existing Mock IPC, never COM.
const { app, ipcMain } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const assert = require('node:assert/strict')
const output = resolve(__dirname, '../desktop/out/single-play-check')
mkdirSync(output, { recursive: true })
const evidence = { modes: [], commands: [], errors: [] }
const serial = require('../desktop/node_modules/serialport')
serial.SerialPort.list = async () => { throw Error('COM discovery forbidden') }
serial.SerialPort.prototype.open = () => { throw Error('COM access forbidden') }
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => handle(channel, (...args) => {
  evidence.commands.push(channel)
  return listener(...args)
})
function finish(error) {
  if (error) evidence.errors.push(error.stack)
  evidence.result = error ? 'FAIL' : 'PASS'
  writeFileSync(resolve(output, 'results.json'), JSON.stringify(evidence, null, 2))
  app.exit(error ? 1 : 0)
}
process.on('uncaughtException', finish)
setTimeout(() => finish(Error('Single-play check timed out')), 90000)
app.once('browser-window-created', (_, win) => win.webContents.once('did-finish-load', async () => {
  const js = source => win.webContents.executeJavaScript(source, true)
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  async function wait(source, timeout = 20000) {
    const until = Date.now() + timeout
    do { if (await js(source)) return; await pause(100) } while (Date.now() < until)
    throw Error('Timeout: ' + source)
  }
  const starts = () => evidence.commands.filter(channel => channel === 'experience:start').length
  try {
    win.webContents.setBackgroundThrottling(false)
    // Stable offline media clock even if the operator uses another window.
    await js(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});true`)
    for (const mode of ['WIND','WAVE','BUBBLE']) {
      await wait(`!!document.querySelector('[data-experience="${mode}"]:not(:disabled)')`)
      const count = starts()
      await js(`document.querySelector('[data-experience="${mode}"]').click()`)
      await wait(`document.querySelector('.experience-dialog video')?.currentTime>0`)
      const began = Date.now()
      const info = await js(`(()=>{
        const v=document.querySelector('.experience-dialog video'),a=document.querySelector('.experience-dialog audio');
        window.__finished=false;window.__video=v;window.__audio=a;
        v.addEventListener('ended',()=>window.__finished=true,{once:true});
        return {duration:v.duration,loop:v.loop,controls:v.controls,pauseButton:!!document.querySelector('[aria-label="Pause video"],[aria-label="Play video"]')};
      })()`)
      assert.equal(info.loop,false)
      assert.equal(info.controls,false)
      assert.equal(info.pauseButton,false)
      assert(Math.abs(info.duration-15)<.1)
      await wait(`document.querySelector('.experience-dialog audio')?.currentTime>0`,10000)
      await wait(`window.__finished && !document.querySelector('.experience-dialog')`,22000)
      assert.equal(starts(),count+1)
      assert.equal((await js('window.natureTouch.getExperienceState()')).state,'IDLE')
      assert(await js(`window.__video.paused && window.__audio.paused && document.querySelectorAll('.nature-card').length===3`))
      await pause(500)
      assert.equal(starts(),count+1)
      const row = {mode,...info,observedMs:Date.now()-began,ended:true,returnedHome:true,state:'IDLE',result:'PASS'}
      evidence.modes.push(row)
      console.log(JSON.stringify(row))
    }
    assert(!evidence.commands.some(channel => /^(firmware:(start|connect)|serial:connect)$/.test(channel)))
    finish()
  } catch(error) { finish(error) }
}))
require('../desktop/out/main/main.js')
