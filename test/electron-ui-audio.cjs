const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-background-media-suspend')

const expectedMedia = {
  WIND: { id: 'WIND', video: '东风长3_15秒音视频合成', audio: '东风声-' },
  WAVES: { id: 'WAVE', video: 'waves-experience-', audio: '海浪声-' },
  BUBBLES: { id: 'BUBBLE', video: 'bubbles-experience-', audio: 'voicebosch-bubbles-171716' },
}
const commands = new Map()
const originalSetTimeout = global.setTimeout
global.setTimeout = (callback, delay, ...args) =>
  originalSetTimeout(callback, delay >= 20_000 ? 5_000 : delay, ...args)

function commandFrom(channel, args) {
  if (channel === 'experience:dispatch' && args[1] && typeof args[1] === 'object') {
    return args[1]
  }
  const legacy = {
    'experience:select': ['SELECT', 'mock'],
    'experience:start': ['START', 'mock'],
    'experience:stop': ['STOP', 'mock'],
    'firmware:select': ['SELECT', 'firmware'],
    'firmware:start': ['START', 'firmware'],
    'firmware:stop': ['STOP', 'firmware'],
  }[channel]
  if (!legacy || !args[1] || typeof args[1] !== 'object') return undefined
  const payload = args[1]
  return {
    type: legacy[0],
    mode: legacy[1],
    requestId: payload.requestId,
    operationId: payload.operationId,
  }
}

function recordCommand(channel, args) {
  const command = commandFrom(channel, args)
  if (!command || !['SELECT', 'START', 'STOP'].includes(command.type)) return
  const key = `${command.mode}:${command.type}:${command.requestId}`
  if (!commands.has(key)) commands.set(key, { ...command, channel })
}

const originalHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => originalHandle(channel, (...args) => {
  recordCommand(channel, args)
  return listener(...args)
})

const serial = require('../desktop/node_modules/serialport')
serial.SerialPort.list = async () => { throw Error('COM discovery forbidden by audio test') }
serial.SerialPort.prototype.open = () => { throw Error('COM access forbidden by audio test') }

function count(type, mode = 'mock') {
  return [...commands.values()].filter(command => command.type === type && command.mode === mode).length
}

function finish(error, results = []) {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  console.log(JSON.stringify({ result: error ? 'FAIL' : 'PASS', results, commands: [...commands.values()], error: error?.stack }))
  app.exit(error ? 1 : 0)
}

let finished = false
let attached = false
let window
const timeout = originalSetTimeout(() => finish(Error('Electron audio/lifecycle test timed out')), 180_000)
process.on('uncaughtException', error => finish(error))

function attachWindow(win) {
  if (attached) return
  attached = true
  const run = async () => {
    win.webContents.setBackgroundThrottling(false)
    win.show()
    win.focus()
    const js = source => win.webContents.executeJavaScript(source, true)
    const pause = ms => new Promise(resolve => originalSetTimeout(resolve, ms))
    async function wait(source, timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        try { if (await js(source)) return } catch {}
        await pause(100)
      }
      throw Error(`Timed out waiting for: ${source}`)
    }

    try {
      const results = []
      await js(`(()=>{
        window.__audioSmoke={audioAt:null,videoAt:null,firstFrameAt:null,audioReadyAtStart:null,videoReadyAtStart:null};
        document.addEventListener('playing',event=>{
          const target=event.target;
          if(!target.matches?.('.experience-dialog audio,.experience-dialog video'))return;
          const key=target.tagName.toLowerCase()==='audio'?'audioAt':'videoAt';
          if(window.__audioSmoke[key]===null) {
            window.__audioSmoke[key]=performance.now();
            const readyKey=target.tagName.toLowerCase()==='audio'?'audioReadyAtStart':'videoReadyAtStart';
            window.__audioSmoke[readyKey]=target.readyState;
          }
        },true);
        const observeVideo=video=>{
          if(video.__audioSmokeObserved||typeof video.requestVideoFrameCallback!=='function')return;
          video.__audioSmokeObserved=true;
          const capture=(now,metadata)=>{
            if(video.isConnected&&!video.paused&&metadata.mediaTime>0.01&&window.__audioSmoke.firstFrameAt===null)
              window.__audioSmoke.firstFrameAt=now;
            if(video.isConnected&&window.__audioSmoke.firstFrameAt===null)video.requestVideoFrameCallback(capture);
          };
          video.requestVideoFrameCallback(capture);
        };
        new MutationObserver(()=>document.querySelectorAll('.experience-dialog video').forEach(observeVideo))
          .observe(document.documentElement,{childList:true,subtree:true});
        document.querySelectorAll('.experience-dialog video').forEach(observeVideo);
      })()`)
      for (const [label, expected] of Object.entries(expectedMedia)) {
        await wait(`!!document.querySelector('[data-experience="${expected.id}"]')`)
        const selectsBefore = count('SELECT')
        const startsBefore = count('START')
        const stopsBefore = count('STOP')

        await js(`window.__audioSmoke={audioAt:null,videoAt:null,firstFrameAt:null,audioReadyAtStart:null,videoReadyAtStart:null}`)
        await js(`document.querySelector('[data-experience="${expected.id}"]').click()`)
        await wait(`!!document.querySelector('.experience-dialog video') && !!document.querySelector('.experience-dialog audio')`)
        await wait(`document.querySelector('[data-experience-player]')?.dataset.playbackPhase==='playing'`)
        await wait(`window.__audioSmoke.audioAt!==null && window.__audioSmoke.videoAt!==null && window.__audioSmoke.firstFrameAt!==null`)
        const readiness = await js(`({videoReady:window.__audioSmoke.videoReadyAtStart,audioReady:window.__audioSmoke.audioReadyAtStart})`)
        assert(readiness.videoReady >= 3 && readiness.audioReady >= 3, `${label} media was not ready when playback began`)
        const media = await js(`(()=>{
          const video=document.querySelector('.experience-dialog video');
          const audio=document.querySelector('.experience-dialog audio');
          let drift=video.currentTime-audio.currentTime;
          if(drift>video.duration/2)drift-=video.duration;
          if(drift< -video.duration/2)drift+=video.duration;
          return {
            videoSrc:decodeURI(video.currentSrc),audioSrc:decodeURI(audio.currentSrc),
            videoReady:video.readyState,audioReady:audio.readyState,
            videoPaused:video.paused,audioPaused:audio.paused,muted:video.muted,
            audioToVideoPlayingMs:window.__audioSmoke.videoAt-window.__audioSmoke.audioAt,
            audioToFirstMovingFrameMs:window.__audioSmoke.firstFrameAt-window.__audioSmoke.audioAt,
            driftMs:drift*1000
          };
        })()`)
        assert(media.videoSrc.includes(expected.video), `${label} loaded the wrong MP4: ${media.videoSrc}`)
        assert(media.audioSrc.includes(expected.audio), `${label} loaded the wrong MP3: ${media.audioSrc}`)
        assert(!media.videoPaused && !media.audioPaused, `${label} media did not actually play`)
        assert.equal(media.muted, true, `${label} video must be muted while the separate MP3 plays`)
        assert(Math.abs(media.audioToFirstMovingFrameMs) < 1200,
          `${label} audio/video start synchronization exceeded tolerance: ${media.audioToFirstMovingFrameMs}ms`)
        assert(Math.abs(media.driftMs) < 400, `${label} A/V drift exceeded 400ms: ${media.driftMs}ms`)
        assert.equal(count('SELECT'), selectsBefore + 1, `${label} must send one SELECT`)
        assert.equal(count('START'), startsBefore + 1, `${label} must send exactly one START`)

        const stopSnapshot = await js(`window.natureTouch.getExperienceSnapshot('mock')`)
        assert.equal(stopSnapshot.experience.state, 'RUNNING', `${label} must be device/Mock RUNNING while media plays`)
        await js(`(()=>{window.__lastMedia=[document.querySelector('.experience-dialog video'),document.querySelector('.experience-dialog audio')];document.querySelector('[aria-label="Back to experiences"]').click()})()`)
        await wait(`!document.querySelector('.experience-dialog')`)
        assert.equal(count('STOP'), stopsBefore + 1, `${label} exit must issue one STOP`)
        const afterStop = await js(`window.natureTouch.getExperienceSnapshot('mock')`)
        assert.equal(afterStop.experience.state, 'IDLE', `${label} STOP must be confirmed by Mock state`)
        const cleaned = await js(`window.__lastMedia.every(element=>element.paused&&element.currentTime===0)`)
        assert.equal(cleaned, true, `${label} exit must clean both media elements`)
        results.push({ mode: label, ...media, readiness, stopConfirmed: true, mediaCleaned: cleaned })

        const completionStartsBefore = count('START')
        const completionStopsBefore = count('STOP')
        await js(`document.querySelector('[data-experience="${expected.id}"]').click()`)
        await wait(`document.querySelector('[data-experience-player]')?.dataset.playbackPhase==='playing'`)
        assert.equal(count('START'), completionStartsBefore + 1, `${label} completion run must START once`)
        await wait(`window.natureTouch.getExperienceSnapshot('mock').then(s=>s.experience.state==='COMPLETED')`, 12_000)
        await wait(`!document.querySelector('.experience-dialog')`)
        const completed = await js(`window.natureTouch.getExperienceSnapshot('mock')`)
        assert.equal(completed.experience.state, 'COMPLETED', `${label} completion must remain authoritative`)
        assert.equal(count('STOP'), completionStopsBefore + 1, `${label} completed player exit must make one idempotent STOP intent`)
        results.push({ mode: label, naturalCompleted: true, completionState: completed.experience.state })
      }

      finish(null, results)
    } catch (error) {
      finish(error, [{ failureUi: await js(`({dialog:!!document.querySelector('.experience-dialog'),phase:document.querySelector('[data-experience-player]')?.dataset.playbackPhase,error:document.querySelector('.experience-player__error')?.textContent})`).catch(() => null) }])
    }
  }
  if (win.webContents.isLoadingMainFrame()) win.webContents.once('did-finish-load', run)
  else void run()
}

app.on('browser-window-created', (_event, win) => {
  window = win
  attachWindow(win)
})
require('../desktop/out/main/main.js')
setTimeout(() => {
  if (!attached) {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) attachWindow(win)
  }
}, 0)
