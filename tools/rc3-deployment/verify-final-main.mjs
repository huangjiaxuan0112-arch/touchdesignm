import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..');
export function verifyFinalMain(){
 const m=JSON.parse(readFileSync(join(root,'firmware/deployment/nature_touch_rc3_20261105/FINAL_MAIN_MANIFEST.json'),'utf8'));
 const output=resolve(root,m.output);
 assert.equal(output,join(root,'desktop/out-exhibition-rc3'));
 for(const[p,d]of Object.entries(m.checksums))assert.equal(createHash('sha256').update(readFileSync(join(output,p))).digest('hex'),d,p);
 for(const[p,d]of Object.entries(m.runtimeChecksums??{}))assert.equal(createHash('sha256').update(readFileSync(join(root,p))).digest('hex'),d,p);
 const req=createRequire(join(output,'main/main.js'));
 assert.ok(req.resolve('serialport').startsWith(join(root,'desktop/node_modules')));
 for(const entry of Object.values(m.entries))assert.ok(readFileSync(join(output,'main',entry.file),'utf8').includes('firmwareVersion: "'+entry.version+'"'));
 return {...m,absoluteOutput:output,absoluteEntry:join(output,m.entry)};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const m=verifyFinalMain();console.log(JSON.stringify({result:'PASS',output:m.absoluteOutput,entry:m.absoluteEntry,
  files:Object.keys(m.checksums).length,RC3:m.entries.RC3.version,RC2:m.entries.RC2.version}));
}
