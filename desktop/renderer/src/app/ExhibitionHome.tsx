import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import { ExperiencePlayer } from './ExperiencePlayer'
import { selectExperienceIntent, startSelectedExperience } from './start-selected-experience'
import type { ExperienceSnapshot } from '../../../shared/experience-control-protocol'
import type { ExhibitionLifecycleSnapshot } from '../../../shared/exhibition-lifecycle'
import { EXPERIENCE_DISPLAY_NAMES, type ExperienceId } from '../../../shared/experience-definitions'
import { NatureVideoCard } from './NatureVideoCard'
import windPoster from '../assets/wind/wind-poster.png'
import wavePoster from '../assets/waves/waves-poster.png'
import bubblePoster from '../assets/bubbles/bubbles-poster.png'
import windPreviewVideo from '../assets/wind/wind-preview.mp4'
import windExperienceVideo from '../../../../卒研music/wind/东风长3_15秒音视频合成.mp4'
import wavesPreviewVideo from '../assets/waves/waves-preview.mp4'
import wavesExperienceVideo from '../assets/waves/waves-experience.mp4'
import bubblesPreviewVideo from '../assets/bubbles/bubbles-preview.mp4'
import bubblesExperienceVideo from '../assets/bubbles/bubbles-experience.mp4'

const cards: Array<{
  id: ExperienceId
  label: string
  title: string
  description: string
  poster: string
  previewVideo?: string
  experienceVideo: string
}> = [
  {
    id: 'WIND',
    label: EXPERIENCE_DISPLAY_NAMES.WIND,
    title: '風',
    description: 'ゆっくり、やさしく流れる。',
    poster: windPoster,
    previewVideo: windPreviewVideo,
    experienceVideo: windExperienceVideo,
  },
  {
    id: 'WAVE',
    label: EXPERIENCE_DISPLAY_NAMES.WAVE,
    title: '波',
    description: '寄せては返す、穏やかなリズム。',
    poster: wavePoster,
    previewVideo: wavesPreviewVideo,
    experienceVideo: wavesExperienceVideo,
  },
  {
    id: 'BUBBLE',
    label: EXPERIENCE_DISPLAY_NAMES.BUBBLE,
    title: '泡',
    description: '小さく弾ける、軽やかな感覚。',
    poster: bubblePoster,
    previewVideo: bubblesPreviewVideo,
    experienceVideo: bubblesExperienceVideo,
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

const initialExhibitionState: ExhibitionLifecycleSnapshot = {
  revision: 0,
  phase: 'READY',
  experienceId: null,
  operationId: null,
  faultCode: null,
}

export default function ExhibitionHome() {
  const [experienceState, setExperienceState] = useState(initialExperienceState)
  const [exhibitionState, setExhibitionState] = useState(initialExhibitionState)
  const [activeExperienceId, setActiveExperienceId] = useState<ExperienceId>('WIND')
  const [switchingExperienceId, setSwitchingExperienceId] = useState<ExperienceId | null>(null)
  const [dialogExperienceId, setDialogExperienceId] = useState<ExperienceId | null>(null)
  const [actionError, setActionError] = useState('')
  const [focusedId, setFocusedId] = useState<ExperienceId | null>(null)
  const [previewId, setPreviewId] = useState<ExperienceId | null>(null)
  const [visible, setVisible] = useState(!document.hidden)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingStart = useRef<Promise<ExperienceSnapshot> | null>(null)
  const snapshotRevision = useRef(-1)
  const exhibitionRevision = useRef(-1)
  const selecting = useRef(false)
  const reducedMotion = useReducedMotion()

  function clearPreview() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    setFocusedId(null)
    setPreviewId(null)
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
    let unsubscribeExhibition: (() => void) | undefined
    let unsubscribeExperience: (() => void) | undefined
    if (!api) return

    void api.subscribeExhibition(snapshot => {
      if (!mounted || snapshot.revision <= exhibitionRevision.current) return
      exhibitionRevision.current = snapshot.revision
      setExhibitionState(snapshot)
      if (snapshot.experienceId) setActiveExperienceId(snapshot.experienceId)
      if (snapshot.phase === 'READY' || snapshot.phase === 'FAULT') {
        setSwitchingExperienceId(null)
      }
    }).then(removeListener => {
      if (mounted) unsubscribeExhibition = removeListener
      else removeListener()
    }).catch((error: unknown) => {
      if (mounted) setActionError(error instanceof Error ? error.message : String(error))
    })

    void api.subscribeExperience('mock', (event) => {
      if (!mounted) return
      if (event.snapshot.revision <= snapshotRevision.current) return
      snapshotRevision.current = event.snapshot.revision
      const snapshot = event.snapshot.experience
      setExperienceState(snapshot)
      if (snapshot.selectedExperienceId) setActiveExperienceId(snapshot.selectedExperienceId)
    }).then((removeListener) => {
      if (mounted) unsubscribeExperience = removeListener
      else removeListener()
    }).catch((error: unknown) => {
      if (mounted) setActionError(error instanceof Error ? error.message : String(error))
    })

    return () => {
      mounted = false
      unsubscribeExhibition?.()
      unsubscribeExperience?.()
    }
  }, [])

  function startMediaExperience(): Promise<ExperienceSnapshot> {
    if (pendingStart.current) return pendingStart.current
    if (!dialogExperienceId) return Promise.reject(new Error('Select an experience first.'))
    const request = (async () => {
      if (!window.natureTouch) throw new Error('The exhibition requires the Electron application.')
      const operationId = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      return startSelectedExperience(
        window.natureTouch,
        'mock',
        operationId,
      )
    })().finally(() => { pendingStart.current = null })
    pendingStart.current = request
    return request
  }

  async function selectExperience(experienceId: ExperienceId, openVideo = false): Promise<void> {
    if (selecting.current || exhibitionState.phase !== 'READY') return
    selecting.current = true
    const api = window.natureTouch
    if (!api) {
      setActionError('The exhibition requires the Electron application.')
      selecting.current = false
      return
    }
    setSwitchingExperienceId(experienceId)
    setActionError('')
    try {
      const selected = await selectExperienceIntent(api, 'mock', experienceId)
      if (selected.revision >= snapshotRevision.current) {
        snapshotRevision.current = selected.revision
        const snapshot = selected.experience
        setActiveExperienceId(snapshot.selectedExperienceId ?? experienceId)
        setExperienceState(snapshot)
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
  const selectedExperienceId = exhibitionState.experienceId ?? experienceState.selectedExperienceId ?? activeExperienceId
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
                exhibitionState.phase !== 'READY' ||
                dialogExperienceId !== null ||
                switchingExperienceId !== null
              }
              onSelect={() => void selectExperience(card.id, !!card.experienceVideo)}
            />
          )
        })}
      </section>

      <p className="exhibition-alert" role="alert">
        {actionError}
      </p>

      <footer className="exhibition-footer">
        <p className="exhibition-footer__device">ソフトウェア再生（実機出力なし）</p>
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
          runState={experienceState}
          exhibitionState={exhibitionState}
          deviceLabel="ソフトウェア再生 · 実機出力なし"
          onStart={startMediaExperience}
          onExit={() => setDialogExperienceId(null)} />}
      </AnimatePresence>
    </main>
  )
}
