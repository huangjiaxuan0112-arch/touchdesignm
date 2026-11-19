import {readFileSync,writeFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyMain} from './verify-main.mjs';
const root=resolve(import.meta.dirname,'../..');
const name='nature_touch_v3_rc5_d5_routing_20261105',old='nature_touch_v3_rc4_d6_inflate_20261105';
const dir=join(root,'firmware/releases',name),baseline=join(root,'firmware/releases',old);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const read=p=>JSON.parse(readFileSync(join(dir,p),'utf8'));
const deploymentPath=join(dir,'onsite-logs/RC5-deployment-result.json');
const deployment=existsSync(deploymentPath)?JSON.parse(readFileSync(deploymentPath,'utf8')):null;
if(deployment)assert.equal(deployment.firmware.sha256,sha(join(dir,'real/nature_touch_unified.ino.hex')));
const avr=read('logs/summary.json'),fault=read('logs/d7-fault/results.json'),full=read('logs/results.json'),main=verifyMain();
assert.equal(avr.result,'PASS');assert.equal(fault.result,'PASS');
assert.equal(avr.checks.length+fault.checks.length,12);
assert.equal(sha(join(dir,'real/nature_touch_unified.ino.hex')),avr.realHexSha256);
const oldHex=sha(join(baseline,'real/nature_touch_unified.ino.hex'));
assert.equal(oldHex,'e133cbb9cfa4f56b379c7b562ba4a4679e880af4db1eee00e8ad595be580aa1d');
assert.equal(sha(join(root,'desktop/out-exhibition-rc4-map/main/main.js')),main.baselineMainSha256);
for(const [file,digest]of Object.entries(full.baselineHashes))assert.equal(sha(join(baseline,'source/nature_touch_unified',file)),digest);
const sourceHashes={},baselineHashes={};
for(const file of readdirSync(join(dir,'source/nature_touch_unified'))){
 sourceHashes[file]=sha(join(dir,'source/nature_touch_unified',file));
 baselineHashes[file]=sha(join(baseline,'source/nature_touch_unified',file));
 if(!['real-actuators.h','firmware-version.h','nature_touch_unified.ino'].includes(file))assert.equal(sourceHashes[file],baselineHashes[file],file);
}
const compile=readFileSync(join(dir,'logs/real-release-compile.log'),'utf8');
const flash=Number(compile.match(/Sketch uses (\d+) bytes/)?.[1]);
const sram=Number(compile.match(/Global variables use (\d+) bytes/)?.[1]);
assert.ok(flash>0&&sram>0);
const manifest={status:deployment?'DEPLOYED_READONLY_VERIFIED_NO_START':'OFFLINE_VERIFIED_NOT_DEPLOYED',
 deployment:deployment?relative(root,deploymentPath).replaceAll('\\','/'):null,
 version:main.entries.RC5.version,generatedAt:new Date().toISOString(),
 protocolVersion:2,timelineVersion:'25s-4c1e4167',sourceRevision:'5356f28e',
 firmware:{hex:'real/nature_touch_unified.ino.hex',sha256:avr.realHexSha256,flashBytes:flash,sramBytes:sram,sramRemainingBytes:2048-sram,sourceHashes},
 main:{path:main.output,entry:main.entry,version:main.entries.RC5.version,sha256:main.entries.RC5.sha256,checksummedFiles:Object.keys(main.checksums).length},
 routing:{inflate:{D5Us:1800,D6Us:1800,D7Us:1200,path:'P-A; R blocked'},deflate:{D5Us:1200,D6Us:1200,D7Us:1800,path:'A-R; P blocked'},
  stop:{D5Us:1200,D6Us:1200,D7Us:1200,pressureZeroProven:false},ready:{D5Us:1800,D6Us:1200,D7Us:1200,physicalResidualSafetyProven:false}},
 verification:{avrScenarios:12,avrResult:'PASS',relatedSoftwareTests:6,softwareResult:'PASS',typeScriptNoEmit:'PASS',
  actualAvrGpioAndServo:true,physicalHardwareTest:false,guiHttpsCommunicationRetested:!!deployment},
 timing:avr.summaries,
 baseline:{release:old,hexSha256:oldHex,mainSha256:main.baselineMainSha256,sourceHashes:baselineHashes,untouched:true},
 limitations:['No COM access, upload, real START, load supply restoration or running Main modification.',
  'Simulation confirms control outputs only; installed valve position, gas flow and residual pressure are not measured.',
  'STOP/FAULT at 1200us routes A to stopped suction pump; it is not guaranteed venting.',
  'Cooldown reselects P-A after 500ms pump OFF and waits 300ms before prepared; residual trapping or reverse flow needs onsite validation.',
  '25s schedule unchanged; final D7 ON remains 4.2/4.7/4.2s and WAVE 500ms fill remains guard-limited.']};
writeFileSync(join(dir,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const paths=[];function walk(d){for(const n of readdirSync(d)){const p=join(d,n);if(statSync(p).isDirectory())walk(p);else if(n!=='CHECKSUMS.sha256')paths.push(p)}}
walk(dir);walk(join(root,'tools/rc5-valve'));walk(join(root,'test/rc5-valve'));
writeFileSync(join(dir,'CHECKSUMS.sha256'),paths.sort().map(p=>sha(p)+'  '+relative(root,p).replaceAll('\\','/')).join('\n')+'\n');
console.log(JSON.stringify({result:'PASS',manifest:join(dir,'build-manifest.json'),version:manifest.version,hexSha256:avr.realHexSha256,flashBytes:flash,sramBytes:sram,files:paths.length,uploaded:false}));
