import { useEffect, useState } from 'react'

export interface NatureVideoCardProps {
  id: 'WIND' | 'WAVE' | 'BUBBLE'
  label: string
  title: string
  description: string
  poster: string
  previewVideo?: string
  active: boolean
  previewPlaying: boolean
  disabled?: boolean
  onSelect: () => void
  onReplay: () => void
}

export function NatureVideoCard({
  id,
  label,
  title,
  description,
  poster,
  previewVideo,
  active,
  previewPlaying,
  disabled = false,
  onSelect,
  onReplay,
}: NatureVideoCardProps) {
  const [videoReady, setVideoReady] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)

  useEffect(() => {
    setVideoReady(false)
    setVideoFailed(false)
  }, [previewVideo, previewPlaying])

  function activateCard(): void {
    if (active) onReplay()
    else onSelect()
  }

  return (
    <button
      className={`nature-card${active ? ' nature-card--active' : ''}`}
      type="button"
      aria-label={active
        ? `${label}, ${title}. Replay experience video`
        : `Select ${label}, ${title}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={activateCard}
      data-experience={id}
    >
      <img className="nature-card__poster" src={poster} alt="" />
      {previewPlaying && previewVideo && !videoFailed && (
        <video
          className={`nature-card__video${videoReady ? ' nature-card__video--ready' : ''}`}
          src={previewVideo}
          poster={poster}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          aria-hidden="true"
          onLoadedData={() => setVideoReady(true)}
          onError={() => setVideoFailed(true)}
        />
      )}
      <span className="nature-card__shade" aria-hidden="true" />
      {active && <span className="nature-card__playing">再生中</span>}
      <span className="nature-card__copy">
        <span className="nature-card__label">{label}</span>
        <span className="nature-card__title" lang="ja">{title}</span>
        <span className="nature-card__description" lang="ja">{description}</span>
      </span>
    </button>
  )
}
