import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const candidate=join(root,'firmware/releases/nature_touch_v3_rc3_prepared_25s_offline');
const read=p=>JSON.parse(readFileSync(join(candidate,p),'utf8'));
const run=read('logs/results.json'), repeat=read('logs/repeat-driver/results.json'), safety=read('logs/start-safety/results.json');
assert.equal(run.result,'PASS'); assert.equal(repeat.result,'PASS'); assert.equal(safety.result,'PASS');
const extra=[];
for(const record of run.evidence.filter(e=>e.extra?.profile==='RC3-ready')) {
  const trace=record.commands, first=trace.find(t=>t.state[2]===1800);
  assert.ok(first.elapsed<=1,'Immediate D7 command');
  const origin=first.at-first.elapsed;
  const fillOff=trace.find(t=>t.at>first.at&&t.state[2]===1200);
  assert.ok(Math.abs(fillOff.elapsed-5000)<=2,'Initial 5s command interval');
  const final=trace.find(t=>t.elapsed>=20000&&t.elapsed<25000&&t.state[1]===1800);
  const expected=record.extra.mode==='WAVE'?20300:20800;
  assert.ok(Math.abs(final.elapsed-expected)<=2,'Final drain guard');
  const end=trace.find(t=>t.elapsed>=24999&&t.state[1]===1200&&t.state[2]===1200);
  assert.ok(Math.abs(end.elapsed-25000)<=2,'25s hard stop, no drift');
  const nextOn=trace.find(t=>t.at>end.at&&t.state[2]===1800);
  assert.ok(nextOn.at-origin>=27998,'No next run before cooldown');
  assert.ok(trace.filter(t=>t.at>=end.at&&t.at<nextOn.at).every(t=>t.state[1]===1200&&t.state[2]===1200));
  let previous=null, off=null;
  for(const t of trace) {
    const pin=t.state[1]===1800?6:t.state[2]===1800?7:null;
    if(pin===null&&previous!==null) off??=t.at;
    if(pin!==null&&pin!==previous) {
      if(previous!==null) assert.ok(off!==null&&t.at-off>=798,'Actual reversal preserves 800ms guard');
      previous=pin; off=null;
    }
  }
  const firstPulse=record.pulses.find(p=>p.pin===7&&Math.abs(p.widthUs-1800)<=12);
  extra.push({mode:record.extra.mode,startCommandElapsedMs:first.elapsed,
    initialD7CommandMs:fillOff.elapsed-first.elapsed,finalD6StartElapsedMs:final.elapsed,
    stopElapsedMs:end.elapsed,firstD7OnPulseAfterCommandMs:firstPulse.riseUs/1000-first.at});
}
assert.equal(extra.length,3);
const sha=p=>createHash('sha256').update(readFileSync(join(candidate,p))).digest('hex');
const sourceFiles=readdirSync(join(candidate,'source/nature_touch_unified')).map(n=>'source/nature_touch_unified/'+n);
const files=[...sourceFiles,'real/nature_touch_unified.ino.hex','real/nature_touch_unified.ino.elf',
 'host-integration/exhibition-routing.ts','main-build/main/main.js','main-build/preload/preload.cjs'];
const checksums=Object.fromEntries(files.map(p=>[p,sha(p)]));
assert.equal(checksums['real/nature_touch_unified.ino.hex'],run.realHexSha256);
const baseline=join(candidate,'../nature_touch_v3_real_rc2_d5-open-both_20261105T0535Z/source/nature_touch_unified');
for(const [name,digest] of Object.entries(run.baselineHashes))assert.equal(createHash('sha256').update(readFileSync(join(baseline,name))).digest('hex'),digest);
const mainLog=readFileSync(join(candidate,'logs/main-regression.log'),'utf8');
assert.match(mainLog,/pass 115/);assert.match(mainLog,/fail 0/);
const manifest={createdUtc:new Date().toISOString(),status:'OFFLINE_VERIFIED_PARTIAL_REQUIREMENTS_FINAL_DRAIN_CONFLICT',
 firmwareVersion:'3.0.0-rc3-offline',timelineVersion:'25s-4c1e4167',baseline:'nature_touch_v3_real_rc2_d5-open-both_20261105T0535Z',
 readyOpenEvidence:'USER_CONFIRMED_PASS_CURRENT_CHAT',mainRebuilt:true,hardwareCOMAccess:false,uploaded:false,
 experienceMs:25000,cooldownMs:3000,initialFull5s:true,finalFull5s:false,
 avrScenarioChecks:run.checks.length+repeat.checks+safety.checks,mainRegressionPass:115,extraTimingChecks:extra,
 timingSummaries:run.summaries,checksums,
 limitations:['Final D6 is 4.2s WIND/BUBBLE and 4.7s WAVE; original rhythm and actual reversal guard retained.',
 'WAVE 500ms fill remains completely suppressed by the 800ms guard.',
 'Timing is control commands/virtual GPIO, not measured motor power or airflow.',
 'Main READY includes delivery latency; cold/post-stop START refused until preparation completes.']};
writeFileSync(join(candidate,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(candidate,'CHECKSUMS.sha256'),Object.entries(checksums).map(([p,d])=>d+'  '+p).join('\n')+'\n');
console.log(JSON.stringify(manifest,null,2));
