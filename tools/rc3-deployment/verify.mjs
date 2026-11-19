import {readFileSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
export function verifyPackage(root=resolve(import.meta.dirname,'../../firmware/deployment/nature_touch_rc3_20261105')){
 const manifest=JSON.parse(readFileSync(join(root,'PACKAGE_MANIFEST.json'),'utf8'));
 for(const [p,digest]of Object.entries(manifest.checksums)){
  const path=resolve(root,p);assert.ok(path.startsWith(resolve(root)+sep));
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),digest,'Package hash mismatch: '+p);
 }
 const a=readFileSync(join(root,manifest.rc3.main),'utf8'),b=readFileSync(join(root,manifest.rc2.main),'utf8');
 assert.equal(a.replace('firmwareVersion: "3.0.0-rc3-offline"','firmwareVersion: "3.0.0-rc2"'),b);
 if(manifest.runtime){
  const modules=join(root,'app/node_modules')+sep;
  const req=createRequire(join(root,manifest.rc3.main));
  assert.ok(req.resolve('serialport').startsWith(modules),'serialport must resolve inside the deployment package');
  const app=JSON.parse(readFileSync(join(root,'app/package.json'),'utf8'));
  assert.equal(app.main,'main/main.js');assert.equal(manifest.rc3.launch,'app');
  for(const pkg of manifest.runtime.packages){
   const directory=join(root,'app/node_modules',pkg.path);
   const metadata=JSON.parse(readFileSync(join(directory,'package.json'),'utf8'));
   assert.equal(metadata.name,pkg.name);assert.equal(metadata.version,pkg.version);
   const local=createRequire(join(directory,'package.json'));
   for(const name of Object.keys(metadata.dependencies??{}))assert.ok(local.resolve(name).startsWith(modules),'Dependency escaped package: '+name);
  }
 }
 return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const m=verifyPackage();console.log(JSON.stringify({result:'PASS',files:Object.keys(m.checksums).length,rc3:m.rc3,rc2:m.rc2,hardwareAccess:false}));
}
