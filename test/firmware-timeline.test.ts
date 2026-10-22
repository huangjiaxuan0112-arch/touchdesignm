import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  EXPERIENCE_DEFINITIONS,
  type ExperienceAction,
  type ExperienceId,
} from '../desktop/shared/experience-definitions'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const timelineHeader = readFileSync(
  join(testDirectory, '../firmware/unified/nature_touch_unified/experience-timelines.h'),
  'utf8',
)
const firmwareSource = readFileSync(
  join(testDirectory, '../firmware/unified/nature_touch_unified/nature_touch_unified.ino'),
  'utf8',
)

function firmwareActions(experienceId: ExperienceId): ExperienceAction[] {
  const arrayName = `${experienceId}_ACTIONS`
  const array = timelineHeader.match(
    new RegExp(`static const ScheduledAction ${arrayName}\\[\\] PROGMEM = \\{([\\s\\S]*?)\\};`),
  )
  assert.ok(array, `Missing ${arrayName} firmware timeline`)
  const actions = [...array[1].matchAll(/\{\s*(\d+)\s*,\s*([01])\s*\}/g)]
  return actions.map(([, duration, inflate], index): ExperienceAction => ({
    kind: 'ACTION',
    atMs: 0,
    action: inflate === '1' ? 'INFLATE' : 'DEFLATE',
    durationMs: Number(duration),
    servoWrites: inflate === '1'
      ? { D5: 180, D6: 180, D7: 0 }
      : { D5: 0, D6: 0, D7: 180 },
  })).map((action, index) => ({ ...action, atMs: index }))
}

test('unified firmware action timelines exactly match all source-derived definitions', () => {
  for (const experienceId of ['WIND', 'WAVE', 'BUBBLE'] as const) {
    const expected = EXPERIENCE_DEFINITIONS[experienceId].timeline.filter(
      (event): event is ExperienceAction => event.kind === 'ACTION',
    )
    const actual = firmwareActions(experienceId)
    assert.deepEqual(
      actual.map(({ action, durationMs, servoWrites }) => [action, durationMs, servoWrites]),
      expected.map(({ action, durationMs, servoWrites }) => [action, durationMs, servoWrites]),
      `${experienceId} sequence differs from its calibrated source timeline`,
    )
    assert.equal(
      actual.reduce((duration, action) => duration + action.durationMs, 0),
      EXPERIENCE_DEFINITIONS[experienceId].totalDurationMs,
      `${experienceId} source duration differs`,
    )
  }
  assert.equal(EXPERIENCE_DEFINITIONS.BUBBLE.totalDurationMs, 27_420)
})

test('simulation firmware contains no actuator libraries, pin writes, or blocking delays', () => {
  assert.doesNotMatch(firmwareSource, /#include\s*[<"]Servo\.h[>"]/)
  assert.doesNotMatch(firmwareSource, /\.attach\s*\(|\bpinMode\s*\(|\bdigitalWrite\s*\(|\banalogWrite\s*\(|\bdelay\s*\(/)
  assert.match(firmwareSource, /hardwareOutputsEnabled\\?"?:false/)
})
