// Offline packaging only: no process launch, network call or serial dependency.
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync,readdirSync,statSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {installRuntimeDependencies} from './runtime-dependencies.mjs';
const root=resolve(import.meta.dirname,'../..');
const out=join(root,'firmware/deployment/nature_touch_rc3_20261105');
const rc3=join(root,'firmware/releases/nature_touch_v3_rc3_prepared_25s_offline');
const rc2=join(root,'firmware/releases/nature_touch_v3_real_rc2_d5-open-both_20261105T0535Z');
const sha=b=>createHash('sha256').update(b).digest('hex');
const expected3='264d75b0245a48096b5c942f0c9267aa934365f8d1f85bff2cb3158961c3d16b';
const expected2='cfb3fadf548be3ca35c59dc4a8d4a20a1c3c1dc9d180167d3d273160015acc73';
const frozen=JSON.parse(readFileSync(join(rc3,'build-manifest.json'),'utf8'));
for(const [p,digest] of Object.entries(frozen.checksums))assert.equal(sha(readFileSync(join(rc3,p))),digest,'Frozen RC3 changed: '+p);
assert.equal(sha(readFileSync(join(rc3,'real/nature_touch_unified.ino.hex'))),expected3);
assert.equal(sha(readFileSync(join(rc2,'real/nature_touch_unified.ino.hex'))),expected2);
const live=readFileSync(join(root,'desktop/out-exhibition/main/main.js'),'utf8');
assert.equal(sha(Buffer.from(live)),'91a705fd5bfe7190ccc4b8a6df2ab7978750c214e8eb210ccc7f0bfcc18cd718','Accepted live Main changed; inspect identity before repackaging');
const target2='const EXHIBITION_FIRMWARE_TARGET = { firmwareVersion: "3.0.0-rc2", timelineVersion: "25s-4c1e4167", sourceRevision: "5356f28e" };';
const target3=target2.replace('3.0.0-rc2','3.0.0-rc3-offline');
assert.equal(live.split(target2).length,2,'Expected one exact RC2 identity gate');
const main3=live.replace(target2,target3);
assert.equal(main3.replace(target3,target2),live,'Only identity gate may differ');
const put=(p,bytes)=>{
 const full=join(out,p);mkdirSync(resolve(full,'..'),{recursive:true});
 if(existsSync(full)){assert.equal(sha(readFileSync(full)),sha(bytes),'Refusing to overwrite changed package file '+p);return;}
 writeFileSync(full,bytes);
};
const copyTree=(source,dest)=>{
 for(const n of readdirSync(source)){
  const path=join(source,n),next=join(dest,n);
  if(statSync(path).isDirectory())copyTree(path,next);else put(next,readFileSync(path));
 }
};
put('app/main/main.js',Buffer.from(main3));
put('app/main/rc2-rollback.js',Buffer.from(live));
copyTree(join(root,'desktop/out-exhibition/preload'),'app/preload');
copyTree(join(root,'desktop/out-exhibition/renderer'),'app/renderer');
copyTree(join(root,'desktop/ipad'),'ipad');
put('firmware/rc3.hex',readFileSync(join(rc3,'real/nature_touch_unified.ino.hex')));
put('firmware/rc2-rollback.hex',readFileSync(join(rc2,'real/nature_touch_unified.ino.hex')));
const digests={};
function hashTree(dir){for(const n of readdirSync(dir)){
 const p=join(dir,n);if(statSync(p).isDirectory())hashTree(p);
 else digests[relative(out,p).replaceAll('\\','/')]=sha(readFileSync(p));
}}
hashTree(join(out,'app'));hashTree(join(out,'ipad'));hashTree(join(out,'firmware'));
const manifest={preparedUtc:new Date().toISOString(),status:'SOFTWARE_PREPARED_HARDWARE_NOT_AUTHORIZED',
 acceptedUserScope:'RC3 rhythm and communication accepted onsite; no timeline or safety changes',
 rc3:{version:'3.0.0-rc3-offline',timeline:'25s-4c1e4167',source:'5356f28e',hex:'firmware/rc3.hex',hexSha256:expected3,main:'app/main/main.js'},
 rc2:{version:'3.0.0-rc2',timeline:'25s-4c1e4167',source:'5356f28e',hex:'firmware/rc2-rollback.hex',hexSha256:expected2,main:'app/main/rc2-rollback.js'},
 mainPackaging:'Accepted on-disk Exhibition Main retained byte-for-byte except one exact RC3 identity constant. Rollback Main is an exact copy.',
 acceptedMainSha256:sha(Buffer.from(live)),mainRecompiled:false,mainIdentityRebound:true,
 cpu:'OWNER_MUST_CONFIRM_atmega328_OR_atmega328old',physicalAcceptance:'NOT_RUN',serialOpened:false,uploaded:false,
 baselineChecks:{avr:17,main:115,source:'Previously accepted frozen RC3 manifest; not rerun or treated as physical acceptance'},checksums:digests};
// Manifest is generated metadata; immutable payloads above are never overwritten.
writeFileSync(join(out,'PACKAGE_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
const runtime=installRuntimeDependencies(out);
console.log(JSON.stringify({result:'PASS',out,payloadFiles:Object.keys(digests).length,
 rc3HexSha256:expected3,rc2HexSha256:expected2,mainOnlyIdentityChanged:true,runtime,hardwareAccess:false},null,2));
