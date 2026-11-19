export const EXPERIENCE_IDS = ['WIND', 'WAVE', 'BUBBLE'] as const

const waitingMs = 10_000
const experienceMs = 15_000
const finalDeflateMs = 5_000
export const EXHIBITION_TIMING = {
  waitingMs,
  experienceMs,
  cooldownMs: 3_000,
  mockDeviceCompletionMs: waitingMs + experienceMs + finalDeflateMs,
} as const

export type ExperienceId = (typeof EXPERIENCE_IDS)[number]
export const EXPERIENCE_DISPLAY_NAMES = {
  WIND: 'WIND',
  WAVE: 'WAVES',
  BUBBLE: 'BUBBLES',
} as const satisfies Readonly<Record<ExperienceId, string>>
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

// 30s OFFLINE CANDIDATE: source of truth remains the reviewed Arduino action table.
// These arrays mirror proposed segments for Mock/diagnostic UI only.
function buildCandidateTimeline(
  actions: readonly (readonly [number, 'INFLATE' | 'DEFLATE'])[],
  completionMarker: string,
): ExperienceTimelineEvent[] {
  const events: ExperienceTimelineEvent[] = []
  let at = 0
  events.push(marker(0, 'INITIAL FILL'))
  for (const [duration, type] of actions) {
    if (at === waitingMs) events.push(marker(at, 'EXPERIENCE START'))
    if (at === waitingMs + experienceMs) events.push(marker(at, 'FINAL SHRINK'))
    events.push(action(at, type, duration))
    at += duration
  }
  events.push(marker(at, completionMarker))
  return events
}

const WIND_CANDIDATE = [
  // WIND: five DRAIN/FILL pairs from the 25s baseline.
  [waitingMs, 'INFLATE'],
  [1600, 'DEFLATE'], [1400, 'INFLATE'],
  [1550, 'DEFLATE'], [1150, 'INFLATE'],
  [2000, 'DEFLATE'], [1700, 'INFLATE'],
  [1850, 'DEFLATE'], [1550, 'INFLATE'],
  [1150, 'DEFLATE'], [1050, 'INFLATE'],
  [finalDeflateMs, 'DEFLATE'],
] as const
const WAVE_CANDIDATE = [
  [waitingMs, 'INFLATE'],
  [2000, 'DEFLATE'], [2500, 'INFLATE'],
  [2000, 'DEFLATE'], [2500, 'INFLATE'],
  [2000, 'DEFLATE'], [2500, 'INFLATE'],
  [1000, 'DEFLATE'], [500, 'INFLATE'],
  [finalDeflateMs, 'DEFLATE'],
] as const

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

// Original BUBBLE music/pop values above remain exported only for historical comparison.
// This proposal replaces 14 rapid pop pairs with six longer irregular pairs because
// many original segments had no theoretical pump-on window with 500/300ms switching.
// Rhythm is a CONCEPT: physically unverified and not approved for real operation.
const BUBBLE_CANDIDATE = [
  [waitingMs, 'INFLATE'],
  [1080, 'DEFLATE'], [1320, 'INFLATE'],
  [1215, 'DEFLATE'], [1485, 'INFLATE'],
  [967, 'DEFLATE'], [1183, 'INFLATE'],
  [1282, 'DEFLATE'], [1568, 'INFLATE'],
  [1102, 'DEFLATE'], [1348, 'INFLATE'],
  [1102, 'DEFLATE'], [1348, 'INFLATE'],
  [finalDeflateMs, 'DEFLATE'],
] as const
const windTimeline = buildCandidateTimeline(WIND_CANDIDATE, 'NEXT WIND CYCLE')
const waveTimeline = buildCandidateTimeline(WAVE_CANDIDATE, 'NEXT WAVE CYCLE')
const bubbleTimeline = buildCandidateTimeline(BUBBLE_CANDIDATE, 'NEXT ROUND')

export const EXPERIENCE_DEFINITIONS: Readonly<Record<ExperienceId, ExperienceDefinition>> = {
  WIND: {
    id: 'WIND',
    name: 'Wind',
    sourceSketch: '卒研music/wind/sketch_oct21a/sketch_oct21a.ino',
    totalDurationMs: EXHIBITION_TIMING.mockDeviceCompletionMs,
    timeline: windTimeline,
  },
  WAVE: {
    id: 'WAVE',
    name: 'Ocean Waves',
    sourceSketch: '卒研music/ocean waves/sketch_oct21b/sketch_oct21b.ino',
    totalDurationMs: EXHIBITION_TIMING.mockDeviceCompletionMs,
    timeline: waveTimeline,
  },
  BUBBLE: {
    id: 'BUBBLE',
    name: 'Bubbles',
    sourceSketch: '卒研music/bubbles/sketch_sep30a/sketch_oct21a/sketch_oct21a.ino',
    totalDurationMs: EXHIBITION_TIMING.mockDeviceCompletionMs,
    timeline: bubbleTimeline,
    legacySourcePopTimesMs: LEGACY_BUBBLE_POP_TIMES_MS,
  },
}
