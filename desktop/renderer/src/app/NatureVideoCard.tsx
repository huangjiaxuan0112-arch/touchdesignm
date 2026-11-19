import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

export interface NatureVideoCardProps {
  id: 'WIND' | 'WAVE' | 'BUBBLE'
  label: string
  title: string
  description: string
  poster: string
  previewVideo?: string
  active: boolean
  focused: boolean
  dimmed: boolean
  previewPlaying: boolean
  disabled?: boolean
  onFocusPreview: () => void
  onLeavePreview: () => void
  onSelect: () => void
}

export function NatureVideoCard({ id, label, title, description, poster, previewVideo,
  active, focused, dimmed, previewPlaying, disabled = false,
  onFocusPreview, onLeavePreview, onSelect }: NatureVideoCardProps) {
  const video = useRef<HTMLVideoElement>(null)
  const wanted = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const [hasPreview, setHasPreview] = useState(false)
  const reducedMotion = useReducedMotion()
  const playing = previewPlaying && !reducedMotion

  useEffect(() => { if (playing) setHasPreview(true) }, [playing])
  useEffect(() => {
    const element = video.current
    wanted.current = playing
    if (!element) return
    if (!playing) { element.pause(); return }
    setStatus('loading')
    void element.play().catch((error: DOMException) => {
      if (wanted.current && error.name !== 'AbortError') setStatus('error')
    })
    return () => { wanted.current = false; element.pause() }
  }, [playing, hasPreview, previewVideo])

  const badge = playing ? (status === 'error' ? 'プレビューを読み込めません' : status === 'playing' ? 'プレビュー中' : '読み込み中') : null
  return (
    <motion.button
      className={`nature-card${active ? ' nature-card--active' : ''}`}
      type="button" aria-label={`Open ${label}, ${title}`} aria-pressed={active}
      disabled={disabled} data-experience={id}
      animate={{
        scale: focused && !reducedMotion ? 1.015 : 1,
        filter: dimmed ? 'grayscale(10%)' : 'grayscale(0%)',
        opacity: dimmed ? .96 : 1,
      }}
      transition={{ duration: reducedMotion ? 0 : .35, ease: 'easeOut' }}
      style={{ zIndex: focused ? 2 : 1 }}
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') onFocusPreview() }}
      onPointerLeave={onLeavePreview}
      onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) onFocusPreview() }} onBlur={onLeavePreview}
      onClick={() => { onLeavePreview(); onSelect() }}
    >
      <div className="nature-card__media">
        <img className="nature-card__poster" src={poster} alt="" />
        {hasPreview && previewVideo && (
          <motion.video ref={video} className="nature-card__video" src={previewVideo}
            poster={poster} muted loop playsInline preload="metadata" aria-hidden="true"
            initial={{ opacity: 0 }} animate={{ opacity: playing && loaded && status === 'playing' ? 1 : 0 }}
            transition={{ duration: reducedMotion ? 0 : .38, ease: 'easeOut' }}
            onLoadedData={() => setLoaded(true)}
            onPlaying={() => { if (wanted.current) setStatus('playing'); else video.current?.pause() }}
            onWaiting={() => { if (wanted.current) setStatus('loading') }}
            onError={() => setStatus('error')}
            onAnimationComplete={() => { if (!wanted.current && video.current) video.current.currentTime = 0 }}
          />
        )}
      </div>
      <span className="nature-card__shade" aria-hidden="true" />
      <AnimatePresence>
        {badge && <motion.span className="nature-card__playing" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><i aria-hidden="true" />{badge}</motion.span>}
      </AnimatePresence>
      <span className="nature-card__copy">
        <span className="nature-card__label">{label}</span>
        <span className="nature-card__title" lang="ja">{title}</span>
        <span className="nature-card__rule" aria-hidden="true" />
        <span className="nature-card__description" lang="ja">{description}</span>
      </span>
    </motion.button>
  )
}
