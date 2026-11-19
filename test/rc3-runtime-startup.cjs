// Real Electron + real packaged JS/native modules; only I/O and visible windows are blocked.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {app,BrowserWindow}=require('electron');
const root=path.resolve(__dirname,'..');
const pkg=path.join(root,'firmware/deployment/nature_touch_rc3_20261105');
const evidenceDir=process.env.RC3_RUNTIME_EVIDENCE;
if(!evidenceDir)throw Error('Explicit isolated evidence directory required');
const mode=process.argv.find(a=>a.startsWith('--test-mode='))?.split('=')[1]||'startup';
fs.mkdirSync(evidenceDir,{recursive:true});
app.setPath('userData',path.join(evidenceDir,'profile'));
app.setPath('sessionData',path.join(evidenceDir,'session'));
for(const name of Object.keys(process.env))if(name.startsWith('NATURE_TOUCH_IPAD_'))delete process.env[name];
delete process.env.NODE_PATH;delete process.env.ELECTRON_RENDERER_URL;
const evidence={mode,pid:process.pid,versions:process.versions,arch:process.arch,platform:process.platform,
 checks:[],nativeLoads:[],forbiddenIo:[],networkAttempts:[],errors:[],windows:[]};
let finished=false;
function finish(error){
 if(finished)return;finished=true;clearTimeout(watchdog);
 if(error)evidence.errors.push(error.stack||String(error));
 evidence.result=error?'FAIL':'PASS';
 fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({result:evidence.result,mode,evidence:evidenceDir,checks:evidence.checks,errors:evidence.errors}));
 app.exit(error?1:0);
}
const watchdog=setTimeout(()=>finish(Error('Isolated Electron startup timeout')),30000);
process.on('uncaughtException',finish);process.on('unhandledRejection',finish);
const forbidden=kind=>(...args)=>{evidence.forbiddenIo.push({kind});throw Error('Offline test forbids hardware I/O: '+kind)};
const dlopen=process.dlopen;
process.dlopen=function(mod,filename,...args){
 const result=dlopen.call(this,mod,filename,...args);
 if(String(filename).includes('serialport')){
  evidence.nativeLoads.push({filename,exports:Object.keys(mod.exports)});
  // Patch before bindings-cpp captures/promisifies the exports. No native I/O can run.
  for(const key of Object.keys(mod.exports))if(typeof mod.exports[key]==='function')mod.exports[key]=forbidden('native.'+key);
 }
 return result;
};
const net=require('node:net');
net.Server.prototype.listen=function(){evidence.networkAttempts.push('listen');throw Error('Network listeners forbidden in isolated test')};
const req=Module.createRequire(path.join(pkg,'app/main/main.js'));
async function run(){
 if(mode==='legacy-resolution'){
  const legacy=path.join(evidenceDir,'legacy-layout/app/main/main.js');
  fs.mkdirSync(path.dirname(legacy),{recursive:true});fs.writeFileSync(legacy,'// Original relocated layout without dependencies\n');
  const before=Module.createRequire(legacy);
  assert.throws(()=>before('serialport'),e=>e.code==='MODULE_NOT_FOUND');
  evidence.legacySearchPaths=before.resolve.paths('serialport');
  evidence.checks.push('Real Electron reproduces MODULE_NOT_FOUND for original relocated layout with NODE_PATH unset');
  return finish();
 }
 evidence.resolved=req.resolve('serialport');
 assert.ok(evidence.resolved.startsWith(path.join(pkg,'app/node_modules')+path.sep));
 const serial=req('serialport'); // Actual JS imports and actual .node dlopen, not require.resolve only.
 const bindings=req('@serialport/bindings-cpp');
 assert.equal(typeof bindings.autoDetect().open,'function');
 assert.ok(evidence.nativeLoads.some(n=>n.filename.includes('win32-x64')&&n.filename.endsWith('.node')));
 const port=new serial.SerialPort({path:'OFFLINE_NEVER_OPENED',baudRate:9600,autoOpen:false});
 assert.equal(port.isOpen,false);
 evidence.checks.push('Packaged serialport and native win32-x64 binding load under actual Electron; autoOpen=false construction succeeds');
 serial.SerialPort.list=forbidden('SerialPort.list');
 serial.SerialPort.prototype.open=forbidden('SerialPort.open');
 serial.SerialPort.prototype.write=forbidden('SerialPort.write');
 if(mode==='native')return finish();
 class HiddenWindow extends BrowserWindow {
  constructor(options){super({...options,show:false,fullscreen:false});evidence.windowsConstructed=(evidence.windowsConstructed||0)+1;}
  show(){} showInactive(){} focus(){} setFullScreen(){}
 }
 // Electron's BrowserWindow.getAllWindows filters by constructor.name.
 // Preserve its expected class identity while keeping test windows invisible.
 Object.defineProperty(HiddenWindow,'name',{value:'BrowserWindow'});
 const electron=require('electron');
 const shim={...electron,BrowserWindow:HiddenWindow,dialog:{...electron.dialog,showErrorBox:(title,text)=>finish(Error(title+': '+text))}};
 const load=Module._load;
 Module._load=function(name,parent,isMain){return name==='electron'?shim:load.call(this,name,parent,isMain)};
 app.on('web-contents-created',(_event,contents)=>{
  contents.on('did-fail-load',(_event,code,description,url)=>finish(Error('Renderer load failed '+code+' '+description+' '+url)));
  contents.on('render-process-gone',(_event,details)=>finish(Error('Renderer gone '+JSON.stringify(details))));
  contents.on('console-message',(_event,level,message)=>{
   if(level>=2){evidence.rendererMessages??=[];evidence.rendererMessages.push(message.slice(0,400));evidence.rendererMessages=evidence.rendererMessages.slice(-12);}
  });
 });
 req(mode==='startup-rc2'?'./rc2-rollback.js':'../'); // Actual app/package.json entry or unchanged rollback.
 await app.whenReady();
 const deadline=Date.now()+20000;
 while(Date.now()<deadline){
  const windows=BrowserWindow.getAllWindows();
  evidence.windows=windows.map(w=>({url:w.webContents.getURL(),visible:w.isVisible(),loading:w.webContents.isLoading()}));
  const main=windows.find(w=>w.webContents.getURL().endsWith('/index.html'));
  const projector=windows.find(w=>w.webContents.getURL().endsWith('/projector.html'));
  if(main&&projector&&!main.webContents.isLoading()&&!projector.webContents.isLoading()){
   const snapshot=await main.webContents.executeJavaScript('window.natureTouch.getExhibitionSnapshot()');
   const projectorPhase=await projector.webContents.executeJavaScript('document.querySelector("main")?.dataset.phase');
   evidence.lastMainSnapshot=snapshot;evidence.lastProjectorPhase=projectorPhase;
   if(snapshot.phase==='READY'&&projectorPhase==='READY'){
    evidence.windows=windows.map(w=>({url:w.webContents.getURL(),visible:w.isVisible()}));
    assert.ok(evidence.windows.every(w=>!w.visible));
    assert.deepEqual(evidence.forbiddenIo,[]);assert.deepEqual(evidence.networkAttempts,[]);
    evidence.mainSnapshot=snapshot;evidence.projectorPhase=projectorPhase;
    evidence.checks.push('Actual Main initializes; real preload/renderer IPC returns READY; Projector READY; all windows hidden');
    evidence.checks.push('No serial enumeration/open/write and no network listener; separate test profile only');
    return finish();
   }
  }
  await new Promise(r=>setTimeout(r,100));
 }
 throw Error('Main and Projector did not reach READY');
}
void run().catch(finish);
