// Real Electron + real packaged JS/native modules; only I/O and visible windows are blocked.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {app,BrowserWindow}=require('electron');
const root=path.resolve(__dirname,'..');
const pkg=path.join(root,'desktop/out-exhibition-rc3');
const evidenceDir=process.env.RC3_RUNTIME_EVIDENCE;
if(!evidenceDir)throw Error('Explicit isolated evidence directory required');
const mode=process.argv.find(a=>a.startsWith('--test-mode='))?.split('=')[1]||'startup';
if(mode==='telemetry-error'){
 const write=fs.writeFileSync,append=fs.appendFileSync;
 let failedStatus=0,failedEvents=0;
 fs.writeFileSync=function(file,...args){
  if(String(file).endsWith('launch'+path.sep+'status.json')&&failedStatus++<5){const e=Error('Injected Windows status EPERM');e.code='EPERM';throw e;}
  return write.call(this,file,...args);
 };
 fs.appendFileSync=function(file,...args){
  if(String(file).endsWith('launch'+path.sep+'startup.jsonl')&&failedEvents++<1){const e=Error('Injected events EPERM');e.code='EPERM';throw e;}
  return append.call(this,file,...args);
 };
}
fs.mkdirSync(evidenceDir,{recursive:true});
app.setPath('userData',path.join(evidenceDir,'profile'));
app.setPath('sessionData',path.join(evidenceDir,'session'));
for(const name of Object.keys(process.env))if(name.startsWith('NATURE_TOUCH_IPAD_'))delete process.env[name];
delete process.env.NODE_PATH;delete process.env.ELECTRON_RENDERER_URL;
process.env.NATURE_TOUCH_LAUNCH_PROFILE=path.join(evidenceDir,'profile');
process.env.NATURE_TOUCH_LAUNCH_RUN_DIR=path.join(evidenceDir,'launch');
process.env.NATURE_TOUCH_LAUNCH_RELEASE=mode==='startup-rc2'?'RC2':'RC3';
if(mode!=='missing-env'){
 process.env.NATURE_TOUCH_IPAD_BIND_ADDRESS=process.env.RC3_TEST_BIND;
 process.env.NATURE_TOUCH_IPAD_PORT=process.env.RC3_TEST_PORT;
 process.env.NATURE_TOUCH_IPAD_PASSWORD='Offline-startup-test-'+process.pid;
 process.env.NATURE_TOUCH_IPAD_TLS_KEY_PATH=path.join(root,'.local/ipad-lan/key-'+process.env.RC3_TEST_BIND+'.pem');
 process.env.NATURE_TOUCH_IPAD_TLS_CERT_PATH=path.join(root,'.local/ipad-lan/cert-'+process.env.RC3_TEST_BIND+'.pem');
}
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
const nativeListen=net.Server.prototype.listen;
net.Server.prototype.listen=function(...args){
 const port=typeof args[0]==='object'?args[0].port:args[0];
 if(Number(port)===8443||Number(port)!==Number(process.env.RC3_TEST_PORT))throw Error('Unexpected listener forbidden: '+port);
 evidence.networkAttempts.push({port:Number(port),host:args[1]});
 return nativeListen.apply(this,args);
};
const req=Module.createRequire(path.join(pkg,'main/main.js'));
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
 assert.ok(evidence.resolved.startsWith(path.join(root,'desktop/node_modules')+path.sep));
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
  show(){this.__showRequested=true;} showInactive(){this.__showRequested=true;} focus(){} setFullScreen(){}
  isVisible(){return !!this.__showRequested;}
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
 if(['missing-env','occupied-port'].includes(mode))app.on('will-quit',()=>{
  const status=JSON.parse(fs.readFileSync(path.join(evidenceDir,'launch/status.json'),'utf8'));
  assert.equal(status.phase,'FAILED');assert.match(status.error,mode==='missing-env'?/Missing mandatory startup LAN configuration/:/EADDRINUSE/);
  evidence.startupStatus=status;evidence.checks.push('Missing LAN config fails closed with earliest-stage log, not READY');finish();
 });
 req('./bootstrap.cjs'); // Actual production bootstrap and unchanged business Main.
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
   const statusPath=path.join(evidenceDir,'launch/status.json');
   const status=fs.existsSync(statusPath)?JSON.parse(fs.readFileSync(statusPath,'utf8')):null;
   if(snapshot.phase==='READY'&&projectorPhase==='READY'&&status?.phase==='READY'&&status.healthy){
    evidence.windows=windows.map(w=>({url:w.webContents.getURL(),visible:BrowserWindow.prototype.isVisible.call(w),showRequested:w.__showRequested}));
    assert.ok(evidence.windows.every(w=>!w.visible));
    assert.deepEqual(evidence.forbiddenIo,[]);
    assert.equal(evidence.networkAttempts.length,1);
    assert.notEqual(evidence.networkAttempts[0].port,8443);
    evidence.startupStatus=status;
    const https=require('node:https'),cert=fs.readFileSync(process.env.NATURE_TOUCH_IPAD_TLS_CERT_PATH);
    evidence.https=await new Promise((resolve,reject)=>https.get({host:process.env.RC3_TEST_BIND,port:Number(process.env.RC3_TEST_PORT),path:'/',ca:cert},response=>{
     let body='';response.on('data',b=>body+=b);response.on('end',()=>resolve({status:response.statusCode,bytes:Buffer.byteLength(body),port:Number(process.env.RC3_TEST_PORT)}));
    }).on('error',reject));
    assert.equal(evidence.https.status,200);
    assert.ok(evidence.windows.every(w=>w.showRequested));
    evidence.mainSnapshot=snapshot;evidence.projectorPhase=projectorPhase;
    evidence.checks.push('Actual Main initializes; real preload/renderer IPC returns READY; Projector READY; all windows hidden');
    evidence.checks.push('No serial I/O; actual HTTPS on isolated non-8443 test port; separate profile; display requests observed with native windows hidden');
    return finish();
   }
  }
  await new Promise(r=>setTimeout(r,100));
 }
 throw Error('Main and Projector did not reach READY');
}
void run().catch(finish);
