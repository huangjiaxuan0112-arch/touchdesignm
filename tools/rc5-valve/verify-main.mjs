import{readFileSync}from'node:fs';import{resolve,join}from'node:path';import{createHash}from'node:crypto';import assert from'node:assert/strict';import{createRequire}from'node:module';
const root=resolve(import.meta.dirname,'../..');
export function verifyMain(){
 const m=JSON.parse(readFileSync(join(root,'firmware/releases/nature_touch_v3_rc5_d5_routing_20261105/main-manifest.json'),'utf8'));
 const output=resolve(root,m.output);assert.equal(output,join(root,'desktop/out-exhibition-rc5-valve'));
 for(const[p,h]of Object.entries(m.checksums))assert.equal(createHash('sha256').update(readFileSync(join(output,p))).digest('hex'),h,p);
 const req=createRequire(join(output,'main/main.js'));assert.ok(req.resolve('serialport').startsWith(join(root,'desktop/node_modules')));
 return {...m,absoluteOutput:output,absoluteEntry:join(output,m.entry)};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){const m=verifyMain();console.log(JSON.stringify({result:'PASS',entry:m.absoluteEntry,versions:m.entries,files:Object.keys(m.checksums).length}));}
