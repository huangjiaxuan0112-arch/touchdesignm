// Offline deployment repair: copy the installed production dependency closure.
// No npm install, native rebuild, serial import, GUI launch or device discovery.
import {readFileSync,writeFileSync,existsSync,mkdirSync,readdirSync,statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,join,relative,sep,dirname,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..');
const sha=b=>createHash('sha256').update(b).digest('hex');
export function installRuntimeDependencies(destination=join(root,'firmware/deployment/nature_touch_rc3_20261105')) {
 const sourceModules=join(root,'desktop/node_modules');
 const targetModules=join(destination,'app/node_modules');
 const manifestPath=join(destination,'PACKAGE_MANIFEST.json');
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 for(const [p,hash]of Object.entries(manifest.checksums))assert.equal(sha(readFileSync(join(destination,p))),hash,'Existing payload changed: '+p);
 const baselineChecksums={...manifest.checksums};
 const queue=[join(sourceModules,'serialport')],seen=new Set(),packages=[];
 function copy(source,target){
  if(statSync(source).isDirectory()){
   mkdirSync(target,{recursive:true});for(const name of readdirSync(source))copy(join(source,name),join(target,name));
  }else{
   const bytes=readFileSync(source);
   if(existsSync(target))assert.equal(sha(readFileSync(target)),sha(bytes),'Refuse changed dependency '+target);
   else writeFileSync(target,bytes);
  }
 }
 while(queue.length){
  const dir=queue.shift();if(seen.has(dir))continue;seen.add(dir);
  const pkg=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));
  const location=relative(sourceModules,dir);
  assert.ok(location&&!location.startsWith('..')&&!isAbsolute(location));
  copy(dir,join(targetModules,location));
  packages.push({name:pkg.name,version:pkg.version,path:location.replaceAll('\\','/')});
  const req=createRequire(join(dir,'package.json'));
  for(const name of Object.keys(pkg.dependencies??{})){
   let dependency=dirname(req.resolve(name));
   while(dependency.startsWith(sourceModules+sep)){
    const metadata=join(dependency,'package.json');
    if(existsSync(metadata)&&JSON.parse(readFileSync(metadata,'utf8')).name===name)break;
    dependency=dirname(dependency);
   }
   assert.ok(dependency.startsWith(sourceModules+sep),'Dependency escaped source modules: '+name);
   queue.push(dependency);
  }
 }
 const packageJson=Buffer.from(JSON.stringify({name:'nature-touch-rc3-deployment',version:'3.0.0-rc3-offline',
  private:true,main:'main/main.js',dependencies:{serialport:packages.find(p=>p.name==='serialport').version}},null,2)+'\n');
 const packagePath=join(destination,'app/package.json');
 if(existsSync(packagePath))assert.equal(sha(readFileSync(packagePath)),sha(packageJson));else writeFileSync(packagePath,packageJson);
 function hashTree(dir){for(const name of readdirSync(dir)){
  const p=join(dir,name);if(statSync(p).isDirectory())hashTree(p);
  else manifest.checksums[relative(destination,p).replaceAll('\\','/')]=sha(readFileSync(p));
 }}
 hashTree(targetModules);
 manifest.checksums['app/package.json']=sha(packageJson);
 for(const [p,hash]of Object.entries(baselineChecksums))assert.equal(manifest.checksums[p],hash,'Original payload modified');
 manifest.rc3.launch='app';manifest.rc2.launch=manifest.rc2.main;
 manifest.runtime={layout:'app/node_modules',source:'Existing desktop/node_modules production dependency closure',
  packages:packages.sort((a,b)=>a.path.localeCompare(b.path)),nodePathRequired:false,
  electronExecutable:'desktop/node_modules/electron/dist/electron.exe',nativeRebuilt:false,
  businessMainUnchanged:true,updatedUtc:new Date().toISOString()};
 writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
 return {result:'PASS',packages:packages.length,files:Object.keys(manifest.checksums).length,businessMainUnchanged:true,hardwareAccess:false};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))console.log(JSON.stringify(installRuntimeDependencies(),null,2));
