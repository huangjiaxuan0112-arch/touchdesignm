// Build an independent RC4 Main from the accepted, deployed RC3 business bundle.
import{readFileSync,writeFileSync,mkdirSync,readdirSync,statSync}from'node:fs';
import{resolve,join,relative}from'node:path';import{createHash}from'node:crypto';import assert from'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),candidate=join(root,'firmware/releases/nature_touch_v3_rc4_d6_inflate_20261105');
const output=join(root,'desktop/out-exhibition-rc4-map'),baseline=join(root,'desktop/out-exhibition-rc3');
const sha=b=>createHash('sha256').update(b).digest('hex');
const old=readFileSync(join(baseline,'main/main.js'),'utf8');
assert.equal(sha(old),'31de72d6ed3631578a4fafe59e0c96ab21cdebb5172f1192f397dafb9b9558d0');
const target3='const EXHIBITION_FIRMWARE_TARGET = { firmwareVersion: "3.0.0-rc3-offline", timelineVersion: "25s-4c1e4167", sourceRevision: "5356f28e" };';
const target4=target3.replace('3.0.0-rc3-offline','3.0.0-rc4-d6inflate');
assert.equal(old.split(target3).length,2);
const main=old.replace(target3,target4);assert.equal(main.replace(target4,target3),old);
const put=(p,b)=>{mkdirSync(resolve(p,'..'),{recursive:true});writeFileSync(p,b)};
const copy=(a,b)=>{for(const n of readdirSync(a)){const source=join(a,n),dest=join(b,n);if(statSync(source).isDirectory())copy(source,dest);else put(dest,readFileSync(source))}};
put(join(output,'main/main.js'),main);put(join(output,'main/rc3-rollback.js'),old);
let boot=readFileSync(join(baseline,'main/bootstrap.cjs'),'utf8');
boot=boot.replace("NATURE_TOUCH_LAUNCH_RELEASE||'RC3'","NATURE_TOUCH_LAUNCH_RELEASE||'RC4'").replace("['RC3','RC2']","['RC4','RC3']");
put(join(output,'main/bootstrap.cjs'),boot);
copy(join(baseline,'preload'),join(output,'preload'));copy(join(baseline,'renderer'),join(output,'renderer'));
const entries={RC4:{file:'main.js',version:'3.0.0-rc4-d6inflate',sha256:sha(main)},RC3:{file:'rc3-rollback.js',version:'3.0.0-rc3-offline',sha256:sha(old)}};
put(join(output,'main/startup-config.json'),JSON.stringify({entries},null,2));
const checksums={};function walk(dir){for(const n of readdirSync(dir)){const p=join(dir,n);if(statSync(p).isDirectory())walk(p);else checksums[relative(output,p).replaceAll('\\','/')]=sha(readFileSync(p));}}walk(output);
put(join(candidate,'main-manifest.json'),JSON.stringify({status:'BUILT_NOT_DEPLOYED',output:relative(root,output).replaceAll('\\','/'),entry:'main/bootstrap.cjs',entries,
 mainChange:'Exact firmware identity constant only',checksums,baselineMainSha256:sha(old),guiHttpsCommunicationRetested:false},null,2)+'\n');
console.log(JSON.stringify({result:'PASS',output,version:entries.RC4.version,files:Object.keys(checksums).length,liveRc3Changed:false,started:false}));
