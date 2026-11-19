import {readFileSync,writeFileSync,mkdirSync,readdirSync,statSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyPackage} from './verify.mjs';
import {createRequire} from 'node:module';
const root=resolve(import.meta.dirname,'../..'),pkg=join(root,'firmware/deployment/nature_touch_rc3_20261105');
const manifest=verifyPackage(pkg),output=join(root,'desktop/out-exhibition-rc3');
const sha=b=>createHash('sha256').update(b).digest('hex');
const put=(p,b)=>{mkdirSync(resolve(p,'..'),{recursive:true});writeFileSync(p,b);};
const copy=(from,to)=>{for(const name of readdirSync(from)){const a=join(from,name),b=join(to,name);if(statSync(a).isDirectory())copy(a,b);else put(b,readFileSync(a));}};
put(join(output,'main/main.js'),readFileSync(join(pkg,manifest.rc3.main)));
put(join(output,'main/rc2-rollback.js'),readFileSync(join(pkg,manifest.rc2.main)));
put(join(output,'main/bootstrap.cjs'),readFileSync(join(import.meta.dirname,'bootstrap.cjs')));
copy(join(pkg,'app/preload'),join(output,'preload'));copy(join(pkg,'app/renderer'),join(output,'renderer'));
const entries={RC3:{file:'main.js',version:manifest.rc3.version,sha256:manifest.checksums[manifest.rc3.main]},
 RC2:{file:'rc2-rollback.js',version:manifest.rc2.version,sha256:manifest.checksums[manifest.rc2.main]}};
put(join(output,'main/startup-config.json'),Buffer.from(JSON.stringify({entries},null,2)));
const checksums={};function walk(dir){for(const n of readdirSync(dir)){const p=join(dir,n);if(statSync(p).isDirectory())walk(p);else checksums[relative(output,p).replaceAll('\\','/')]=sha(readFileSync(p));}}walk(output);
const req=createRequire(join(root,'desktop/package.json'));
const runtimeFiles=[req.resolve('serialport'),join(root,'desktop/node_modules/@serialport/bindings-cpp/prebuilds/win32-x64/@serialport+bindings-cpp.node')];
const runtimeChecksums=Object.fromEntries(runtimeFiles.map(p=>[relative(root,p).replaceAll('\\','/'),sha(readFileSync(p))]));
const result={status:'BUILT_NOT_DEPLOYED',createdUtc:new Date().toISOString(),output:relative(root,output).replaceAll('\\','/'),
 entry:'main/bootstrap.cjs',entries,dependencyLayout:'Existing desktop/node_modules, same as working RC2 Main',checksums,runtimeChecksums,
 firmwareChanged:false,mainBusinessChanged:false,realLaunchAuthorized:false};
put(join(pkg,'FINAL_MAIN_MANIFEST.json'),Buffer.from(JSON.stringify(result,null,2)+'\n'));
console.log(JSON.stringify({result:'PASS',output,files:Object.keys(checksums).length,firmwareChanged:false,mainBusinessChanged:false}));
