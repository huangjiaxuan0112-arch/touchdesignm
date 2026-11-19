import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{resolve,join}from'node:path';import{runInNewContext}from'node:vm';import{verifyMain}from'../../tools/rc4-mapping/verify-main.mjs';
const root=resolve(import.meta.dirname,'../..'),m=verifyMain();
const main=readFileSync(join(m.absoluteOutput,'main/main.js'),'utf8');
const baseline=readFileSync(join(root,'desktop/out-exhibition-rc3/main/main.js'),'utf8');
test('RC4 Main differs from deployed RC3 only by exact firmware identity',()=>{
 assert.equal(main.replace('firmwareVersion: "3.0.0-rc4-d6inflate"','firmwareVersion: "3.0.0-rc3-offline"'),baseline);
 assert.equal(m.entries.RC4.version,'3.0.0-rc4-d6inflate');assert.equal(m.entries.RC3.version,'3.0.0-rc3-offline');
});
test('actual compiled Main gate accepts RC4 only and rejects old firmware/protocol/permission',()=>{
 const source=main.match(/const EXHIBITION_FIRMWARE_TARGET = \{[^\n]+\};\s*function firmwareExhibitionReady\(state,\s*deploymentReviewed\) \{[\s\S]*?\n\}/)?.[0];
 assert.ok(source);const gate=runInNewContext('(()=>{'+source+';return {target:EXHIBITION_FIRMWARE_TARGET,ready:firmwareExhibitionReady}})()');
 const valid={...gate.target,identified:true,protocolVersion:2,connectionState:'connected',firmware:'nature-touch-unified-real',hardwareOutputsEnabled:true};
 assert.equal(gate.ready(valid,true),true);
 for(const firmwareVersion of ['3.0.0-rc3-offline','3.0.0-rc2','unknown'])assert.equal(gate.ready({...valid,firmwareVersion},true),false);
 assert.equal(gate.ready({...valid,protocolVersion:1},true),false);assert.equal(gate.ready(valid,false),false);
});
test('RC3 timeline/scheduler are byte preserved after newline normalization',()=>{
 for(const name of ['experience-timelines.h','experience-scheduler.h'])assert.equal(
  readFileSync(join(root,'firmware/releases/nature_touch_v3_rc4_d6_inflate_20261105/source/nature_touch_unified',name),'utf8'),
  readFileSync(join(root,'firmware/releases/nature_touch_v3_rc3_prepared_25s_offline/source/nature_touch_unified',name),'utf8').replace(/\r/g,''));
});
test('driver has pin-neutral names and corrected prepared/normal routes, protection values unchanged',()=>{
 const d=readFileSync(join(root,'firmware/releases/nature_touch_v3_rc4_d6_inflate_20261105/source/nature_touch_unified/real-actuators.h'),'utf8');
 assert.ok(d.includes('INFLATE = { D5_OPEN_US, D6_ON_US, D7_OFF_US }'));
 assert.ok(d.includes('DEFLATE = { D5_OPEN_US, D6_OFF_US, D7_ON_US }'));
 assert.ok(d.includes('pumpD6.writeMicroseconds(D6_ON_US)'));
 assert.ok(d.includes('PUMP_OFF_SETTLE_MS = 500'));assert.ok(d.includes('VALVE_SETTLE_MS = 300'));
 assert.ok(!d.includes('suction')&&!d.includes('inflation'));
});
