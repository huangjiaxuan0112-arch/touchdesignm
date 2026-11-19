import{test}from'node:test';import assert from'node:assert/strict';
import{readFileSync}from'node:fs';import{resolve,join}from'node:path';import{execFileSync}from'node:child_process';
import{classifyStartup}from'../tools/rc3-deployment/status.mjs';
import{verifyFinalMain}from'../tools/rc3-deployment/verify-final-main.mjs';
const root=resolve(import.meta.dirname,'..'),now=Date.now(),processInfo={pid:42};
const good={pid:42,phase:'READY',healthy:true,mainVisible:true,projectorVisible:true,httpsReady:true,
 startedAt:new Date(now-2000).toISOString(),updatedAt:new Date(now-500).toISOString()};
test('a PID alone, wrong PID, absent listener or stale health is never READY',()=>{
 assert.equal(classifyStartup(processInfo,null,[42],now).ready,false);
 assert.equal(classifyStartup(processInfo,{...good,pid:43},[42],now).ready,false);
 assert.equal(classifyStartup(processInfo,good,[],now).ready,false);
 assert.equal(classifyStartup(processInfo,{...good,updatedAt:new Date(now-10000).toISOString()},[42],now).ready,false);
 assert.equal(classifyStartup(null,good,[42],now).state,'EXITED');
});
test('only fresh matching health + both visible windows + owned listener qualifies',()=>{
 assert.deepEqual(classifyStartup(processInfo,good,[42],now),{state:'RUNNING_READY',ready:true});
 assert.equal(classifyStartup(processInfo,{...good,mainVisible:false},[42],now).ready,false);
 assert.equal(classifyStartup(processInfo,{...good,httpsReady:false},[42],now).ready,false);
});
test('startup failure, timeout and stuck startup remain distinct from a running app',()=>{
 for(const phase of ['FAILED','STARTUP_TIMEOUT','DEGRADED'])assert.equal(classifyStartup(processInfo,{...good,phase},[42],now).state,phase);
 assert.equal(classifyStartup(processInfo,{...good,phase:'MAIN_IMPORTED'},[],now).state,'STARTING');
 assert.equal(classifyStartup(processInfo,{...good,phase:'MAIN_IMPORTED',startedAt:new Date(now-40000).toISOString()},[],now).state,'STUCK_STARTUP');
});
test('normal desktop layout keeps exact accepted RC3/RC2 Main gates and resolves existing runtime',()=>{
 const m=verifyFinalMain();assert.equal(m.entries.RC3.version,'3.0.0-rc3-offline');assert.equal(m.entries.RC2.version,'3.0.0-rc2');
 assert.equal(m.entries.RC3.sha256,'31de72d6ed3631578a4fafe59e0c96ab21cdebb5172f1192f397dafb9b9558d0');
 assert.equal(m.entries.RC2.sha256,'91a705fd5bfe7190ccc4b8a6df2ab7978750c214e8eb210ccc7f0bfcc18cd718');
 const dry=JSON.parse(execFileSync(process.execPath,[join(root,'tools/rc3-deployment/launch-final-main.mjs')],{encoding:'utf8'}));
 assert.equal(dry.result,'DRY_RUN_ONLY');assert.equal(dry.realMainStarted,false);assert.equal(dry.serialOpened,false);
});
test('actual Electron shows READY only after window display requests and real non-8443 HTTPS, while failures are logged',()=>{
 const report=JSON.parse(readFileSync(join(root,'firmware/deployment/nature_touch_rc3_20261105/final-startup-tests.json'),'utf8'));
 assert.equal(report.result,'PASS');assert.equal(report.results.length,5);assert.equal(report.port8443Used,false);assert.equal(report.hardwareAccess,false);
 for(const r of report.results.filter(r=>r.mode.startsWith('startup'))){
  assert.equal(r.startupStatus.phase,'READY');assert.equal(r.startupStatus.mainPhase,'READY');assert.equal(r.startupStatus.projectorPhase,'READY');
  assert.equal(r.https.status,200);assert.notEqual(r.https.port,8443);assert.deepEqual(r.forbiddenIo,[]);
  assert.ok(r.windows.every(w=>w.visible===false&&w.showRequested));
 }
 for(const r of report.results.filter(r=>['missing-env','occupied-port'].includes(r.mode)))assert.equal(r.startupStatus.phase,'FAILED');
 const telemetry=report.results.find(r=>r.mode==='telemetry-error');
 assert.equal(telemetry.startupStatus.phase,'READY');assert.equal(telemetry.https.status,200);assert.deepEqual(telemetry.forbiddenIo,[]);
});
