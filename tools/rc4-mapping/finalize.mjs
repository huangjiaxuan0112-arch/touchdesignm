import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyMain} from './verify-main.mjs';
const root=resolve(import.meta.dirname,'../..');
const dir=join(root,'firmware/releases/nature_touch_v3_rc4_d6_inflate_20261105');
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const read=p=>JSON.parse(readFileSync(join(dir,p),'utf8'));
const avr=read('logs/summary.json'),fault=read('logs/d7-fault/results.json'),main=verifyMain();
assert.equal(avr.result,'PASS');assert.equal(fault.result,'PASS');
assert.equal(avr.checks.length+fault.checks.length,12);
assert.equal(sha(join(dir,'real/nature_touch_unified.ino.hex')),avr.realHexSha256);
assert.equal(sha(join(root,'desktop/out-exhibition-rc3/main/main.js')),main.baselineMainSha256);
for(const name of ['experience-timelines.h','experience-scheduler.h']){
 const p='source/nature_touch_unified/'+name;
 assert.equal(readFileSync(join(dir,p),'utf8'),readFileSync(join(root,'firmware/releases/nature_touch_v3_rc3_prepared_25s_offline',p),'utf8').replace(/\r/g,''));
}
const baselineHex=join(root,'firmware/releases/nature_touch_v3_rc3_prepared_25s_offline/real/nature_touch_unified.ino.hex');
assert.equal(sha(baselineHex),'264d75b0245a48096b5c942f0c9267aa934365f8d1f85bff2cb3158961c3d16b');
const manifest={
 status:'OFFLINE_VERIFIED_NOT_DEPLOYED',version:main.entries.RC4.version,
 generatedAt:new Date().toISOString(),protocolVersion:2,timelineVersion:'25s-4c1e4167',sourceRevision:'5356f28e',
 mapping:{D5:'OPEN=1800us',D6:'INFLATE ON=1800us OFF=1200us',D7:'DEFLATE ON=1800us OFF=1200us'},
 firmware:{hex:'real/nature_touch_unified.ino.hex',sha256:avr.realHexSha256,flashBytes:12916,sramBytes:1411,sramRemainingBytes:637},
 main:{path:main.output,entry:main.entry,version:main.entries.RC4.version,sha256:main.entries.RC4.sha256,checksummedFiles:Object.keys(main.checksums).length},
 verification:{avrScenarios:12,avrResult:'PASS',mainGateTests:4,readOnlyToolMockTests:2,softwareResult:'PASS',typeScriptNoEmit:'PASS',
  evidence:['logs/results.json','logs/summary.json','logs/d7-fault/results.json'],
  commandResults:[{command:'node --test test/rc4-mapping/main-gate.test.mjs',exitCode:0},
   {command:'node --import ./desktop/node_modules/tsx/dist/loader.mjs --test test/rc4-mapping/readonly.test.ts',exitCode:0},
   {command:'desktop/node_modules/.bin/tsc.cmd --noEmit --project desktop/tsconfig.node.json',exitCode:0}]},
 timing:avr.summaries.map(({mode,firstOnPin,firstOnElapsedMs,initialD6NominalMs,finalOnPin,finalD7StartMs,finalD7NominalMs,d6OnMs,d7OnMs,completedMs,cooldownMs})=>
  ({mode,firstOnPin,firstOnElapsedMs,initialD6NominalMs,finalOnPin,finalD7StartMs,finalD7NominalMs,d6OnMs,d7OnMs,completedMs,cooldownMs})),
 limitations:['AVR8js executes actual compiled AVR/Servo code; no bench GPIO measurement or physical acceptance.',
  'Original RC3 schedule and reversal guards retained: final D7 ON is 4200/4700/4200ms, not a full five seconds.',
  'Servo pulse frame phase differs from command time; 0ms is scheduler command latency, not physical response.',
  'WAVE final 500ms inflate segment remains consumed by reversal guard.',
  'No COM access, firmware upload, real START, GUI/HTTPS retest or modification of running RC3.'],
 baseline:{rc3MainSha256:main.baselineMainSha256,rc3HexSha256:sha(baselineHex),rc2Preserved:true}
};
writeFileSync(join(dir,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const entries=[];function walk(p){for(const n of readdirSync(p)){const f=join(p,n);if(statSync(f).isDirectory())walk(f);else if(n!=='CHECKSUMS.sha256')entries.push(f)}}walk(dir);
walk(join(root,'tools/rc4-mapping'));walk(join(root,'test/rc4-mapping'));
writeFileSync(join(dir,'CHECKSUMS.sha256'),entries.map(p=>sha(p)+'  '+relative(root,p).replaceAll('\\','/')).join('\n')+'\n');
console.log(JSON.stringify({result:'PASS',manifest:join(dir,'build-manifest.json'),hexSha256:avr.realHexSha256,mainFiles:Object.keys(main.checksums).length,checksums:entries.length,hardwareAccess:false}));
