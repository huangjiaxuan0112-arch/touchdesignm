import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import { ExperiencePlayer } from './ExperiencePlayer'
import { stopActiveExperience } from './stop-active-experience'
import { selectExperienceIntent, startSelectedExperience } from './start-selected-experience'
import type { ExperienceSnapshot } from '../../../shared/experience-control-protocol'
import type { ExperienceMode } from '../../../shared/experience-application-contract'
import {
  EXPERIENCE_DEFINITIONS,
  EXPERIENCE_DISPLAY_NAMES,
  type ExperienceId,
} from '../../../shared/experience-definitions'
import { NatureVideoCard } from './NatureVideoCard'
import { ArduinoConnection } from '../device/ArduinoConnection'
import { INITIAL_FIRMWARE_CONTROL_SNAPSHOT } from '../../../shared/firmware-control-protocol'
import windPoster from '../assets/wind/wind-poster.png'
import wavePoster from '../assets/waves/waves-poster.png'
import bubblePoster from '../assets/bubbles/bubbles-poster.png'
import windPreviewVideo from '../assets/wind/wind-preview.mp4'
import windExperienceVideo from '../../../../卒研music/wind/东风长3_15秒音视频合成.mp4'
import wavesPreviewVideo from '../assets/waves/waves-preview.mp4'
import wavesExperienceVideo from '../assets/waves/waves-experience.mp4'
import bubblesPreviewVideo from '../assets/bubbles/bubbles-preview.mp4'
import bubblesExperienceVideo from '../assets/bubbles/bubbles-experience.mp4'
import windAudio from '../../../../卒研music/wind/东风声.mp3'
import waveAudio from '../../../../卒研music/ocean waves/海浪声.mp3'
import bubbleAudio from '../../../../卒研music/bubbles/voicebosch-bubbles-171716.mp3'

const cards: Array<{
  id: ExperienceId
  label: string
  title: string
  description: string
  poster: string
  previewVideo?: string
  experienceVideo?: string
  experienceAudio: string
}> = [
  {
    id: 'WIND',
    label: EXPERIENCE_DISPLAY_NAMES.WIND,
    title: '風',
    description: 'ゆっくり、やさしく流れる。',
    poster: windPoster,
    previewVideo: windPreviewVideo,
    experienceVideo: windExperienceVideo,
    experienceAudio: windAudio,
  },
  {
    id: 'WAVE',
    label: EXPERIENCE_DISPLAY_NAMES.WAVE,
    title: '波',
    description: '寄せては返す、穏やかなリズム。',
    poster: wavePoster,
    previewVideo: wavesPreviewVideo,
    experienceVideo: wavesExperienceVideo,
    experienceAudio: waveAudio,
  },
  {
    id: 'BUBBLE',
    label: EXPERIENCE_DISPLAY_NAMES.BUBBLE,
    title: '泡',
    description: '小さく弾ける、軽やかな感覚。',
    poster: bubblePoster,
    previewVideo: bubblesPreviewVideo,
    experienceVideo: bubblesExperienceVideo,
    experienceAudio: bubbleAudio,
  },
]

const initialExperienceState: ExperienceSnapshot = {
  state: 'IDLE',
  selectedExperienceId: null,
  operationId: null,
  elapsedMs: 0,
  durationMs: null,
  progress: 0,
  faultCode: null,
}

export default function ExhibitionHome() {
  const [realMode, setRealMode] = useState(false)
  const [firmwareState, setFirmwareState] = useState(INITIAL_FIRMWARE_CONTROL_SNAPSHOT)
  const [deviceBusy, setDeviceBusy] = useState(false)
  const [experienceState, setExperienceState] = useState(initialExperienceState)
  const [activeExperienceId, setActiveExperienceId] = useState<ExperienceId>('WIND')
  const [switchingExperienceId, setSwitchingExperienceId] = useState<ExperienceId | null>(null)
  const [dialogExperienceId, setDialogExperienceId] = useState<ExperienceId | null>(null)
  const [actionError, setActionError] = useState('')
  const [focusedId, setFocusedId] = useState<ExperienceId | null>(null)
  const [previewId, setPreviewId] = useState<ExperienceId | null>(null)
  const [visible, setVisible] = useState(!document.hidden)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingStop = useRef<Promise<void> | null>(null)
  const pendingStart = useRef<Promise<ExperienceSnapshot> | null>(null)
  const activeOperationId = useRef<string | null>(null)
  const snapshotRevisions = useRef<Record<ExperienceMode, number>>({ mock: -1, firmware: -1 })
  const selecting = useRef(false)
  const reducedMotion = useReducedMotion()

  function clearPreview() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    setFocusedId(null)
    setPreviewId(null)
  }
  function requestSafeStop(): Promise<void> {
    if (pendingStop.current) return pendingStop.current
    const operationId = activeOperationId.current ?? experienceState.operationId
    const mode: ExperienceMode = realMode ? 'firmware' : 'mock'
    const request = stopActiveExperience(window.natureTouch, mode, operationId)
      .then(() => {
        if (activeOperationId.current === operationId) activeOperationId.current = null
      })
      .finally(() => { pendingStop.current = null })
    pendingStop.current = request
    return request
  }
  function focusPreview(id: ExperienceId) {
    clearPreview()
    setFocusedId(id)
    if (reducedMotion || document.hidden || dialogExperienceId) return
    hoverTimer.current = setTimeout(() => { setPreviewId(id); hoverTimer.current = null }, 200)
  }
  useEffect(() => {
    function updateVisibility() { setVisible(!document.hidden); clearPreview() }
    document.addEventListener('visibilitychange', updateVisibility)
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility)
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
    }
  }, [])
  useEffect(() => { clearPreview() }, [dialogExperienceId, reducedMotion])

  useEffect(() => {
    const api = window.natureTouch
    let mounted = true
    let unsubscribe: (() => void) | undefined
    if (!api) return

    const mode: ExperienceMode = realMode ? 'firmware' : 'mock'
    void api.subscribeExperience(mode, (event) => {
      if (!mounted) return
      if (event.snapshot.revision <= snapshotRevisions.current[mode]) return
      snapshotRevisions.current[mode] = event.snapshot.revision
      const snapshot = event.snapshot.experience
      setExperienceState(snapshot)
      if (snapshot.selectedExperienceId) setActiveExperienceId(snapshot.selectedExperienceId)
      if (snapshot.operationId) activeOperationId.current = snapshot.operationId
      else if (['IDLE', 'COMPLETED', 'FAULT'].includes(snapshot.state)) activeOperationId.current = null
      if (mode === 'firmware') {
        setFirmwareState(current => ({ ...current, experience: snapshot }))
      }
    }).then((removeListener) => {
      if (mounted) unsubscribe = removeListener
      else removeListener()
    }).catch((error: unknown) => {
      if (mounted) setActionError(error instanceof Error ? error.message : String(error))
    })

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [realMode])

  const displayedState = experienceState
  const benchReady = firmwareState.openAirBenchSession === true && firmwareState.realControlEligible === true &&
    firmwareState.hardwareOutputsEnabled === true && firmwareState.connectionState === 'connected' && firmwareState.identified
  const realSessionReady = firmwareState.simulationTestArmed === true || benchReady

  function startMediaExperience(): Promise<ExperienceSnapshot> {
    if (pendingStart.current) return pendingStart.current
    if (!dialogExperienceId) return Promise.reject(new Error('Select an experience first.'))
    const request = (async () => {
      if (pendingStop.current) throw new Error('Wait for the current stop request to finish.')
      // Browser preview plays media locally; device control requires Electron.
      if (!window.natureTouch && !realMode) return {
        ...initialExperienceState, state: 'RUNNING' as const,
        selectedExperienceId: dialogExperienceId,
        durationMs: EXPERIENCE_DEFINITIONS[dialogExperienceId].totalDurationMs,
      }
      const operationId = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      activeOperationId.current = operationId
      return startSelectedExperience(
        window.natureTouch,
        realMode ? 'firmware' : 'mock',
        operationId,
      )
    })().finally(() => { pendingStart.current = null })
    pendingStart.current = request
    return request
  }

  async function selectExperience(experienceId: ExperienceId, openVideo = false): Promise<void> {
    if (selecting.current) return
    selecting.current = true
    const api = window.natureTouch
    if (!api) {
      setActiveExperienceId(experienceId)
      if (openVideo) setDialogExperienceId(experienceId)
      selecting.current = false
      return
    }
    setSwitchingExperienceId(experienceId)
    setActionError('')
    try {
      await pendingStop.current
      const mode: ExperienceMode = realMode ? 'firmware' : 'mock'
      const selected = await selectExperienceIntent(api, mode, experienceId)
      if (selected.revision >= snapshotRevisions.current[mode]) {
        snapshotRevisions.current[mode] = selected.revision
        const snapshot = selected.experience
        if (snapshot.operationId) activeOperationId.current = snapshot.operationId
        else if (['IDLE', 'COMPLETED', 'FAULT'].includes(snapshot.state)) activeOperationId.current = null
        setActiveExperienceId(snapshot.selectedExperienceId ?? experienceId)
        setExperienceState(snapshot)
        if (mode === 'firmware') setFirmwareState(current => ({ ...current, experience: snapshot }))
      }
      if (openVideo) setDialogExperienceId(experienceId)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      selecting.current = false
      setSwitchingExperienceId(null)
    }
  }

  const dialogCard = cards.find((card) => card.id === dialogExperienceId)
  const selectedExperienceId = experienceState.selectedExperienceId ?? activeExperienceId
  const activeCard = cards.find((card) => card.id === selectedExperienceId)

  return (
    <main className="exhibition-home">
      <header className="exhibition-heading">
        <span className="exhibition-heading__stem" aria-hidden="true" />
        <h1 lang="ja">自然音 × やわらかな触覚体験</h1>
        <p>NATURAL SOUND × SOFT TACTILE EXPERIENCE</p>
        <span className="exhibition-heading__rule" aria-hidden="true" />
        <p className="exhibition-heading__description" lang="ja">
          触れられない感覚を、触れられる体験へ
        </p>
      </header>

      <section className="nature-card-grid" aria-label="Choose a nature experience">
        {cards.map((card) => {
          const active = selectedExperienceId === card.id
          return (
            <NatureVideoCard
              key={card.id}
              {...card}
              active={active}
              focused={focusedId === card.id}
              dimmed={focusedId !== null && focusedId !== card.id}
              previewPlaying={visible && previewId === card.id && dialogExperienceId === null}
              onFocusPreview={() => focusPreview(card.id)}
              onLeavePreview={clearPreview}
              disabled={
                dialogExperienceId !== null ||
                (realMode && !realSessionReady) ||
                (realMode && deviceBusy) ||
                switchingExperienceId !== null
              }
              onSelect={() => void selectExperience(card.id, !!card.experienceVideo)}
              onReplay={() => void selectExperience(card.id, true)}
            />
          )
        })}
      </section>

      <p className="exhibition-alert" role="alert">
        {actionError}
      </p>

      <footer className="exhibition-footer">
        <details className="device-panel">
          <summary aria-label="Device controls">
            <span className={`status-dot${realMode && !firmwareState.identified ? ' status-dot--muted' : ''}`} aria-hidden="true" />
            {realMode
              ? `実機接続：${firmwareState.connectionState}（${firmwareState.openAirBenchSession ? '無圧ベンチ・気囊接続禁止' : '実出力制御はロック中'}）`
              : 'Mock モード（実機は未接続）'}
          </summary>
          <div className="device-panel__content">
            <ArduinoConnection realMode={realMode} onModeChange={setRealMode}
              onSnapshot={setFirmwareState}
              onBusyChange={setDeviceBusy}
              disabled={switchingExperienceId !== null || experienceState.state === 'RUNNING' || experienceState.state === 'STOPPING'} />
          </div>
        </details>
        <p className="exhibition-footer__instruction" lang="ja">
          音をえらんでください
        </p>
        <p className="exhibition-footer__media">
          <span><i className={`status-dot${activeCard?.experienceVideo ? '' : ' status-dot--muted'}`} aria-hidden="true" />音源 {activeCard?.experienceVideo ? `${activeCard.label} 設定済み` : 'ファイル未設定'}</span>
          <span><i className={`status-dot${previewId ? '' : ' status-dot--muted'}`} aria-hidden="true" />映像 {previewId ? 'プレビュー選択中' : 'ホバーでプレビュー'}</span>
        </p>
      </footer>

      <AnimatePresence onExitComplete={() => {
        document.querySelector<HTMLButtonElement>(`[data-experience="${activeExperienceId}"]`)?.focus({ preventScroll: true })
        clearPreview()
      }}>
        {dialogCard && <ExperiencePlayer key={dialogCard.id} {...dialogCard}
          runState={displayedState}
          connectionReady={!realMode || (firmwareState.connectionState === 'connected' && firmwareState.identified && (firmwareState.hardwareOutputsEnabled === false || benchReady))}
          deviceLabel={realMode
            ? `${firmwareState.connectionState === 'connected' ? (benchReady ? 'Arduino 無圧ベンチ' : 'Arduino シミュレーション') : 'デバイス未接続'} · ${displayedState.state} · ${benchReady ? '気囊接続禁止' : '実出力は無効'}`
            : 'Mock モード · 実機は未接続'}
          onSafeStop={requestSafeStop}
          onStart={startMediaExperience}
          onExit={() => setDialogExperienceId(null)} />}
      </AnimatePresence>
    </main>
  )
}
