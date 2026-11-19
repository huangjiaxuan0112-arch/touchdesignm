import type { ExperienceId } from '../../../shared/experience-definitions'
import { PROJECTOR_DURATION_MS } from '../../../shared/projector'
import wind from '../assets/projector/candidate-25s/wind-25s-silent.mp4?url'
import wave from '../assets/projector/candidate-25s/wave-25s-silent.mp4?url'
import bubble from '../assets/projector/candidate-25s/bubble-25s-silent.mp4?url'

export const PROJECTOR_MEDIA: Readonly<Record<ExperienceId, { src: string; durationMs: number }>> = {
  WIND: { src: wind, durationMs: PROJECTOR_DURATION_MS },
  WAVE: { src: wave, durationMs: PROJECTOR_DURATION_MS },
  BUBBLE: { src: bubble, durationMs: PROJECTOR_DURATION_MS },
}
