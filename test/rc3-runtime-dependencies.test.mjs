import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {verifyPackage} from '../tools/rc3-deployment/verify.mjs';
const root=resolve(import.meta.dirname,'../firmware/deployment/nature_touch_rc3_20261105');
const sha=p=>createHash('sha256').update(readFileSync(join(root,p))).digest('hex');
test('complete local production dependency closure is hashed and resolves inside the deployment',()=>{
 const manifest=verifyPackage(root);
 assert.equal(manifest.runtime.packages.length,24);assert.equal(manifest.runtime.nodePathRequired,false);
 assert.equal(manifest.runtime.nativeRebuilt,false);
 assert.ok(createRequire(join(root,'app/main/main.js')).resolve('serialport').startsWith(join(root,'app/node_modules')));
});
test('RC3/RC2 Main and both firmware files remain byte-identical to accepted deployment payloads',()=>{
 assert.equal(sha('app/main/main.js'),'31de72d6ed3631578a4fafe59e0c96ab21cdebb5172f1192f397dafb9b9558d0');
 assert.equal(sha('app/main/rc2-rollback.js'),'91a705fd5bfe7190ccc4b8a6df2ab7978750c214e8eb210ccc7f0bfcc18cd718');
 assert.equal(sha('firmware/rc3.hex'),'264d75b0245a48096b5c942f0c9267aa934365f8d1f85bff2cb3158961c3d16b');
 assert.equal(sha('firmware/rc2-rollback.hex'),'cfb3fadf548be3ca35c59dc4a8d4a20a1c3c1dc9d180167d3d273160015acc73');
});
test('owner launcher uses final desktop bootstrap and clears inherited NODE_PATH',()=>{
 const script=readFileSync(new URL('../tools/rc3-deployment/Owner-Launch-Main.ps1',import.meta.url),'utf8');
 assert.ok(script.includes('desktop\\out-exhibition-rc3\\main\\bootstrap.cjs'));
 assert.ok(script.includes("SetEnvironmentVariable('NODE_PATH',$null,'Process')"));
 assert.ok(script.includes('Assert-ApplicationStopped.ps1'));
});
test('actual Electron native load and full hidden Main/Projector startup passed with hardware and networking blocked',()=>{
 const results=JSON.parse(readFileSync(join(root,'runtime-tests.json'),'utf8'));
 assert.equal(results.result,'PASS');assert.equal(results.results.length,4);
 const native=results.results.find(r=>r.mode==='native'),startup=results.results.find(r=>r.mode==='startup');
 assert.equal(native.versions.electron,'33.4.11');assert.equal(native.versions.modules,'130');
 assert.equal(native.arch,'x64');assert.ok(native.nativeLoads.some(n=>n.filename.endsWith('.node')));
 assert.equal(startup.mainSnapshot.phase,'READY');assert.equal(startup.projectorPhase,'READY');
 assert.equal(startup.windows.length,2);assert.ok(startup.windows.every(w=>!w.visible));
 assert.deepEqual(startup.forbiddenIo,[]);assert.deepEqual(startup.networkAttempts,[]);
 const rollback=results.results.find(r=>r.mode==='startup-rc2');
 assert.equal(rollback.mainSnapshot.phase,'READY');assert.equal(rollback.projectorPhase,'READY');
 assert.deepEqual(rollback.forbiddenIo,[]);assert.deepEqual(rollback.networkAttempts,[]);
});
