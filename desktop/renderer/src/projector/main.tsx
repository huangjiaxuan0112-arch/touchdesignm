import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import type { ExhibitionLifecycleSnapshot } from '../../../shared/exhibition-lifecycle'
import type { ExperienceId } from '../../../shared/experience-definitions'
import { PROJECTOR_MEDIA } from './media'
import { PROJECTOR_DURATION_MS, PROJECTOR_DURATION_TOLERANCE_SECONDS, type ProjectorMediaReport } from '../../../shared/projector'
import './projector.css'

function ProjectorStandby() {
  const [snapshot, setSnapshot] = useState<ExhibitionLifecycleSnapshot | null>(null)
  const [ready, setReady] = useState<ExperienceId | null>(null)
  const [playing, setPlaying] = useState(false)
  const [records, setRecords] = useState<object[]>([])
  const video = useRef<HTMLVideoElement>(null)
  const generation = useRef(0)
  const listeners = useRef<AbortController | null>(null)
  const selected = useRef<ExperienceId | null>(null)
  const preparedOperation = useRef<string | null>(null)
  const consumedOperation = useRef<string | null>(null)
  const ackAt = useRef<number | undefined>(undefined)
  const requestAt = useRef<number | null>(null)
  const startedAt = useRef<number | null>(null)
  const preview = window.natureTouchProjector?.developmentPreview === true
  const record = useCallback((event: string, detail: object = {}) => {
    const entry = { event, mode: selected.current, operationId: preparedOperation.current, at: new Date().toISOString(), ...detail }
    console.info('projector.media', JSON.stringify(entry))
    setRecords(values => [...values.slice(-29), entry])
  }, [])
  const report = useCallback((event: ProjectorMediaReport['event'], detail: Partial<ProjectorMediaReport> = {}) => {
    const operationId = preparedOperation.current, experienceId = selected.current
    if (!operationId || !experienceId) return Promise.resolve(false) // Developer preview has no device round.
    return window.natureTouchProjector.reportMedia({ operationId, experienceId, event, occurredAtMs: Date.now(), ...detail })
      .catch(error => { console.error('Projector report failed:', error); return false })
  }, [])
  const clear = useCallback(() => {
    generation.current++
    listeners.current?.abort()
    listeners.current = null
    const element = video.current
    if (element) { element.pause(); element.removeAttribute('src'); element.load() }
    selected.current = null
    preparedOperation.current = null
    ackAt.current = undefined
    requestAt.current = null
    startedAt.current = null
    setReady(null)
    setPlaying(false)
  }, [])
  const preload = useCallback((mode: ExperienceId, operationId: string | null = null) => {
    clear()
    const element = video.current
    if (!element) return
    selected.current = mode
    preparedOperation.current = operationId
    const token = generation.current
    const controller = new AbortController()
    listeners.current = controller
    const options = { signal: controller.signal }
    const loadAt = performance.now()
    const current = () => generation.current === token
    const durationSeconds = PROJECTOR_MEDIA[mode].durationMs / 1_000
    element.addEventListener('canplay', () => {
      if (!current()) return
      if (!Number.isFinite(element.duration) ||
          Math.abs(element.duration - durationSeconds) > PROJECTOR_DURATION_TOLERANCE_SECONDS) {
        record('error', { stage: 'preload', message: `Expected a ${durationSeconds}-second video` })
        void report('error', { code: 'INVALID_DURATION' })
        clear()
        return
      }
      setReady(mode)
      record('ready', { preloadMs: performance.now() - loadAt, durationSeconds: element.duration })
      if (operationId) void report('ready', { durationSeconds: element.duration, currentTime: element.currentTime })
        .then(accepted => { if (!accepted && current()) clear() })
    }, { ...options, once: true })
    element.addEventListener('playing', () => {
      if (!current()) return
      setPlaying(true)
      if (startedAt.current === null) {
        startedAt.current = performance.now()
        record('playing', { startupDelayMs: requestAt.current === null ? null : startedAt.current - requestAt.current,
          ackToPlayingMs: ackAt.current === undefined ? null : Date.now() - ackAt.current })
        void report('playing', { currentTime: element.currentTime })
      }
    }, options)
    element.addEventListener('ended', () => {
      if (!current()) return
      record('ended', { elapsedMs: startedAt.current === null ? null : performance.now() - startedAt.current,
        currentTime: element.currentTime, durationSeconds: element.duration })
      void report('ended', { currentTime: element.currentTime, durationSeconds: element.duration })
      clear()
    }, options)
    element.addEventListener('error', () => {
      if (!current()) return
      record('error', { stage: requestAt.current === null ? 'preload' : 'playback', code: element.error?.code, message: element.error?.message })
      void report('error', { code: 'MEDIA_ELEMENT_ERROR' })
      clear()
    }, options)
    element.src = PROJECTOR_MEDIA[mode].src
    element.load()
    record('preload')
  }, [clear, record, report])
  const play = useCallback(() => {
    if (!selected.current || !video.current || requestAt.current !== null) return
    requestAt.current = performance.now()
    const token = generation.current
    record('play-request')
    void video.current.play().catch(error => {
      if (generation.current !== token) return
      record('error', { stage: 'play-request', message: String(error) })
      void report('error', { code: 'PLAY_REJECTED' })
      clear()
    })
  }, [clear, record, report])
  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    void window.natureTouchProjector?.subscribeExhibition(value => {
      if (active) setSnapshot(value)
    }).then(remove => {
      if (active) unsubscribe = remove
      else remove()
    }).catch(error => console.error('Projector state subscription failed:', error))
    return () => { active = false; unsubscribe?.(); clear() }
  }, [clear])
  useEffect(() => {
    if (snapshot?.phase === 'STARTING' && snapshot.experienceId && snapshot.operationId) {
      if (preparedOperation.current !== snapshot.operationId && consumedOperation.current !== snapshot.operationId) {
        preload(snapshot.experienceId, snapshot.operationId)
      }
    } else if (snapshot?.phase === 'WAITING' && snapshot.operationId) {
      if (consumedOperation.current === snapshot.operationId) return
      consumedOperation.current = snapshot.operationId // Consume before play, even if it rejects.
      if (preparedOperation.current !== snapshot.operationId || !video.current || video.current.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        void window.natureTouchProjector.reportMedia({ event: 'error', operationId: snapshot.operationId,
          experienceId: snapshot.experienceId!, occurredAtMs: Date.now(), code: 'NOT_PREPARED' }).catch(console.error)
        clear()
        return
      }
      ackAt.current = snapshot.startAcknowledgedAtMs
      play()
    } else if (snapshot?.phase === 'FAULT' || snapshot?.phase === 'COOLDOWN' || snapshot?.phase === 'READY') clear()
    // EXPERIENCE and AWAIT_COMPLETION never touch src, currentTime or play().
  }, [snapshot?.revision, clear, preload, play])

  return <main className="projector-standby" data-projector-standby
    data-phase={snapshot?.phase} data-revision={snapshot?.revision} data-ready={ready ?? ''}
    data-operation-id={snapshot?.operationId ?? ''} data-playing={playing} data-media-configured={true}>
    <video ref={video} className="projector-video" hidden={!playing} preload="auto" playsInline muted loop={false} controls={false} />
    {!playing && <><p>Nature Touch</p><h1>Standby</h1></>}
    {preview && (!snapshot || snapshot.phase === 'READY') && <section className="projector-preview" data-projector-preview>
      <p>Development preview · silent {PROJECTOR_DURATION_MS / 1_000}s · no device commands</p>
      {(['WIND', 'WAVE', 'BUBBLE'] as const).map(mode => <button key={mode} data-preload={mode} onClick={() => preload(mode)}>Preload {mode}</button>)}
      <button data-play disabled={!ready || playing} onClick={play}>Play once</button>
      <button data-stop onClick={() => { record('stopped'); clear() }}>Stop</button>
      <pre data-media-records>{JSON.stringify(records, null, 2)}</pre>
    </section>}
  </main>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ProjectorStandby /></React.StrictMode>,
)
