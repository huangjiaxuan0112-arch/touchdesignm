import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { ExperienceSnapshot } from '../../../shared/experience-control-protocol'
import type { ExhibitionLifecycleSnapshot } from '../../../shared/exhibition-lifecycle'
import type { MediaErrorCode } from '../../../shared/ipc'
import type { ExperienceId } from '../../../shared/experience-definitions'

function waitForVideoReady(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadeddata', checkReady)
      video.removeEventListener('canplay', checkReady)
      video.removeEventListener('error', handleError)
      signal.removeEventListener('abort', handleAbort)
    }
    const checkReady = () => {
      if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error('Experience video failed before it was ready.'))
    }
    const handleAbort = () => {
      cleanup()
      reject(new DOMException('Media preparation cancelled.', 'AbortError'))
    }
    video.addEventListener('loadeddata', checkReady)
    video.addEventListener('canplay', checkReady)
    video.addEventListener('error', handleError)
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
    else checkReady()
  })
}

function phaseLabel(phase: ExhibitionLifecycleSnapshot['phase']): string {
  switch (phase) {
    case 'STARTING': return '準備中'
    case 'WAITING': return 'WAITING PLACEHOLDER'
    case 'EXPERIENCE': return 'VIDEO PLACEHOLDER'
    case 'AWAIT_COMPLETION': return '完了確認中'
    case 'COOLDOWN': return 'クールダウン'
    case 'FAULT': return '体験を停止しました'
    default: return '準備中'
  }
}

export function ExperiencePlayer({ id, label, title, poster, experienceVideo, runState,
  exhibitionState, deviceLabel, onStart, onExit }: {
  id: ExperienceId
  label: string
  title: string
  poster: string
  experienceVideo: string
  runState: ExperienceSnapshot
  exhibitionState: ExhibitionLifecycleSnapshot
  deviceLabel: string
  onStart: () => Promise<ExperienceSnapshot>
  onExit: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const phaseRef = useRef(exhibitionState.phase)
  const started = useRef(false)
  const errorReported = useRef(false)
  const [mediaEnded, setMediaEnded] = useState(false)
  const [error, setError] = useState('')
  const reducedMotion = useReducedMotion()
  phaseRef.current = exhibitionState.phase

  function reportMediaError(message: string, code: MediaErrorCode) {
    if (errorReported.current) return
    errorReported.current = true
    setError(message)
    void window.natureTouch?.logMediaError(code).catch(cause => {
      console.error('Failed to report exhibition media error:', cause)
    })
  }

  useEffect(() => {
    const element = video.current
    if (!element) return
    const preparation = new AbortController()
    dialog.current?.showModal()
    element.muted = false
    void waitForVideoReady(element, preparation.signal).then(async () => {
      if (preparation.signal.aborted || started.current) return
      started.current = true
      await onStart()
    }).catch(cause => {
      if (preparation.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) return
      reportMediaError(
        (started.current ? '体験を開始できません。' : '映像を準備できません。') + String(cause),
        started.current ? 'experience-start-failed' : 'media-prepare-failed',
      )
    })
    return () => {
      preparation.abort()
      element.pause()
      try { element.currentTime = 0 } catch { /* Metadata may not have loaded. */ }
      dialog.current?.close()
    }
  }, [])

  useEffect(() => {
    const element = video.current
    if (!element) return
    if (exhibitionState.phase === 'EXPERIENCE') {
      element.muted = false
      void element.play().catch(cause => {
        if (phaseRef.current === 'EXPERIENCE') {
          reportMediaError('映像を再生できません。' + String(cause), 'video-play-failed')
        }
      })
    } else if (exhibitionState.phase !== 'WAITING') {
      element.pause()
    }
    if (exhibitionState.phase === 'COOLDOWN') onExit()
    if (exhibitionState.phase === 'FAULT') {
      element.pause()
      try { element.currentTime = 0 } catch { /* Metadata may not have loaded. */ }
    }
  }, [exhibitionState.phase])

  const waiting = exhibitionState.phase === 'WAITING'
  const playing = exhibitionState.phase === 'EXPERIENCE' || exhibitionState.phase === 'AWAIT_COMPLETION'
  const faulted = exhibitionState.phase === 'FAULT'

  return <dialog ref={dialog} className="experience-dialog" aria-label={`${label} experience`}
    onCancel={event => event.preventDefault()}>
    <motion.section className="experience-player" data-experience-player={id}
      data-exhibition-phase={exhibitionState.phase}
      initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .5, ease: 'easeOut' }}>
      <header className="experience-player__header">
        <h2>{label}<span lang="ja">{title}</span></h2>
        <p className="experience-player__device">{deviceLabel}</p>
      </header>
      <div className={`experience-player__stage${waiting ? ' experience-player__stage--waiting' : ''}`}>
        <img className="experience-player__poster" src={poster} alt="" />
        <video ref={video} className="experience-dialog__video" src={experienceVideo}
          poster={poster} playsInline preload="auto" controls={false}
          style={{ opacity: playing ? 1 : 0 }}
          onEnded={() => setMediaEnded(true)}
          onError={() => reportMediaError('映像を読み込めません。', 'video-load-failed')} />
        {!playing && <div className="experience-player__placeholder" role="status">
          <span>{faulted ? (runState.faultCode ?? exhibitionState.faultCode ?? 'FAULT') : phaseLabel(exhibitionState.phase)}</span>
          {waiting && <small>5s · TEMPORARY VISUAL</small>}
          {exhibitionState.phase === 'STARTING' && <small>MEDIA PREPARATION · TEMPORARY</small>}
        </div>}
      </div>
      <div className="experience-player__bottom">
        <p className="experience-player__status" role="status" aria-live="polite">
          <i className={`status-dot${playing && !mediaEnded && !faulted ? '' : ' status-dot--muted'}`} />
          {error || phaseLabel(exhibitionState.phase)}
          {exhibitionState.phase === 'AWAIT_COMPLETION' && <span>DEVICE COMPLETION</span>}
        </p>
      </div>
    </motion.section>
  </dialog>
}
