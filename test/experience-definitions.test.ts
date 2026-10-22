import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EXPERIENCE_DEFINITIONS,
  LEGACY_BUBBLE_POP_TIMES_MS,
  type ExperienceAction,
} from '../desktop/shared/experience-definitions'

function actionsFor(experience: 'WIND' | 'WAVE' | 'BUBBLE'): ExperienceAction[] {
  return EXPERIENCE_DEFINITIONS[experience].timeline.filter(
    (event): event is ExperienceAction => event.kind === 'ACTION',
  )
}

test('experience cycle durations match the original delay sums', () => {
  assert.equal(EXPERIENCE_DEFINITIONS.WIND.totalDurationMs, 24_000)
  assert.equal(EXPERIENCE_DEFINITIONS.WAVE.totalDurationMs, 25_000)
  assert.equal(EXPERIENCE_DEFINITIONS.BUBBLE.totalDurationMs, 27_420)
})

test('wind and wave preserve the original ordered action durations', () => {
  assert.deepEqual(
    actionsFor('WIND').map(({ action, durationMs }) => [action, durationMs]),
    [
      ['INFLATE', 5000], ['DEFLATE', 1500], ['INFLATE', 1300],
      ['DEFLATE', 1450], ['INFLATE', 1050], ['DEFLATE', 1900],
      ['INFLATE', 1600], ['DEFLATE', 1750], ['INFLATE', 1450],
      ['DEFLATE', 1050], ['INFLATE', 950], ['DEFLATE', 5000],
    ],
  )
  assert.deepEqual(
    actionsFor('WAVE').map(({ action, durationMs }) => [action, durationMs]),
    [
      ['INFLATE', 5000], ['DEFLATE', 2000], ['INFLATE', 2500],
      ['DEFLATE', 2000], ['INFLATE', 2500], ['DEFLATE', 2000],
      ['INFLATE', 2500], ['DEFLATE', 1000], ['INFLATE', 500],
      ['DEFLATE', 5000],
    ],
  )
})

test('all generated actions preserve the original D5/D6/D7 signal values', () => {
  for (const experience of Object.values(EXPERIENCE_DEFINITIONS)) {
    for (const event of experience.timeline) {
      if (event.kind !== 'ACTION') continue
      assert.deepEqual(
        event.servoWrites,
        event.action === 'INFLATE'
          ? { D5: 180, D6: 180, D7: 0 }
          : { D5: 0, D6: 0, D7: 180 },
      )
    }
  }
})

test('bubble definition retains all source timestamps and stops events at 20 seconds', () => {
  assert.equal(EXPERIENCE_DEFINITIONS.BUBBLE.legacySourcePopTimesMs?.length, 28)
  assert.equal(LEGACY_BUBBLE_POP_TIMES_MS[13], 18_620)
  assert.equal(LEGACY_BUBBLE_POP_TIMES_MS[14], 20_590)
  assert.equal(actionsFor('BUBBLE').filter(({ action }) => action === 'DEFLATE').length, 15)
  assert.equal(actionsFor('BUBBLE').filter(({ action }) => action === 'INFLATE').length, 16)
  assert.equal(actionsFor('BUBBLE').at(-2)?.durationMs, 759)
})