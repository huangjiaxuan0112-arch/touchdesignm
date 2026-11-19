const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const scenario = process.argv.find(a => a.startsWith('--scenario='))?.split('=')[1] ?? 'happy'
const output = mkdtempSync(join(tmpdir(), 'nature-touch-projector-link-'))
app.setPath('userData', join(output, 'profile'))
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-background-media-suspend')
for (const name of Object.keys(process.env)) if (name.startsWith('NATURE_TOUCH_IPAD_')) delete process.env[name]
delete process.env.ELECTRON_RENDERER_URL
const evidence = { scenario, hardwareAccessAttempts: 0, checks: [], commands: [], reports: [], media: [], errors: [] }
const serial = require('../desktop/node_modules/serialport')
const forbidden = () => { evidence.hardwareAccessAttempts++; throw Error('COM access forbidden') }
serial.SerialPort.list = forbidden
serial.SerialPort.prototype.open = forbidden
serial.SerialPort.prototype.write = forbidden
let holdReady = scenario === 'happy' || scenario === 'closed-preload'
let releaseReady
let heldReport
const gate = new Promise(resolve => { releaseReady = resolve })
const handle = ipcMain.handle.bind(ipcMain)
const handlers = {}
ipcMain.handle = (channel, listener) => {
  handlers[channel] = listener
  handle(channel, async (...args) => {
    if (args[0].sender.getURL().includes('projector.html')) {
      assert(['exhibition:get-snapshot','projector:media-report'].includes(channel), 'Projector never controls devices')
    }
    assert(!/^(firmware:|serial:)/.test(channel), 'No hardware APIs')
    if (channel === 'projector:media-report') {
      if (args[1].event === 'ready' && holdReady && !heldReport) { heldReport = args[1]; await gate }
      const accepted = await listener(...args)
      evidence.reports.push({ ...args[1], accepted, receivedAt:Date.now() })
      return accepted
    }
    const command = channel === 'experience:dispatch' ? args[1] : null
    try {
      const result=await listener(...args)
      if(command) evidence.commands.push({...command,accepted:result?.accepted??result?.acknowledgement?.accepted??false})
      return result
    } catch(error) {
      if(command) evidence.commands.push({...command,accepted:false,error:error.message})
      throw error
    }
  })
}
const menus=[]
const buildMenu=Menu.buildFromTemplate.bind(Menu)
Menu.buildFromTemplate=template=>{const menu=buildMenu(template);menus.push(menu);return menu}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const js=(win,source)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Renderer JS timed out: '+source)),8000)
  win.webContents.executeJavaScript(source,true).then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)})
})
const projector=()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('projector.html'))
async function wait(check,timeout=15000) {
  const until=Date.now()+timeout
  while(Date.now()<until){if(await check())return;await pause(40)}
  throw Error('Timed out: '+check.toString())
}
let finished=false
const watchdog=setTimeout(()=>finish(Error('Link test watchdog')),180000)
function finish(error) {
  if(finished)return;finished=true;clearTimeout(watchdog)
  if(!error && evidence.hardwareAccessAttempts) error=Error('Native serial API attempted')
  if(error)evidence.errors.push(error.stack??String(error))
  writeFileSync(join(output,'results.json'),JSON.stringify(evidence,null,2))
  const evidenceDirectory = process.env.NATURE_TOUCH_TEST_RESULTS || join(__dirname,'../.validation/10s-preparing-25s-projector')
  mkdirSync(evidenceDirectory,{recursive:true})
  writeFileSync(join(evidenceDirectory,'link-'+scenario+'-results.json'),JSON.stringify(evidence,null,2))
  console.log(JSON.stringify({result:error?'FAIL':'PASS',evidence:join(output,'results.json'),scenario,checks:evidence.checks,errors:evidence.errors}))
  app.exit(error?1:0)
}
function observe(win) {
  win.webContents.setBackgroundThrottling(false)
  win.webContents.on('console-message',(_event,_level,message)=>{
    if(message.startsWith('projector.media '))try{evidence.media.push(JSON.parse(message.slice('projector.media '.length)))}catch{}
  })
}
async function instrument(projection) {
  await js(projection,String.raw`window.__video=document.querySelector('video');window.__playCalls=0;window.__loadCalls=0;
    window.__realPlay=HTMLMediaElement.prototype.play;window.__realLoad=HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.play=function(){if(this===window.__video)window.__playCalls++;return window.__realPlay.call(this)};
    HTMLMediaElement.prototype.load=function(){if(this===window.__video && this.hasAttribute('src'))window.__loadCalls++;return window.__realLoad.call(this)};true`)
}
async function run(main) {
  await wait(()=>projector()&&js(projector(),`document.querySelector('main')?.dataset.phase==='READY'`))
  let projection=projector()
  await instrument(projection)
  await js(main,`window.__phases=[];window.__deviceEvents=[];window.natureTouch.subscribeExhibition(s=>window.__phases.push({...s,at:Date.now()}));window.natureTouch.subscribeExperience('mock',e=>window.__deviceEvents.push(e));true`)
  const snapshot=()=>js(main,`window.natureTouch.getExhibitionSnapshot()`)
  const device=()=>js(main,`window.natureTouch.getExperienceSnapshot('mock').then(s=>s.experience)`)
  const phase=async value=>{await wait(async()=> (await snapshot()).phase===value,40000)}
  const choose=async mode=>{await js(main,`document.querySelector('[data-experience="${mode}"]').click()`)}
  if(scenario==='reopen-ready') { evidence.checks.push('Ready window reopen fixture') }
  else if(scenario==='happy') {
    for(const mode of ['WIND','WAVE','BUBBLE']) {
      await js(projection,`window.__playCalls=0;window.__loadCalls=0;true`)
      await choose(mode)
      if(mode==='WIND') {
        await wait(()=>!!heldReport)
        const pending=await snapshot()
        assert.equal(pending.phase,'STARTING');assert.equal((await device()).state,'IDLE')
        assert.equal(await js(projection,`document.querySelector('video').paused`),true)
        await pause(300)
        assert.equal((await device()).state,'IDLE')
        const stale={...heldReport,operationId:'old-round'}
        assert.equal(await js(projection,`window.natureTouchProjector.reportMedia(${JSON.stringify(stale)})`),false)
        await js(main,`window.__duplicate=window.natureTouch.dispatchExperienceCommand({type:'START',mode:'mock',operationId:'${pending.operationId}',requestId:'dup-pending'}).catch(e=>({error:String(e)}));true`)
        holdReady=false;releaseReady()
        evidence.checks.push('Preload alone stays STARTING and IDLE; stale ready ignored; duplicate pending START shares gate')
      }
      await phase('WAITING')
      const ack=await snapshot(),op=ack.operationId
      await wait(()=>evidence.media.some(r=>r.event==='playing'&&r.operationId===op))
      const initial=await js(projection,`({src:document.querySelector('video').currentSrc,play:window.__playCalls,load:window.__loadCalls,time:document.querySelector('video').currentTime})`)
      assert.equal(initial.play,1);assert.equal(initial.load,1)
      assert(initial.src.includes(mode.toLowerCase()+'-25s'))
      await phase('EXPERIENCE')
      const tenth=await js(projection,`({same:document.querySelector('video')===window.__video,src:document.querySelector('video').currentSrc,play:window.__playCalls,load:window.__loadCalls,time:document.querySelector('video').currentTime,paused:document.querySelector('video').paused})`)
      evidence.checks.push({mode,stage:'tenth-second-measurement',...tenth})
      assert(tenth.same&&!tenth.paused&&tenth.time>=9.5&&tenth.time<11.5)
      assert.equal(tenth.src,initial.src);assert.equal(tenth.play,1);assert.equal(tenth.load,1)
      await wait(()=>evidence.media.some(r=>r.event==='ended'&&r.operationId===op),30000)
      await phase('AWAIT_COMPLETION')
      assert.equal((await device()).state,'RUNNING')
      assert(await js(projection,`!!document.querySelector('h1') && !document.querySelector('video').hasAttribute('src') && document.querySelector('video').paused && window.__playCalls===1`))
      const repeat=await js(main,`window.natureTouch.dispatchExperienceCommand({type:'START',mode:'mock',requestId:'repeat',operationId:'repeat-round'}).then(()=>false).catch(()=>true)`)
      assert(repeat)
      await phase('COOLDOWN')
      const cooldown=Date.now()
      assert.equal((await device()).state,'COMPLETED')
      await pause(2500);assert.equal((await snapshot()).phase,'COOLDOWN')
      await phase('READY');assert(Date.now()-cooldown>=2900)
      const playing=evidence.media.find(r=>r.event==='playing'&&r.operationId===op)
      const ended=evidence.media.find(r=>r.event==='ended'&&r.operationId===op)
      evidence.checks.push({mode,operationId:op,ackToPlayingMs:playing.ackToPlayingMs,elapsedMs:ended.elapsedMs,tenth})
    }
    const deviceEvents=await js(main,`window.__deviceEvents`)
    assert.equal(new Set(deviceEvents.filter(e=>e.snapshot.experience.state==='RUNNING').map(e=>e.snapshot.experience.operationId)).size,3)
    const valid=evidence.reports.find(r=>r.event==='ready'&&r.accepted)
    await assert.rejects(Promise.resolve().then(()=>handlers['projector:media-report']({sender:main.webContents,senderFrame:main.webContents.mainFrame},valid)),/Invalid Projector/)
    await assert.rejects(Promise.resolve().then(()=>handlers['projector:media-report']({sender:projection.webContents,senderFrame:projection.webContents.mainFrame},{...valid,operationId:'bad id'})),/Invalid Projector/)
    evidence.checks.push('Three unique running device rounds; unauthorized sender and malformed reports rejected')
  } else {
    if(scenario==='preload-error') await js(projection,`HTMLMediaElement.prototype.load=function(){if(this===window.__video && this.hasAttribute('src'))this.src='data:video/mp4;base64,AAAA';return window.__realLoad.call(this)};true`)
    if(scenario==='play-reject') await js(projection,`HTMLMediaElement.prototype.play=function(){window.__playCalls++;return Promise.reject(Error('fixture play rejection'))};true`)
    await choose('WIND')
    if(scenario==='closed-preload') { await wait(()=>!!heldReport);projection.close();holdReady=false;releaseReady() }
    else if(!['preload-error','play-reject'].includes(scenario)) {
      await phase('WAITING')
      await wait(()=>evidence.media.some(r=>r.event==='playing'))
      if(scenario==='closed-playing')projection.close()
      else if(scenario==='reload')projection.webContents.reload()
      else if(scenario==='fault')await js(main,`window.natureTouch.simulateExperienceFault('fixture-projector-fault')`)
      else if(scenario==='disconnect')await js(main,`window.natureTouch.simulateConnectionLoss()`)
      else throw Error('Unknown scenario '+scenario)
    }
    await phase('FAULT')
    const expectedStarts=['preload-error','closed-preload'].includes(scenario)?0:1
    await pause(400)
    const running=await js(main,`window.__deviceEvents.filter(e=>e.snapshot.experience.state==='RUNNING').map(e=>e.snapshot.experience.operationId)`)
    assert.equal(new Set(running).size,expectedStarts)
    if(projector())assert(await js(projector(),`!document.querySelector('video').hasAttribute('src') && document.querySelector('video').paused`))
    assert(!['RUNNING','STOPPING'].includes((await device()).state))
    evidence.checks.push(scenario+' latches FAULT, cleans media, confirms inactive Mock; starts='+expectedStarts)
  }
  const before=await snapshot()
  const acceptedBefore=evidence.commands.filter(c=>c.type==='START'&&c.accepted).length
  if(projector())projector().close()
  await wait(()=>!projector())
  const open=menus.flatMap(m=>m.items.flatMap(i=>i.submenu?.items??[])).find(i=>i.label==='打开 Projector')
  open.click(open,main)
  await wait(()=>projector()&&!projector().webContents.isLoadingMainFrame()&&js(projector(),`document.querySelector('main')?.dataset.phase==='${before.phase}'`))
  await pause(500)
  assert.deepEqual(await snapshot(),before)
  assert(await js(projector(),`document.querySelector('video').paused && !document.querySelector('video').hasAttribute('src')`))
  assert.equal(evidence.commands.filter(c=>c.type==='START'&&c.accepted).length,acceptedBefore)
  evidence.phases=await js(main,`window.__phases`)
  evidence.checks.push('Close/reopen does not start, replay or change Main phase; zero COM access and zero device commands from Projector')
}
let mainCreated=false
app.on('browser-window-created',(_event,win)=>{
  observe(win)
  if(mainCreated)return;mainCreated=true
  win.webContents.once('did-finish-load',()=>run(win).then(()=>finish(),finish))
})
process.on('uncaughtException',finish)
process.on('unhandledRejection',finish)
const entry = require.resolve('../desktop/out/main/main.js')
assert.match(require('node:fs').readFileSync(entry, 'utf8'), /const EXHIBITION_DEVICE_SOURCE = "mock";/)
require(entry)
