import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getProjectorPlacement, rectanglesOverlap } from '../desktop/electron/projector-display'

const primary = {
  id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
}
const main = { x: 480, y: 200, width: 960, height: 640 }

test('Projector chooses the external display, preserving negative desktop coordinates', () => {
  const external = { id: 2, bounds: { x: -2560, y: -120, width: 2560, height: 1440 }, workArea: primary.workArea }
  const placement = getProjectorPlacement([primary, external], primary, main)
  assert.equal(placement.fullscreen, true)
  assert.deepEqual(placement.bounds, external.bounds)
  assert.equal(placement.mainBounds, undefined)
})

test('single-screen Projector preview stays inside the work area and does not overlap Main', () => {
  for (const size of [{ width: 1920, height: 1040 }, { width: 1366, height: 728 }]) {
    const display = { ...primary, workArea: { x: -100, y: 40, ...size } }
    const placement = getProjectorPlacement([display], display, main)
    assert.equal(placement.fullscreen, false)
    assert(!rectanglesOverlap(placement.bounds, placement.mainBounds ?? main))
    assert(placement.bounds.x >= display.workArea.x)
    assert(placement.bounds.x + placement.bounds.width <= display.workArea.x + size.width)
    assert(placement.bounds.y + placement.bounds.height <= display.workArea.y + size.height)
  }
})

test('preview preserves Main bounds when there is already enough room', () => {
  const control = { x: 0, y: 0, width: 800, height: 600 }
  const placement = getProjectorPlacement([primary], primary, control)
  assert.equal(placement.mainBounds, undefined)
  assert(!rectanglesOverlap(placement.bounds, control))
})

test('display removal changes fullscreen presentation into a non-overlapping preview', () => {
  const external = { ...primary, id: 2, bounds: { ...primary.bounds, x: 1920 } }
  assert.equal(getProjectorPlacement([primary, external], primary, main).fullscreen, true)
  const fallback = getProjectorPlacement([primary], primary, main)
  assert.equal(fallback.fullscreen, false)
  assert(!rectanglesOverlap(fallback.bounds, fallback.mainBounds ?? main))
})
