import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { INITIAL_FIRMWARE_CONTROL_SNAPSHOT } from '../desktop/shared/firmware-control-protocol'
import { firmwareExhibitionReady, EXHIBITION_FIRMWARE_TARGET } from '../desktop/electron/exhibition-routing'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveExhibitionMode, audienceSnapshot, audienceEvents } from '../desktop/electron/exhibition-routing'
import type { ExperienceSnapshot, ExperienceEvent } from '../desktop/shared/experience-application-contract'
import { isExperienceSnapshot } from '../desktop/shared/experience-application-contract'
const source:ExperienceSnapshot={mode:'firmware',revision:7,experience:{state:'IDLE',selectedExperienceId:null,operationId:null,elapsedMs:0,durationMs:null,progress:0,faultCode:null}}
test('default Mock stays Mock; trusted firmware requires reviewed deployment regardless of CLI/renderer',()=>{
 assert.equal(resolveExhibitionMode('mock',false),'mock')
 assert.throws(()=>resolveExhibitionMode('firmware',false),/deployment permission/)
 assert.equal(resolveExhibitionMode('firmware',true),'firmware')
})
test('audience projection preserves revision/device fields and explicitly identifies firmware source',()=>{
 const visible=audienceSnapshot(source)
 assert.equal(visible.mode,'mock');assert.equal(visible.deviceSource,'firmware');assert.equal(visible.revision,7)
 assert.equal(visible.experience,source.experience);assert.equal(source.mode,'firmware');assert.equal(source.deviceSource,undefined)
 assert.equal(isExperienceSnapshot(visible),true)
 assert.equal(isExperienceSnapshot({...visible,deviceSource:'other'}),false)
})
test('trusted firmware routing suppresses unrelated Mock events without a second state store',()=>{
 const event:ExperienceEvent={type:'SNAPSHOT',snapshot:source}
 assert.deepEqual(audienceEvents(event,'mock'),[event])
 assert.equal(audienceEvents({...event,snapshot:{...source,mode:'mock'}},'firmware').length,0)
 const forwarded=audienceEvents(event,'firmware')
 assert.equal(forwarded.length,2);assert.equal(forwarded[0],event);assert.equal(forwarded[1].snapshot.deviceSource,'firmware')
})

test('real exhibition gate rejects unknown, mismatched, disconnected or unreviewed firmware without commands',()=>{
 const ready={...INITIAL_FIRMWARE_CONTROL_SNAPSHOT,...EXHIBITION_FIRMWARE_TARGET,identified:true,protocolVersion:2,connectionState:'connected' as const,firmware:'nature-touch-unified-real',hardwareOutputsEnabled:true}
 assert.equal(firmwareExhibitionReady(ready,true),true)
 assert.equal(firmwareExhibitionReady(ready,false),false)
 for(const patch of [{firmwareVersion:null},{timelineVersion:'wrong'},{sourceRevision:null},{identified:false},{connectionState:'disconnected' as const},{firmware:'nature-touch-unified-simulation'},{hardwareOutputsEnabled:false}]){
  assert.equal(firmwareExhibitionReady({...ready,...patch},true),false)
 }
})
test('exhibition identity matches the active 30s firmware and rejects historical firmware',()=>{
 const header=readFileSync(fileURLToPath(new URL('../firmware/unified/nature_touch_unified/firmware-version.h',import.meta.url)),'utf8')
 assert.equal(EXHIBITION_FIRMWARE_TARGET.firmwareVersion,'3.0.0-30s')
 assert.equal(EXHIBITION_FIRMWARE_TARGET.timelineVersion,'30s-2bcc1b95')
 assert.ok(header.includes('"'+EXHIBITION_FIRMWARE_TARGET.sourceRevision+'"'))
 assert.match(header,/NATURE_TOUCH_FIRMWARE_VERSION "3\.0\.0-30s"/)
 const candidate=header.match(/NATURE_TOUCH_TIMELINE_VERSION "(30s-[a-f0-9]{8})"/)
 assert.ok(candidate)
 const ready={...INITIAL_FIRMWARE_CONTROL_SNAPSHOT,...EXHIBITION_FIRMWARE_TARGET,identified:true,protocolVersion:2,connectionState:'connected' as const,firmware:'nature-touch-unified-real',hardwareOutputsEnabled:true}
 assert.equal(firmwareExhibitionReady(ready,true),true)
 assert.equal(candidate[1],EXHIBITION_FIRMWARE_TARGET.timelineVersion)
 assert.equal(firmwareExhibitionReady({...ready,timelineVersion:'25s-4c1e4167'},true),false)
 assert.equal(firmwareExhibitionReady({...ready,firmwareVersion:'3.0.0-rc5-d5route'},true),false)
 assert.equal(firmwareExhibitionReady({...ready,firmwareVersion:'3.0.0-rc1'},true),false)
})


test('real exhibition identity gate requires Protocol v2 and matching 30s metadata',()=>{
 const ready={...INITIAL_FIRMWARE_CONTROL_SNAPSHOT,...EXHIBITION_FIRMWARE_TARGET,identified:true,protocolVersion:2,connectionState:'connected' as const,firmware:'nature-touch-unified-real',hardwareOutputsEnabled:true}
 assert.equal(firmwareExhibitionReady(ready,true),true)
 for(const protocolVersion of [null,1,3])assert.equal(firmwareExhibitionReady({...ready,protocolVersion},true),false)
})
