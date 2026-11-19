// Independent candidate creation only; no devices, running Main or baseline writes.
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..');
const oldName='nature_touch_v3_rc4_d6_inflate_20261105',newName='nature_touch_v3_rc5_d5_routing_20261105';
const candidate=join(root,'firmware/releases',newName);
assert.ok(!existsSync(join(candidate,'source')),'Never overwrite an existing candidate source');
const put=(p,s)=>{mkdirSync(resolve(p,'..'),{recursive:true});writeFileSync(p,s)};
for(const name of readdirSync(join(root,'firmware/releases',oldName,'source/nature_touch_unified')))
 put(join(candidate,'source/nature_touch_unified',name),readFileSync(join(root,'firmware/releases',oldName,'source/nature_touch_unified',name)));
function adapt(s){
 return s.replaceAll(oldName,newName).replaceAll('rc4-mapping','rc5-valve')
 .replaceAll('out-exhibition-rc4-map','__NEW_MAIN__').replaceAll('out-exhibition-rc3','out-exhibition-rc4-map').replaceAll('__NEW_MAIN__','out-exhibition-rc5-valve')
 .replaceAll('nature_touch_v3_rc3_prepared_25s_offline',oldName)
 .replaceAll('3.0.0-rc4-d6inflate','__NEW_VERSION__').replaceAll('3.0.0-rc3-offline','3.0.0-rc4-d6inflate').replaceAll('__NEW_VERSION__','3.0.0-rc5-d5route')
 .replaceAll('RC4','__NEW_RELEASE__').replaceAll('RC3','RC4').replaceAll('__NEW_RELEASE__','RC5')
 .replaceAll('31de72d6ed3631578a4fafe59e0c96ab21cdebb5172f1192f397dafb9b9558d0','fdb4e9c496a86784946cdb392b7f11234da03333dff2da2072f2076d11d7f81b')
 .replaceAll('rc3-rollback.js','rc4-rollback.js')
 .replaceAll('DRAIN = [1800, 1200, 1800]','DRAIN = [1200, 1200, 1800]');
}
for(const name of ['build-main.mjs','verify-main.mjs','launch.mjs','Owner-Launch-Main.ps1','identify-status.ts'])
 put(join(root,'tools/rc5-valve',name),adapt(readFileSync(join(root,'tools/rc4-mapping',name),'utf8')));
for(const name of ['verify.mjs','d7-fault-verify.mjs','main-gate.test.mjs','readonly.test.ts'])
 put(join(root,'test/rc5-valve',name),adapt(readFileSync(join(root,'test/rc4-mapping',name),'utf8')));
console.log(JSON.stringify({created:candidate,baselineUntouched:true,deviceAccess:false}));
