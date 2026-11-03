const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-background-media-suspend')

const expectedMedia = {
  WIND: { video: '东风长3_15秒音视频合成', audio: '东风声-' },
  WAVE: { video: 'waves-experience-', audio: '海浪声-' },
  BUBBLE: { video: 'bubbles-experience-', audio: 'voicebosch-bubbles-171716' },
}
let starts = 0
let stops = 0
let finished = false
const originalHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => originalHandle(channel, (...args) => {
  if (channel === 'experience:start') starts++
  if (channel === 'experience:stop') stops++
  return listener(...args)
})

const serial = require('../desktop/node_modules/serialport')
serial.SerialPort.list = async () => { throw Error('COM discovery forbidden') }
serial.SerialPort.prototype.open = () => { throw Error('COM access forbidden') }

function finish(error, results = []) {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  console.log(JSON.stringify({ result: error ? 'FAIL' : 'PASS', results, error: error?.stack }))
  app.exit(error ? 1 : 0)
}

process.on('uncaughtException', error => finish(error))
const timeout = setTimeout(() => finish(Error('Audio synchronization test timed out')), 90000)

let attached = false
function attachWindow(win) {
  if (attached) return
  attached = true
  const run = async () => {
    win.webContents.setBackgroundThrottling(false)
    win.show()
    win.focus()
    const js = source => win.webContents.executeJavaScript(source, true)
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    async function wait(source) {
      for (let i = 0; i < 200; i++) {
        if (await js(source)) return
        await pause(100)
      }
      throw Error('Timed out waiting for: ' + source)
    }

    try {
      const results = []
      for (const [mode, expected] of Object.entries(expectedMedia)) {
        await wait(`!!document.querySelector('[data-experience="${mode}"]')`)
        const startsBefore = starts
        const stopsBefore = stops
        await js(`document.querySelector('[data-experience="${mode}"]').click()`)
        await wait(`!!document.querySelector('.experience-dialog video') && !!document.querySelector('.experience-dialog audio')`)
        await js(`(()=>{
          const video=document.querySelector('.experience-dialog video');
          const audio=document.querySelector('.experience-dialog audio');
          window.__sync={audioAt:null,videoAt:null,firstFrameAt:null};
          audio.addEventListener('playing',()=>window.__sync.audioAt=performance.now(),{once:true});
          video.addEventListener('playing',()=>window.__sync.videoAt=performance.now(),{once:true});
          const capture=(now,metadata)=>{
            if(!video.paused&&getComputedStyle(video).opacity==='1'&&metadata.mediaTime>0.01&&window.__sync.firstFrameAt===null)
              window.__sync.firstFrameAt=now;
            if(window.__sync.firstFrameAt===null)video.requestVideoFrameCallback(capture);
          };
          video.requestVideoFrameCallback(capture);
        })()`)
        await wait(`(()=> {
          const video=document.querySelector('.experience-dialog video');
          const audio=document.querySelector('.experience-dialog audio');
          return video?.readyState>=3 && audio?.readyState>=3;
        })()`)
        const media = await js(`(()=>{
          const video=document.querySelector('.experience-dialog video');
          const audio=document.querySelector('.experience-dialog audio');
          return {
            videoSrc:decodeURI(video.currentSrc),
            audioSrc:decodeURI(audio.currentSrc),
            videoReady:video.readyState,
            audioReady:audio.readyState
          };
        })()`)
        assert(media.videoSrc.includes(expected.video), `${mode} loaded the wrong video: ${media.videoSrc}`)
        assert(media.audioSrc.includes(expected.audio), `${mode} loaded the wrong MP3: ${media.audioSrc}`)
        assert(media.videoReady >= 3 && media.audioReady >= 3, `${mode} media was not ready before playback`)
        assert.equal(starts, startsBefore + 1, `${mode} must issue exactly one START`)

        await wait(`document.querySelector('[data-experience-player]')?.dataset.playbackPhase==='playing'`)
        await wait(`window.__sync.audioAt!==null && window.__sync.firstFrameAt!==null`)
        const measurement = await js(`(()=>{
          const video=document.querySelector('.experience-dialog video');
          const audio=document.querySelector('.experience-dialog audio');
          let drift=video.currentTime-audio.currentTime;
          if(drift>video.duration/2)drift-=video.duration;
          if(drift< -video.duration/2)drift+=video.duration;
          return {
            muted:video.muted,
            audioToVideoPlayingMs:window.__sync.videoAt-window.__sync.audioAt,
            audioToFirstMovingFrameMs:window.__sync.firstFrameAt-window.__sync.audioAt,
            driftMs:drift*1000
          };
        })()`)
        assert.equal(measurement.muted, true, `${mode} video must remain muted`)
        assert(measurement.audioToFirstMovingFrameMs >= 0 && measurement.audioToFirstMovingFrameMs < 1200,
          `${mode} video became visible before audio or its first moving frame was late: ${measurement.audioToFirstMovingFrameMs}ms`)
        assert(Math.abs(measurement.driftMs) < 400, `${mode} A/V drift exceeded 400ms: ${measurement.driftMs}ms`)
        results.push({ mode, ...measurement })

        await js(`document.querySelector('[aria-label="Back to experiences"]').click()`)
        await wait(`!document.querySelector('.experience-dialog')`)
        assert.equal(stops, stopsBefore + 1, `${mode} exit must issue one STOP`)
      }
      finish(null, results)
    } catch (error) {
      finish(error)
    }
  }
  if (win.webContents.isLoadingMainFrame()) win.webContents.once('did-finish-load', run)
  else void run()
}

app.on('browser-window-created', (_event, win) => attachWindow(win))
require('../desktop/out/main/main.js')
setTimeout(() => {
  if (attached) return
  const win = BrowserWindow.getAllWindows()[0]
  if (win) attachWindow(win)
}, 0)
