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

test('candidate experience cycle durations are 30 seconds in every mode', () => {
  assert.equal(EXPERIENCE_DEFINITIONS.WIND.totalDurationMs, 30_000)
  assert.equal(EXPERIENCE_DEFINITIONS.WAVE.totalDurationMs, 30_000)
  assert.equal(EXPERIENCE_DEFINITIONS.BUBBLE.totalDurationMs, 30_000)
})

test('WIND and WAVE preserve all ordered rhythm pairs from the 25s baseline', () => {
  assert.deepEqual(
    actionsFor('WIND').map(({ action, durationMs }) => [action, durationMs]),
    [
      ['INFLATE', 10000], ['DEFLATE', 1600], ['INFLATE', 1400],
      ['DEFLATE', 1550], ['INFLATE', 1150], ['DEFLATE', 2000],
      ['INFLATE', 1700], ['DEFLATE', 1850], ['INFLATE', 1550],
      ['DEFLATE', 1150], ['INFLATE', 1050], ['DEFLATE', 5000],
    ],
  )
  assert.deepEqual(
    actionsFor('WAVE').map(({ action, durationMs }) => [action, durationMs]),
    [
      ['INFLATE', 10000], ['DEFLATE', 2000], ['INFLATE', 2500],
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

test('D5 diagnostic values identify the RC5 fill and drain routes', () => {
  for (const experience of Object.values(EXPERIENCE_DEFINITIONS)) {
    for (const event of experience.timeline) {
      if (event.kind === 'ACTION') assert.equal(event.servoWrites.D5, event.action === 'INFLATE' ? 180 : 0)
    }
  }
})

test('bubble candidate has six proposed software-only pairs and retains historical timestamps for comparison', () => {
  assert.equal(EXPERIENCE_DEFINITIONS.BUBBLE.legacySourcePopTimesMs?.length, 28)
  assert.equal(LEGACY_BUBBLE_POP_TIMES_MS[13], 18_620)
  assert.equal(LEGACY_BUBBLE_POP_TIMES_MS[14], 20_590)
  assert.equal(actionsFor('BUBBLE').filter(({ action }) => action === 'DEFLATE').length, 7)
  assert.equal(actionsFor('BUBBLE').filter(({ action }) => action === 'INFLATE').length, 7)
  assert.equal(actionsFor('BUBBLE').at(-2)?.durationMs, 1348)
})
// Explicit design data, not a physical acceptance statement.
test('BUBBLE candidate preserves all six proposed ordered pairs', () => {
  assert.deepEqual(actionsFor('BUBBLE').map(a => [a.action, a.durationMs]), [
    ['INFLATE', 10000], ['DEFLATE',1080], ['INFLATE',1320],
    ['DEFLATE',1215], ['INFLATE',1485], ['DEFLATE',967], ['INFLATE',1183],
    ['DEFLATE',1282], ['INFLATE',1568], ['DEFLATE',1102], ['INFLATE',1348],
    ['DEFLATE',1102], ['INFLATE',1348], ['DEFLATE',5000],
  ])
})

test('candidate markers and contiguous actions agree at 0, 10, 25 and 30 seconds', () => {
  for (const definition of Object.values(EXPERIENCE_DEFINITIONS)) {
    let end = 0
    for (const a of actionsFor(definition.id)) {
      assert.equal(a.atMs, end)
      end += a.durationMs
    }
    assert.equal(end, 30_000)
    assert.deepEqual(definition.timeline.filter(e => e.kind === 'MARKER').map(e => [e.atMs,e.text]), [
      [0,'INITIAL FILL'],[10000,'EXPERIENCE START'],[25000,'FINAL SHRINK'],
      [30000, { WIND:'NEXT WIND CYCLE', WAVE:'NEXT WAVE CYCLE', BUBBLE:'NEXT ROUND' }[definition.id]],
    ])
  }
})
