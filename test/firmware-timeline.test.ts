import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { EXHIBITION_TIMING } from '../desktop/shared/exhibition-lifecycle'
import { PROJECTOR_DURATION_MS } from '../desktop/shared/projector'
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
  let atMs = 0
  return actions.map(([, duration, inflate]): ExperienceAction => {
    const action: ExperienceAction = {
      kind: 'ACTION',
      atMs,
      action: inflate === '1' ? 'INFLATE' : 'DEFLATE',
      durationMs: Number(duration),
      servoWrites: inflate === '1'
        ? { D5: 180, D6: 180, D7: 0 }
        : { D5: 0, D6: 0, D7: 180 },
    }
    atMs += action.durationMs
    return action
  })
}

test('unified candidate action timelines exactly match the proposed TS mirror', () => {
  for (const experienceId of ['WIND', 'WAVE', 'BUBBLE'] as const) {
    const expected = EXPERIENCE_DEFINITIONS[experienceId].timeline.filter(
      (event): event is ExperienceAction => event.kind === 'ACTION',
    )
    const actual = firmwareActions(experienceId)
    assert.deepEqual(
      actual,
      expected,
      `${experienceId} sequence differs from its proposed candidate timeline`,
    )
    assert.equal(
      actual.reduce((duration, action) => duration + action.durationMs, 0),
      EXPERIENCE_DEFINITIONS[experienceId].totalDurationMs,
      `${experienceId} source duration differs`,
    )
  }
  assert.equal(EXPERIENCE_DEFINITIONS.BUBBLE.totalDurationMs, 30_000)
})

test('all candidate phase boundaries align with Main, Projector and Mock timing', () => {
  const { waitingMs, experienceMs, mockDeviceCompletionMs, cooldownMs } = EXHIBITION_TIMING
  assert.deepEqual([waitingMs, experienceMs, PROJECTOR_DURATION_MS, mockDeviceCompletionMs, cooldownMs],
    [10_000, 15_000, 25_000, 30_000, 3_000])
  for (const definition of Object.values(EXPERIENCE_DEFINITIONS)) {
    const [start, experience, deflate, completed] = definition.timeline.filter(event => event.kind === 'MARKER')
    assert.deepEqual([start.atMs, experience.atMs, deflate.atMs, completed.atMs],
      [0, waitingMs, waitingMs + experienceMs, mockDeviceCompletionMs])
    assert.equal(deflate.atMs, PROJECTOR_DURATION_MS)
    assert.equal(definition.totalDurationMs, completed.atMs)
    assert.equal(completed.atMs + cooldownMs, 33_000)
  }
})

test('simulation firmware contains no actuator libraries, pin writes, or blocking delays', () => {
  const actuatorSource = readFileSync(
    join(testDirectory, '../firmware/unified/nature_touch_unified/simulated-actuators.h'),
    'utf8',
  )
  const implementation = `${firmwareSource}\n${actuatorSource}`
  const selector = readFileSync(join(testDirectory, '../firmware/unified/nature_touch_unified/actuator-driver.h'), 'utf8')
  assert.match(firmwareSource, /#include "actuator-driver\.h"/)
  assert.match(selector, /namespace Actuators = ActuatorSimulation;/)
  assert.match(selector, /#if NATURE_TOUCH_ACTUATOR_DRIVER == 1\s+#include "real-actuators\.h"\s+static_assert\(RealActuators::CONFIGURATION_VERIFIED,/)
  assert.match(selector, /#elif NATURE_TOUCH_ACTUATOR_DRIVER == 0\s+#include "simulated-actuators\.h"/)
  assert.doesNotMatch(implementation, /#include\s*[<"]Servo\.h[>"]/)
  assert.doesNotMatch(implementation, /\.attach\s*\(|\bpinMode\s*\(|\bdigitalWrite\s*\(|\banalogWrite\s*\(|\bdelay\s*\(/)
  assert.doesNotMatch(implementation, /\b(?:DDR|PORT)[BCD]\s*[|&^]?=/)
  assert.match(firmwareSource, /hardwareOutputsEnabled\\?"?:false/)
})

test('candidate sketch durations and stage markers remain consistent with the TS mirror', () => {
  for (const mode of ['WIND','WAVE','BUBBLE'] as const) {
    assert.ok(firmwareSource.includes(`case EXPERIENCE_${mode}: return 30000;`))
    const markers = EXPERIENCE_DEFINITIONS[mode].timeline.filter(e => e.kind === 'MARKER')
    assert.deepEqual(markers.slice(0,3).map(e => [e.atMs,e.text]), [
      [0,'INITIAL FILL'],[10000,'EXPERIENCE START'],[25000,'FINAL SHRINK'],
    ])
  }
  assert.ok(firmwareSource.includes('if (atMs == 0) marker = "INITIAL FILL";'))
  assert.ok(firmwareSource.includes('if (atMs == 10000) marker = "EXPERIENCE START";'))
  assert.ok(firmwareSource.includes('if (atMs == 25000) marker = "FINAL SHRINK";'))
  for (const text of ['NEXT WIND CYCLE','NEXT WAVE CYCLE','NEXT ROUND']) assert.ok(firmwareSource.includes(text))
  assert.ok(firmwareSource.includes('HOST_TIMEOUT_MS = 5000'))
  assert.ok(firmwareSource.includes('Actuators::stopAll();'))
})

test('firmware identity timeline fingerprint matches the exact candidate header',()=>{
 const version=readFileSync(join(testDirectory,'../firmware/unified/nature_touch_unified/firmware-version.h'),'utf8')
 const digest=createHash('sha256').update(timelineHeader).digest('hex').slice(0,8)
 assert.ok(version.includes('"30s-'+digest+'"'))
 assert.match(version,/NATURE_TOUCH_FIRMWARE_VERSION "3\.0\.0-30s"/)
 assert.match(firmwareSource,/#include "firmware-version.h"/)
})
