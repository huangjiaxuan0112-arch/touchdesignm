// Offline React -> preload -> IPC -> original serial service -> virtual Nano HEX.
const { app, BrowserWindow, ipcMain } = require('electron')
// Test-only foreground fixture: keep Windows occlusion/power saving from
// interrupting a timed natural-completion scenario. Product hide-to-STOP stays.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-background-media-suspend')
const { EventEmitter } = require('node:events')
const { spawn } = require('node:child_process')
const { mkdirSync, writeFileSync, mkdtempSync } = require('node:fs')
const { resolve } = require('node:path')
const { createInterface } = require('node:readline')
const assert = require('node:assert/strict')
const directory = mkdtempSync(resolve(__dirname, '../docs/evidence/exhibition-demo-'))
mkdirSync(directory, { recursive: true })
process.on('uncaughtException', error => {
  writeFileSync(resolve(directory, 'uncaught-error.log'), error.stack || String(error))
  app.exit(1)
})
const evidence = { media: [], modes: [], method: 'Actual React/Electron + compiled HEX in AVR8js; NO COM', checks: {}, writes: [], frames: [] }
const transitionsOnly = process.env.DEMO_CASE === 'transitions'
evidence.case = transitionsOnly ? 'transitions' : 'full'
const worker = spawn('C:/Program Files/nodejs/node.exe', [resolve(__dirname, 'unified-controller/verify.mjs'), '--stdio-bridge', '--start-paused'], {
  cwd: resolve(__dirname, '..'), env: { ...process.env, UNIFIED_RESULTS: resolve(directory, 'virtual-nano') }, windowsHide: true,
})
worker.stderr.on('data', data => require('node:fs').appendFileSync(resolve(directory, 'virtual-stderr.log'), data))
let readyResolve, activePort
const ready = new Promise(resolve => { readyResolve = resolve })
createInterface({ input: worker.stdout }).on('line', text => {
  const row = JSON.parse(text)
  if (row.kind === 'ready') readyResolve()
  if (row.kind === 'frame') {
    evidence.frames.push(row)
    activePort?.emit('data', Buffer.from(JSON.stringify(row.message) + '\n'))
  }
})
// Replace the package implementation only inside this test process, before main
// loads. Native list/open also throw, so a test defect cannot touch real COM.
const serial = require('../desktop/node_modules/serialport/dist/serialport.js')
serial.SerialPort.list = async () => { throw new Error('Native port discovery forbidden in offline test') }
serial.SerialPort.prototype.open = () => { throw new Error('Physical port open forbidden in offline test') }
class VirtualPort extends EventEmitter {
  static async list() { return [{ path: 'VIRTUAL_NANO', manufacturer: 'AVR8js — NOT USB hardware' }] }
  constructor(options) { super(); assert.equal(options.path, 'VIRTUAL_NANO'); this.isOpen = false }
  open(callback) { this.isOpen = true; activePort = this; worker.stdin.write(JSON.stringify({resume:true})+'\n'); callback() }
  close(callback) { this.isOpen = false; activePort = undefined; this.emit('close'); callback() }
  write(data, callback) {
    const line = data.toString().trim(); evidence.writes.push(JSON.parse(line))
    worker.stdin.write(JSON.stringify({ line }) + '\n'); callback()
  }
  drain(callback) { callback() }
}
serial.SerialPort = VirtualPort
const loaded = new Promise(resolve => app.once('browser-window-created', (_event, window) =>
  window.webContents.once('did-finish-load', () => resolve(window))))
const handle = ipcMain.handle.bind(ipcMain); ipcMain.handle=(channel,fn)=>handle(channel,(...args)=>{ if(channel.startsWith('experience:')) { evidence.mockCommands ??= []; evidence.mockCommands.push({channel, at:Date.now()}); } return fn(...args); });
require('../desktop/out/main/main.js')
let window
const js = async source => {
  try { return await window.webContents.executeJavaScript(source, true) }
  catch (error) { throw new Error('Renderer action failed: ' + source, { cause: error }) }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function wait(source, timeout = 20000) {
  const until = Date.now() + timeout
  do { if (await js(source)) return; await pause(100) } while (Date.now() < until)
  throw new Error('Timed out: ' + source)
}
async function click(text) {
  const selector = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)})`
  await wait(`!!(${selector}) && !(${selector}).disabled`)
  await js(`(${selector}).click()`); await pause(150)
}
const quiet = `Array.from(document.querySelectorAll('.experience-dialog video,.experience-dialog audio')).every(e=>e.paused && e.currentTime===0)`
const countStarts = real => real ? evidence.writes.filter(r=>r.type==='START').length : (evidence.mockCommands||[]).filter(r=>r.channel==='experience:start').length
async function back() {
  await wait(`!!document.querySelector('[aria-label="Back to experiences"]:not(:disabled)')`)
  await js(`document.querySelector('[aria-label="Back to experiences"]').click()`)
  await wait(`!document.querySelector('.experience-dialog')`)
  await js(`if(window.__ctx){window.__ctx.close();window.__ctx=null}`)
}
async function open(mode, real) {
  window.show(); window.restore(); window.focus(); window.webContents.focus()
  const before=countStarts(real)
  await wait(`!document.querySelector('[data-experience="${mode}"]').disabled`)
  await js(`document.querySelector('[data-experience="${mode}"]').click();document.querySelector('[data-experience="${mode}"]').click()`)
  await wait(`document.querySelector('.experience-dialog video')?.currentTime>0`)
  await wait(`(window.natureTouch.${real?'getFirmwareState()':'getExperienceState()'}).then(s=>${real?'s.experience':'s'}.state==='RUNNING')`)
  await wait(`!!document.querySelector('[aria-label="Pause video"]:not(:disabled)')`)
  assert.equal(countStarts(real),before+1,'One card intent must issue exactly one START')
  const media=await js(`(()=>{const v=document.querySelector('.experience-dialog video'),a=document.querySelector('.experience-dialog audio');window.__videoRef=v;window.__audioRef=a;window.__wraps=0;let previous=v.currentTime;window.__mediaTick=setInterval(()=>{if(v.currentTime<previous-.5)window.__wraps++;previous=v.currentTime},100);return {video:decodeURI(v.currentSrc),audio:decodeURI(a.currentSrc),duration:v.duration,videoMuted:v.muted,audioMuted:a.muted,audioPaused:a.paused,loop:v.loop}})()`)
  assert.equal(media.videoMuted,true);assert.equal(media.audioMuted,false);assert.equal(media.audioPaused,true);assert.equal(media.loop,true)
  const files={WIND:['东风长3_15秒音视频合成','东风声'],WAVE:['waves-experience','海浪声'],BUBBLE:['bubbles-experience','voicebosch-bubbles']}
  assert.ok(media.video.includes(files[mode][0]));assert.ok(media.audio.includes(files[mode][1]))
  return {mode,real,...media}
}
async function captureAudio(row) {
  await wait(`document.querySelector('.experience-dialog audio')?.currentTime>.15`,12000)
  // AVR8js executes virtual time, not a realtime electrical clock. Check native
  // A/V cue alignment here; compiled UART marker times are checked separately.
  row.audioStartElapsed=await js(row.real ? `(()=>{const v=document.querySelector('.experience-dialog video'),a=document.querySelector('.experience-dialog audio');return (v.currentTime-a.currentTime)*1000})()` : `window.natureTouch.getExperienceState().then(s=>s.elapsedMs-document.querySelector('.experience-dialog audio').currentTime*1000)`)
  const expected=row.mode==='BUBBLE'?4420:5000
  assert.ok(Math.abs(row.audioStartElapsed-expected)<650,'Audio cue alignment: '+row.audioStartElapsed)
  row.rms=await js(`(async()=>{const a=document.querySelector('.experience-dialog audio');const ctx=new AudioContext();await ctx.resume();const src=ctx.createMediaElementSource(a),an=ctx.createAnalyser();src.connect(an);an.connect(ctx.destination);window.__ctx=ctx;const b=new Float32Array(an.fftSize);let rms=0;for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,70));an.getFloatTimeDomainData(b);rms=Math.max(rms,Math.sqrt(b.reduce((s,x)=>s+x*x,0)/b.length));}return rms})()`)
  assert.ok(row.rms>1e-6,'No decoded audible audio')
}
async function cleanupProbe() {
  await js(`clearInterval(window.__mediaTick)`)
}
;(async()=>{
  try {
    await ready; window=await loaded
    window.webContents.setBackgroundThrottling(false)
    await wait(`!!document.querySelector('[data-experience="WIND"]')`)
    await js(`window.__faults=[];window.__visibility=[];document.addEventListener('visibilitychange',()=>window.__visibility.push({at:Date.now(),state:document.visibilityState}));Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});window.addEventListener('error',e=>window.__faults.push(e.message));window.addEventListener('unhandledrejection',e=>window.__faults.push(String(e.reason)))`)
    // Local mock: all three full-length natural runs with native media decoding.
    for(const [mode,duration]of transitionsOnly ? [] : [['WIND',24000],['WAVE',25000],['BUBBLE',27420]]){
      const row=await open(mode,false);await captureAudio(row)
      await wait(`window.natureTouch.getExperienceState().then(s=>s.state==='COMPLETED')`,35000)
      await wait(quiet)
      row.final=await js('window.natureTouch.getExperienceState()');assert.equal(row.final.elapsedMs,duration)
      row.videoWraps=await js('window.__wraps');assert.ok(row.videoWraps>=1)
      const starts=countStarts(false);await pause(500);assert.equal(countStarts(false),starts)
      evidence.modes.push(row);console.log('PASS mock '+mode+' '+duration+'ms');await cleanupProbe();await back()
    }
    if (!transitionsOnly) evidence.checks.mockThreeNaturalRuns='PASS'
    await open('WIND',false)
    await js(`document.querySelector('[aria-label="Pause video"]').click()`)
    await wait(quiet);await wait(`window.natureTouch.getExperienceState().then(s=>s.state==='IDLE')`)
    const starts=countStarts(false)
    await js(`document.querySelector('[aria-label="Play video"]').click()`)
    await wait(`document.querySelector('.experience-dialog video').currentTime>0`)
    assert.equal(countStarts(false),starts+1)
    await js(`document.querySelector('[aria-label="Stop experience"]').click()`);await wait(quiet)
    await wait(`window.natureTouch.getExperienceState().then(s=>s.state==='IDLE')`)
    await cleanupProbe();await back();evidence.checks.pauseExplicitRestartStop='PASS'
    const mockFaultMedia=await open('WAVE',false);await captureAudio(mockFaultMedia)
    await js(`window.natureTouch.simulateExperienceFault('DEMO_FAULT')`);await wait(quiet)
    assert.ok(await js(`document.querySelector('.experience-player__error').textContent.includes('DEMO_FAULT')`))
    await cleanupProbe();await back();evidence.checks.mockFaultCleanup='PASS'
    // Unchanged real application serial path, backed only by compiled virtual Nano.
    await js(`{document.querySelector('.device-panel').open=true;const s=document.querySelector('[aria-label="Device mode"]');s.value='real';s.dispatchEvent(new Event('change',{bubbles:true}))}`)
    await wait(`!!document.querySelector('option[value="VIRTUAL_NANO"]')`)
    await js(`{const s=document.querySelector('[aria-label="COM port"]');s.value='VIRTUAL_NANO';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.device-connection input[type=checkbox]').click()}`)
    await click('Connect + IDENTIFY');await wait('window.natureTouch.getFirmwareState().then(s=>s.identified)')
    await wait(`!document.querySelector('[aria-label="Confirm simulation firmware"]').disabled`);await js(`document.querySelector('[aria-label="Confirm simulation firmware"]').click()`);await click('Arm Real Arduino Simulation Test')
    for(const [mode,duration]of transitionsOnly ? [] : [['WIND',24000],['WAVE',25000],['BUBBLE',27420]]){
      const row=await open(mode,true);await captureAudio(row)
      await wait(`window.natureTouch.getFirmwareState().then(s=>s.experience.state==='COMPLETED')`,65000)
      await wait(quiet);row.final=await js('window.natureTouch.getFirmwareState()')
      assert.equal(row.final.experience.elapsedMs,duration);assert.equal(row.final.hardwareOutputsEnabled,false)
      const cue=mode==='BUBBLE'?4420:5000
      assert.ok(evidence.frames.some(f=>f.message.name==='MARKER'&&f.message.operationId===row.final.experience.operationId&&f.message.atMs===cue&&f.message.text.includes('AUDIO')))
      evidence.modes.push(row);console.log('PASS virtual Nano '+mode+' '+duration+'ms');await cleanupProbe();await back()
    }
    if (!transitionsOnly) evidence.checks.virtualNanoThreeNaturalRuns='PASS'
    await open('WIND',true);await js(`document.querySelector('[aria-label="Stop experience"]').click()`);await wait(quiet)
    await wait(`window.natureTouch.getFirmwareState().then(s=>s.experience.state==='IDLE')`)
    await cleanupProbe();await back();evidence.checks.virtualStop='PASS'
    const faultMedia=await open('WAVE',true);await captureAudio(faultMedia)
    worker.stdin.write(JSON.stringify({fault:true})+'\n')
    await wait(`window.natureTouch.getFirmwareState().then(s=>s.experience.state==='FAULT')`);await wait(quiet)
    const faultStarts=countStarts(true);await pause(600);assert.equal(countStarts(true),faultStarts)
    await cleanupProbe();await back();evidence.checks.virtualFaultCleanup='PASS'
    await js(`window.natureTouch.recoverFirmware('demorecover',true,true)`)
    await js(`window.natureTouch.armFirmwareSimulationTest(true,true)`)
    const disconnectedMedia=await open('BUBBLE',true);await captureAudio(disconnectedMedia)
    activePort.close(()=>{})
    await wait(`window.natureTouch.getFirmwareState().then(s=>s.connectionState==='faulted')`);await wait(quiet)
    const disconnectedStarts=countStarts(true);await pause(800);assert.equal(countStarts(true),disconnectedStarts)
    assert.equal(activePort,undefined);await cleanupProbe();await back();evidence.checks.usbDisconnectMediaCleanupNoRestart='PASS'
    assert.deepEqual(await js('window.__faults'),[])
    evidence.result='PASS'
  }catch(error){evidence.result='FAIL';evidence.error=error.stack||String(error)}
  finally{
    if(window&&!window.isDestroyed()){
      evidence.ui=await js(`({text:document.body.innerText,errors:window.__faults,visibility:window.__visibility})`).catch(()=>null)
      await js('window.natureTouch.disconnectFirmware()').catch(()=>{})
    }
    worker.stdin.end();await new Promise(resolve=>worker.once('exit',resolve))
    writeFileSync(resolve(directory,'results.json'),JSON.stringify(evidence,null,2)+'\n')
    console.log(JSON.stringify({result:evidence.result,checks:evidence.checks,modes:evidence.modes.map(r=>({mode:r.mode,real:r.real,cue:r.audioStartElapsed,rms:r.rms})),error:evidence.error,directory}))
    for(const w of BrowserWindow.getAllWindows())w.destroy();app.exit(evidence.result==='PASS'?0:1)
  }
})()

