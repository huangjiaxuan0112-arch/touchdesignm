import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, Maximize, Minimize, Volume2, VolumeX } from 'lucide-react'
import { Button, Slider, Tooltip, TooltipProvider } from '../components/ui/playback-controls'
import { EXPERIENCE_DEFINITIONS, type ExperienceId } from '../../../shared/experience-definitions'
import type { ExperienceSnapshot } from '../../../shared/experience-control-protocol'

type MediaState = 'loading' | 'playing' | 'paused' | 'stopped' | 'error'
const labels: Record<MediaState, string> = { loading: '読み込み中', playing: '再生中', paused: '一時停止', stopped: '停止中', error: '再生を停止しました' }
type PlaybackPhase = 'preparing' | 'waiting' | 'starting-media' | 'playing' | 'buffering' | 'stopped' | 'error'

function waitForMediaReady(element: HTMLMediaElement, signal: AbortSignal): Promise<void> {
  if (element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      element.removeEventListener('loadeddata', checkReady)
      element.removeEventListener('canplay', checkReady)
      element.removeEventListener('canplaythrough', checkReady)
      element.removeEventListener('error', handleError)
      signal.removeEventListener('abort', handleAbort)
    }
    const checkReady = () => {
      if (element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error('Media failed before it was ready.'))
    }
    const handleAbort = () => {
      cleanup()
      reject(new DOMException('Media preparation cancelled.', 'AbortError'))
    }
    element.addEventListener('loadeddata', checkReady)
    element.addEventListener('canplay', checkReady)
    element.addEventListener('canplaythrough', checkReady)
    element.addEventListener('error', handleError)
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
    else checkReady()
  })
}

export function ExperiencePlayer({ id, label, title, poster, experienceVideo, experienceAudio, deviceLabel,
  runState, connectionReady, onStart, onSafeStop, onExit }: {
  id: ExperienceId; label: string; title: string; poster: string; experienceVideo?: string; experienceAudio: string
  deviceLabel: string; runState: ExperienceSnapshot; connectionReady: boolean
  onStart: () => Promise<ExperienceSnapshot>; onSafeStop: () => Promise<void>; onExit: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const stopped = useRef(true)
  const mounted = useRef(false)
  const autoStarted = useRef(false)
  const generation = useRef(0)
  const starting = useRef<Promise<void> | null>(null)
  const preparation = useRef<AbortController | null>(null)
  const stopping = useRef<Promise<boolean> | null>(null)
  const exiting = useRef(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const runtime = useRef<{ at: number; elapsed: number; duration: number; operationId: string | null } | null>(null)
  const audioStartRequested = useRef(false)
  const audioPlaybackStarted = useRef(false)
  const videoStarted = useRef(false)
  const videoStart = useRef<Promise<void> | null>(null)
  const failureHandled = useRef(false)
  const callbacks = useRef({ onStart, onSafeStop })
  callbacks.current = { onStart, onSafeStop }
  const [status, setStatus] = useState<MediaState>('loading')
  const [phase, setPhase] = useState<PlaybackPhase>('preparing')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const reducedMotion = useReducedMotion()
  const definition = EXPERIENCE_DEFINITIONS[id]

  function clearMedia() {
    generation.current++
    stopped.current = true
    runtime.current = null
    preparation.current?.abort()
    preparation.current = null
    audioStartRequested.current = false
    audioPlaybackStarted.current = false
    videoStarted.current = false
    videoStart.current = null
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    for (const element of [video.current, audio.current]) {
      element?.pause()
      if (element) { try { element.currentTime = 0 } catch { /* No metadata yet. */ } }
    }
    if (video.current) video.current.playbackRate = 1
  }
  function mediaError(message: string) {
    if (!mounted.current || failureHandled.current) return
    failureHandled.current = true
    autoStarted.current = true
    clearMedia()
    setBusy(false)
    setPhase('error')
    setStatus('error'); setError(message)
    void callbacks.current.onSafeStop().catch(cause => {
      if (mounted.current) setError(message + ' 停止確認エラー: ' + String(cause))
    })
  }
  function startVideoAfterAudio(token: number) {
    const v = video.current
    if (!v || !audioStartRequested.current || stopped.current || token !== generation.current || videoStart.current) return
    const a = audio.current
    const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 15
    const target = (a?.currentTime ?? 0) % duration
    try { v.currentTime = target } catch { /* Media was preloaded before START. */ }
    setPhase('starting-media')
    const request = (async () => {
      try {
        await v.play()
        if (!mounted.current || stopped.current || token !== generation.current) {
          v.pause()
          return
        }
        videoStarted.current = true
        const a = audio.current
        if (a && !audioPlaybackStarted.current) {
          void a.play().catch(cause => {
            if (mounted.current && token === generation.current) mediaError('音声を再生できません。' + String(cause))
          })
        }
      } catch (cause) {
        if (mounted.current && token === generation.current) {
          mediaError('映像を再生できません。' + String(cause))
        }
      } finally {
        if (token === generation.current) videoStart.current = null
      }
    })()
    videoStart.current = request
  }
  function startAudioAtPlayback(elapsed: number, token: number) {
    const a = audio.current
    if (!a || audioStartRequested.current || stopped.current || token !== generation.current) return
    audioStartRequested.current = true
    setPhase('starting-media')
    const offset = Math.max(0, elapsed) / 1000
    if (Number.isFinite(a.duration) && offset >= a.duration) {
      mediaError('音声の再生位置がファイルの長さを超えています。')
      return
    }
    try { a.currentTime = offset } catch (cause) {
      mediaError('音声の再生位置を設定できません。' + String(cause))
      return
    }
    if (video.current) startVideoAfterAudio(token)
    else void a.play().catch(cause => {
      if (mounted.current && token === generation.current) mediaError('音声を再生できません。' + String(cause))
    })
  }
  function syncPlayback() {
    const clock = runtime.current
    if (!clock || stopped.current) return
    const elapsed = clock.elapsed + performance.now() - clock.at
    if (elapsed >= clock.duration) {
      void back()
      return
    }
    if (!audioStartRequested.current) {
      startAudioAtPlayback(elapsed, generation.current)
    }
    const v = video.current
    if (videoStarted.current && v && !v.paused && Number.isFinite(v.duration) && v.duration > 0) {
      const masterTime = audio.current && !audio.current.ended
        ? audio.current.currentTime
        : Math.max(0, elapsed) / 1000
      const target = masterTime % v.duration
      let drift = v.currentTime - target
      if (drift > v.duration / 2) drift -= v.duration
      else if (drift < -v.duration / 2) drift += v.duration
      if (Math.abs(drift) > 0.4) {
        v.currentTime = target
        v.playbackRate = 1
      } else {
        v.playbackRate = Math.max(0.95, Math.min(1.05, 1 - drift * 0.12))
      }
    }
  }
  function begin(): Promise<void> {
    if (!mounted.current || starting.current || stopping.current || autoStarted.current) return starting.current ?? Promise.resolve()
    autoStarted.current = true
    const token = ++generation.current
    stopped.current = false
    setBusy(true); setError(''); setStatus('loading')
    const request = (async () => {
      try {
        const snapshot = await callbacks.current.onStart()
        if (!mounted.current || token !== generation.current) {
          await callbacks.current.onSafeStop()
          return
        }
        runtime.current = {
          at: performance.now(),
          elapsed: snapshot.elapsedMs,
          duration: snapshot.durationMs ?? definition.totalDurationMs,
          operationId: snapshot.operationId,
        }
        setPhase('starting-media')
        timer.current = setInterval(syncPlayback, 20)
        syncPlayback()
      } catch (cause) {
        if (mounted.current && token === generation.current) mediaError('体験を開始できません。' + String(cause))
      } finally {
        starting.current = null
        if (mounted.current) setBusy(false)
      }
    })()
    starting.current = request
    return request
  }
  useEffect(() => {
    mounted.current = true
    const v = video.current, a = audio.current
    if (v) { v.defaultMuted = true; v.muted = true }
    dialog.current?.showModal()
    const controller = new AbortController()
    preparation.current = controller
    setBusy(true)
    setStatus('loading')
    setPhase('preparing')
    void Promise.all([
      ...(v ? [waitForMediaReady(v, controller.signal)] : []),
      ...(a ? [waitForMediaReady(a, controller.signal)] : []),
    ]).then(() => {
      if (!mounted.current || controller.signal.aborted) return
      preparation.current = null
      if (v) { v.pause(); v.currentTime = 0; v.muted = true }
      if (a) { a.pause(); a.currentTime = 0 }
      void begin()
    }).catch(cause => {
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) return
      mediaError('音声と映像を準備できません。' + String(cause))
    })
    return () => {
      mounted.current = false; clearMedia(); dialog.current?.close()
    }
  }, [])
  useEffect(() => {
    if (audio.current) { audio.current.volume = volume; audio.current.muted = muted }
    if (video.current) video.current.muted = true
  }, [volume, muted])
  useEffect(() => {
    if (!connectionReady || runState.state === 'FAULT') {
      autoStarted.current = true
      clearMedia(); setBusy(false); setStatus('error')
      setPhase('error')
      setError(!connectionReady ? 'デバイス接続が失われたため停止しました。' : 'FAULT: ' + (runState.faultCode ?? 'UNKNOWN'))
    } else if (runtime.current && (runState.state === 'COMPLETED' || runState.state === 'STOPPING')) {
      void back()
    }
  }, [runState.state, connectionReady, runState.faultCode])
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === dialog.current)
    document.addEventListener('fullscreenchange', update)
    const hide = () => { if (document.hidden) void stop() }
    document.addEventListener('visibilitychange', hide)
    return () => { document.removeEventListener('fullscreenchange', update); document.removeEventListener('visibilitychange', hide) }
  }, [])
  function stop(): Promise<boolean> {
    if (stopping.current) return stopping.current
    autoStarted.current = true // A late loadeddata event must not undo STOP.
    clearMedia(); setStatus('paused'); setBusy(true)
    setPhase('stopped')
    const request = (async () => {
      try {
        await callbacks.current.onSafeStop()
        if (mounted.current) { setStatus('stopped'); setPhase('stopped'); setError('') }
        return true
      } catch (cause) {
        if (mounted.current) { setStatus('error'); setError('停止を確認できません。' + String(cause)) }
        return false
      } finally { stopping.current = null; if (mounted.current) setBusy(false) }
    })()
    stopping.current = request
    return request
  }
  async function back() {
    if (exiting.current) return
    exiting.current = true
    if (!await stop()) { exiting.current = false; return }
    try {
      if (document.fullscreenElement === dialog.current) await document.exitFullscreen()
      onExit()
    } catch {
      exiting.current = false
      setError('全画面表示を終了できません。もう一度もどるを押してください。')
    }
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await dialog.current?.requestFullscreen()
    } catch { setError('全画面表示を開始できません。') }
  }
  return <dialog ref={dialog} className="experience-dialog" aria-label={label + ' experience video'}
    onCancel={(event) => { event.preventDefault(); void back() }}>
    <motion.section className="experience-player" data-experience-player={id} data-playback-phase={phase}
      initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .5, ease: 'easeOut' }}>
      <TooltipProvider delayDuration={350}>
        <header className="experience-player__header">
          <Button aria-label="Back to experiences" onClick={() => void back()} disabled={stopping.current !== null} autoFocus><ArrowLeft />もどる</Button>
          <h2>{label}<span lang="ja">{title}</span></h2>
          <p className="experience-player__device">{deviceLabel}</p>
        </header>
        <div className="experience-player__stage">
          <img className="experience-player__poster" src={poster} alt="" />
          {experienceVideo && <video ref={video} className="experience-dialog__video" src={experienceVideo}
            poster={poster} muted playsInline loop preload="auto" style={{ opacity: phase === 'playing' ? 1 : 0 }}
            onLoadStart={() => { if (!stopped.current) setStatus('loading') }}
            onPlaying={() => {
              if (!stopped.current && runtime.current && audioStartRequested.current) {
                videoStarted.current = true
                if (audioPlaybackStarted.current) {
                  setPhase('playing'); setStatus('playing'); setError('')
                }
              } else video.current?.pause()
            }}
            onPause={() => { if (!stopped.current) setStatus(audio.current?.paused ? 'paused' : 'loading') }}
            onWaiting={() => { if (!stopped.current) setStatus('loading') }}
            onError={() => mediaError('映像を読み込めません。ポスターを表示しています。')} />}
          <audio ref={audio} src={experienceAudio} preload="auto"
            onPlaying={() => {
              if (!runtime.current || stopped.current || !audioStartRequested.current) {
                audio.current?.pause()
                return
              }
              audioPlaybackStarted.current = true
              const a = audio.current
              const v = video.current
              if (a && v && Number.isFinite(v.duration) && v.duration > 0) {
                try { v.currentTime = a.currentTime % v.duration } catch { /* Wait for the next media frame. */ }
              }
              if (videoStarted.current) {
                setPhase('playing'); setStatus('playing'); setError('')
              }
            }}
            onWaiting={() => {
              if (!stopped.current) {
                if (audioPlaybackStarted.current) video.current?.pause()
                setPhase('buffering'); setStatus('loading')
              }
            }}
            onError={() => mediaError('音声を読み込めません。')} />
        </div>
        <div className="experience-player__bottom">
          <p className="experience-player__status" role="status" aria-live="polite"><i className={`status-dot${status === 'playing' ? '' : ' status-dot--muted'}`} />{experienceVideo ? labels[status] : labels.error}<span>映像・音声</span></p>
          <div className="experience-player__controls">
            <div className="experience-player__volume">
              <Tooltip label={muted ? 'ミュート解除' : 'ミュート'}><Button aria-label={muted ? 'Unmute video' : 'Mute video'} onClick={() => setMuted(value => !value)}>{muted || volume === 0 ? <VolumeX /> : <Volume2 />}</Button></Tooltip>
              <Slider aria-label="Video volume" min={0} max={1} step={.01} value={[muted ? 0 : volume]} onValueChange={([value]) => { setVolume(value); setMuted(false) }} />
            </div>
            <Tooltip label={fullscreen ? '全画面を終了' : '全画面'}><Button aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize /> : <Maximize />}</Button></Tooltip>
          </div>
          {error && <p className="experience-player__error" role="alert">{error}</p>}
        </div>
      </TooltipProvider>
    </motion.section>
  </dialog>
}
