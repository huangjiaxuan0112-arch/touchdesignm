import { useEffect, useState } from 'react'
import type { ExperienceSnapshot } from '../../../shared/experience-control-protocol'
import type { ExperienceId } from '../../../shared/experience-definitions'
import { NatureVideoCard } from './NatureVideoCard'
import { ArduinoConnection } from '../device/ArduinoConnection'
import { INITIAL_FIRMWARE_CONTROL_SNAPSHOT } from '../../../shared/firmware-control-protocol'
import windPreviewVideo from '../../../../卒研music/wind/东风视频（短1）.mp4'
import windPoster from '../assets/posters/wind.svg'
import wavePoster from '../assets/posters/waves.svg'
import bubblePoster from '../assets/posters/bubbles.svg'

const cards: Array<{
  id: ExperienceId
  label: string
  title: string
  description: string
  poster: string
  previewVideo?: string
}> = [
  {
    id: 'WIND',
    label: 'WIND',
    title: '風',
    description: '風のように、揺れながら流れる。',
    poster: windPoster,
    previewVideo: windPreviewVideo,
  },
  {
    id: 'WAVE',
    label: 'WAVES',
    title: '波',
    description: 'ゆっくりと広がる、穏やかな波。',
    poster: wavePoster,
  },
  {
    id: 'BUBBLE',
    label: 'BUBBLES',
    title: '泡',
    description: '小さく弾けて、軽やかに戻る。',
    poster: bubblePoster,
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

  useEffect(() => {
    const api = window.natureTouch
    let mounted = true
    if (!api) return

    void api.getExperienceState().then((snapshot) => {
      if (!mounted) return
      setExperienceState(snapshot)
      if (snapshot.selectedExperienceId) {
        setActiveExperienceId(snapshot.selectedExperienceId)
      }
    }).catch((error: unknown) => {
      if (mounted) setActionError(error instanceof Error ? error.message : String(error))
    })

    const removeListener = api.onExperienceState((snapshot) => {
      setExperienceState(snapshot)
      if (snapshot.selectedExperienceId) {
        setActiveExperienceId(snapshot.selectedExperienceId)
      }
    })
    return () => {
      mounted = false
      removeListener()
    }
  }, [])

  useEffect(() => {
    if (!dialogExperienceId) return
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') setDialogExperienceId(null)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [dialogExperienceId])

  const displayedState = realMode ? firmwareState.experience : experienceState
  const canSwitchExperience = displayedState.state === 'IDLE' || displayedState.state === 'COMPLETED'

  async function selectExperience(experienceId: ExperienceId): Promise<void> {
    if (realMode && !firmwareState.simulationTestArmed) return
    const api = window.natureTouch
    if (!api) {
      setActionError('Mock Device mode selection is available in the Electron application.')
      return
    }
    setSwitchingExperienceId(experienceId)
    setActionError('')
    try {
      const acknowledgement = realMode
        ? await api.selectFirmwareExperience(experienceId, crypto.randomUUID().replace(/-/g, '').slice(0, 16))
        : await api.selectExperience(experienceId, crypto.randomUUID())
      if (!acknowledgement.accepted) {
        throw new Error(`Mode selection rejected: ${acknowledgement.code ?? 'INVALID_COMMAND'}`)
      }
      if (realMode) setFirmwareState(await api.getFirmwareState())
      else {
        setActiveExperienceId(experienceId)
        setExperienceState(await api.getExperienceState())
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSwitchingExperienceId(null)
    }
  }

  const dialogCard = cards.find((card) => card.id === dialogExperienceId)

  return (
    <main className="exhibition-home">
      <header className="exhibition-heading">
        <h1 lang="ja">自然音 × 柔らかな形状変化</h1>
        <p>THREE NATURES, FELT THROUGH TOUCH</p>
      </header>

      <ArduinoConnection realMode={realMode} onModeChange={setRealMode}
        onSnapshot={setFirmwareState}
        onBusyChange={setDeviceBusy}
        disabled={switchingExperienceId !== null || experienceState.state === 'RUNNING' || experienceState.state === 'STOPPING'} />

      <section className="nature-card-grid" aria-label="Choose a nature experience">
        {cards.map((card) => {
          const active = (realMode ? firmwareState.experience.selectedExperienceId : activeExperienceId) === card.id
          return (
            <NatureVideoCard
              key={card.id}
              {...card}
              active={active}
              previewPlaying={active && dialogExperienceId === null}
              disabled={
                (realMode && !firmwareState.simulationTestArmed) ||
                (realMode && deviceBusy) ||
                switchingExperienceId !== null ||
                (realMode ? !canSwitchExperience : (!active && !canSwitchExperience))
              }
              onSelect={() => void selectExperience(card.id)}
              onReplay={() => realMode ? void selectExperience(card.id) : setDialogExperienceId(card.id)}
            />
          )
        })}
      </section>

      <p role="alert">
        {actionError}
      </p>

      {dialogCard && (
        <div
          className="experience-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={`${dialogCard.label} experience video`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialogExperienceId(null)
          }}
        >
          <button
            className="experience-dialog__close"
            type="button"
            aria-label="Close experience video"
            autoFocus
            onClick={() => setDialogExperienceId(null)}
          >
            ×
          </button>
          {dialogCard.previewVideo ? (
            <video
              className="experience-dialog__video"
              src={dialogCard.previewVideo}
              poster={dialogCard.poster}
              autoPlay
              controls
              playsInline
            />
          ) : (
            <>
              <img className="experience-dialog__poster" src={dialogCard.poster} alt="" />
              <p className="experience-dialog__message" lang="ja">
                このモードの体験動画は未提供です。
              </p>
            </>
          )}
        </div>
      )}
    </main>
  )
}
