import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { EXHIBITION_FIRMWARE_TARGET, firmwareExhibitionReady } from '../firmware/releases/nature_touch_v3_rc3_prepared_25s_offline/host-integration/exhibition-routing'
import { INITIAL_FIRMWARE_CONTROL_SNAPSHOT } from '../desktop/shared/firmware-control-protocol'

test('independent RC3 Main accepts only the exact reviewed RC3 identity', () => {
  const ready = { ...INITIAL_FIRMWARE_CONTROL_SNAPSHOT, ...EXHIBITION_FIRMWARE_TARGET,
    identified: true, protocolVersion: 2, connectionState: 'connected' as const,
    firmware: 'nature-touch-unified-real', hardwareOutputsEnabled: true }
  assert.equal(firmwareExhibitionReady(ready, true), true)
  for (const patch of [{firmwareVersion:'3.0.0-rc2'}, {timelineVersion:'wrong'},
    {sourceRevision:'wrong'}, {hardwareOutputsEnabled:false}, {protocolVersion:1}]) {
    assert.equal(firmwareExhibitionReady({...ready,...patch}, true), false)
  }
  assert.equal(firmwareExhibitionReady(ready, false), false)
})

test('independent built Main targets RC3; current development identity stays separate', () => {
  const candidate = new URL('../firmware/releases/nature_touch_v3_rc3_prepared_25s_offline/', import.meta.url)
  assert.ok(readFileSync(new URL('main-build/main/main.js', candidate), 'utf8').includes('firmwareVersion: "3.0.0-rc3-offline"'))
  assert.ok(readFileSync(new URL('../desktop/electron/exhibition-routing.ts', import.meta.url), 'utf8').includes("firmwareVersion: '3.0.0-30s'"))
  assert.equal(readFileSync(new URL('source/nature_touch_unified/experience-timelines.h', candidate),'utf8'),
    readFileSync(new URL('../nature_touch_v3_real_rc2_d5-open-both_20261105T0535Z/source/nature_touch_unified/experience-timelines.h',candidate),'utf8').replace(/\r/g,''))
})
