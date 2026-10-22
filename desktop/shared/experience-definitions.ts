export const EXPERIENCE_IDS = ['WIND', 'WAVE', 'BUBBLE'] as const

export type ExperienceId = (typeof EXPERIENCE_IDS)[number]
export type LegacyServoValue = 0 | 180

export interface LegacyServoWrites {
  D5: LegacyServoValue
  D6: LegacyServoValue
  D7: LegacyServoValue
}

export interface ExperienceAction {
  kind: 'ACTION'
  atMs: number
  action: 'INFLATE' | 'DEFLATE'
  durationMs: number
  servoWrites: LegacyServoWrites
}

export interface ExperienceMarker {
  kind: 'MARKER'
  atMs: number
  text: string
}

export type ExperienceTimelineEvent = ExperienceAction | ExperienceMarker

export interface ExperienceDefinition {
  id: ExperienceId
  name: string
  sourceSketch: string
  totalDurationMs: number
  timeline: ExperienceTimelineEvent[]
  legacySourcePopTimesMs?: readonly number[]
}

const INFLATE_WRITES: LegacyServoWrites = { D5: 180, D6: 180, D7: 0 }
const DEFLATE_WRITES: LegacyServoWrites = { D5: 0, D6: 0, D7: 180 }

function marker(atMs: number, text: string): ExperienceMarker {
  return { kind: 'MARKER', atMs, text }
}

function action(
  atMs: number,
  type: 'INFLATE' | 'DEFLATE',
  durationMs: number,
): ExperienceAction {
  return {
    kind: 'ACTION',
    atMs,
    action: type,
    durationMs,
    servoWrites: type === 'INFLATE' ? { ...INFLATE_WRITES } : { ...DEFLATE_WRITES },
  }
}

const windTimeline: ExperienceTimelineEvent[] = []
let windTime = 0
windTimeline.push(marker(windTime, 'INITIAL FILL'), action(windTime, 'INFLATE', 5000))
windTime += 5000
windTimeline.push(marker(windTime, 'PLAY WIND AUDIO NOW'))
for (const [deflateMs, inflateMs] of [
  [1500, 1300],
  [1450, 1050],
  [1900, 1600],
  [1750, 1450],
  [1050, 950],
] as const) {
  windTimeline.push(action(windTime, 'DEFLATE', deflateMs))
  windTime += deflateMs
  windTimeline.push(action(windTime, 'INFLATE', inflateMs))
  windTime += inflateMs
}
windTimeline.push(marker(windTime, 'FINAL SHRINK'), action(windTime, 'DEFLATE', 5000))
windTime += 5000
windTimeline.push(marker(windTime, 'NEXT WIND CYCLE'))

const waveTimeline: ExperienceTimelineEvent[] = []
let waveTime = 0
waveTimeline.push(marker(waveTime, 'INITIAL FILL'), action(waveTime, 'INFLATE', 5000))
waveTime += 5000
waveTimeline.push(marker(waveTime, 'PLAY WAVE AUDIO NOW'))
for (let wave = 0; wave < 3; wave += 1) {
  waveTimeline.push(action(waveTime, 'DEFLATE', 2000))
  waveTime += 2000
  waveTimeline.push(action(waveTime, 'INFLATE', 2500))
  waveTime += 2500
}
waveTimeline.push(action(waveTime, 'DEFLATE', 1000))
waveTime += 1000
waveTimeline.push(action(waveTime, 'INFLATE', 500))
waveTime += 500
waveTimeline.push(marker(waveTime, 'FINAL SHRINK'), action(waveTime, 'DEFLATE', 5000))
waveTime += 5000
waveTimeline.push(marker(waveTime, 'NEXT WAVE CYCLE'))

export const LEGACY_BUBBLE_POP_TIMES_MS = [
  580, 2040, 3530, 5510,
  7400, 9400, 11230,
  13050, 13550, 15920,
  16680, 17520, 18080,
  18620, 20590, 21490,
  22490, 23550, 24220,
  26080, 27120, 27860,
  28400, 30370, 31370,
  31770, 32690, 33040,
] as const

const BUBBLE_MUSIC_LENGTH_MS = 20000
const BUBBLE_OUT_PERCENT = 45
const bubbleTimeline: ExperienceTimelineEvent[] = []
let bubbleTime = 0
bubbleTimeline.push(action(bubbleTime, 'INFLATE', 4420))
bubbleTime += 4420
bubbleTimeline.push(marker(bubbleTime, 'PLAY AUDIO NOW'))
bubbleTimeline.push(action(bubbleTime, 'INFLATE', 580))
bubbleTime += 580
bubbleTimeline.push(marker(bubbleTime, 'BUBBLE START'))

for (let index = 0; index < LEGACY_BUBBLE_POP_TIMES_MS.length; index += 1) {
  const popTime = LEGACY_BUBBLE_POP_TIMES_MS[index]
  if (popTime >= BUBBLE_MUSIC_LENGTH_MS) break

  const nextPopTime = LEGACY_BUBBLE_POP_TIMES_MS[index + 1] ?? BUBBLE_MUSIC_LENGTH_MS
  const intervalEnd = Math.min(nextPopTime, BUBBLE_MUSIC_LENGTH_MS)
  const intervalMs = intervalEnd - popTime
  const outMs = Math.floor((intervalMs * BUBBLE_OUT_PERCENT) / 100)
  const inMs = intervalMs - outMs

  bubbleTimeline.push(action(bubbleTime, 'DEFLATE', outMs))
  bubbleTime += outMs
  bubbleTimeline.push(action(bubbleTime, 'INFLATE', inMs))
  bubbleTime += inMs
}

bubbleTimeline.push(marker(bubbleTime, 'FINAL SHRINK'), action(bubbleTime, 'DEFLATE', 3000))
bubbleTime += 3000
bubbleTimeline.push(marker(bubbleTime, 'NEXT ROUND'))

export const EXPERIENCE_DEFINITIONS: Readonly<Record<ExperienceId, ExperienceDefinition>> = {
  WIND: {
    id: 'WIND',
    name: 'Wind',
    sourceSketch: '卒研music/wind/sketch_oct21a/sketch_oct21a.ino',
    totalDurationMs: windTime,
    timeline: windTimeline,
  },
  WAVE: {
    id: 'WAVE',
    name: 'Ocean Waves',
    sourceSketch: '卒研music/ocean waves/sketch_oct21b/sketch_oct21b.ino',
    totalDurationMs: waveTime,
    timeline: waveTimeline,
  },
  BUBBLE: {
    id: 'BUBBLE',
    name: 'Bubbles',
    sourceSketch: '卒研music/bubbles/sketch_sep30a/sketch_oct21a/sketch_oct21a.ino',
    totalDurationMs: bubbleTime,
    timeline: bubbleTimeline,
    legacySourcePopTimesMs: LEGACY_BUBBLE_POP_TIMES_MS,
  },
}