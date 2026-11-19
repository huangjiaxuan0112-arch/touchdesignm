'use strict';
// Startup observation only. Business Main, firmware and device APIs remain unchanged.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {app,BrowserWindow}=require('electron');
const release=process.env.NATURE_TOUCH_LAUNCH_RELEASE||'RC3';
const config=JSON.parse(fs.readFileSync(path.join(__dirname,'startup-config.json'),'utf8'));
if(!['RC3','RC2'].includes(release))throw Error('Unsupported deployment release');
const selected=config.entries[release];
const run=process.env.NATURE_TOUCH_LAUNCH_RUN_DIR||path.join(__dirname,'../../../.local/main-startup',Date.now()+'-'+process.pid);
fs.mkdirSync(run,{recursive:true});
const statusFile=path.join(run,'status.json'),eventsFile=path.join(run,'startup.jsonl');
const state={schema:1,runId:path.basename(run),pid:process.pid,startedAt:new Date().toISOString(),release,
 firmwareVersion:selected.version,phase:'BOOTSTRAP',healthy:false,mainLoaded:false,projectorLoaded:false,
 mainVisible:false,projectorVisible:false,httpsRequired:!!process.env.NATURE_TOUCH_IPAD_BIND_ADDRESS,httpsReady:false,
 httpsPort:Number(process.env.NATURE_TOUCH_IPAD_PORT||8443),error:null};
let done=false,timer,healthTimer,probeBusy=false,lastProbe=0,uiBusy=false;
let lastDiagnosticWarning=0;
function diagnosticIoWarning(operation,error){
 if(Date.now()-lastDiagnosticWarning>1000){
  lastDiagnosticWarning=Date.now();
  console.warn('STARTUP_DIAGNOSTIC_IO_ERROR '+operation+' '+String(error.code||error.message).slice(0,160));
 }
}
function record(phase,extra={}){
 Object.assign(state,extra,{phase,updatedAt:new Date().toISOString()});
 // Windows/OneDrive can transiently deny replace-by-rename while a reader has
 // status.json open. Readers already reject partial JSON and retry; telemetry
 // must never throw into business Main's window creation or safety handlers.
 const text=JSON.stringify(state,null,2)+'\n';
 try{fs.writeFileSync(statusFile,text);}catch(error){diagnosticIoWarning('status',error);}
 try{fs.appendFileSync(eventsFile,JSON.stringify({at:state.updatedAt,phase,pid:process.pid,...extra})+'\n');}
 catch(error){diagnosticIoWarning('events',error);}
 console.info('NATURE_TOUCH_STARTUP '+phase+' pid='+process.pid);
}
function fail(error,phase='FAILED'){
 if(done)return;done=true;clearInterval(timer);
 record(phase,{healthy:false,error:String(error?.stack||error).slice(0,4000)});
 removeTemporaryHooks(); // Never terminate an unrelated process or force-kill this one.
}
const originalError=console.error;
function watchedError(...args){
 originalError.apply(console,args);
 if(String(args[0]).startsWith('Application startup failed:'))fail(args[1]||args[0]);
}
function onException(error){fail(error);originalError.call(console,error);app.quit();}
function onRejection(error){fail(error);originalError.call(console,error);app.quit();}
function removeTemporaryHooks(){console.error=originalError;process.removeListener('uncaughtException',onException);process.removeListener('unhandledRejection',onRejection);}
console.error=watchedError;
process.on('uncaughtException',onException);process.on('unhandledRejection',onRejection);
app.setName('Nature Touch');
app.setPath('userData',process.env.NATURE_TOUCH_LAUNCH_PROFILE||path.join(app.getPath('appData'),'Nature Touch'));
record('BOOTSTRAP');
app.on('browser-window-created',(_event,window)=>{
 record('WINDOW_CREATED');
 window.webContents.on('did-fail-load',(_e,code,message,url,mainFrame)=>{if(mainFrame&&!done)fail(Error('Renderer load '+code+' '+message+' '+url));});
 window.webContents.on('render-process-gone',(_e,details)=>{if(!done)fail(Error('Renderer gone '+JSON.stringify(details)));});
 window.webContents.on('did-finish-load',()=>{if(!done)record('RENDERER_LOADED');});
});
app.on('before-quit',()=>{if(!done)fail(Error('Application quit before startup READY'));});
app.on('will-quit',()=>{clearInterval(healthTimer);if(state.healthy)record('EXITED',{healthy:false});});
app.whenReady().then(()=>{if(!done)record('ELECTRON_READY');});
async function probeHttps(){
 if(!state.httpsRequired||probeBusy||Date.now()-lastProbe<700)return;
 lastProbe=Date.now();probeBusy=true;
 try{
  const https=require('node:https');
  const cert=fs.readFileSync(process.env.NATURE_TOUCH_IPAD_TLS_CERT_PATH);
  const expected=new crypto.X509Certificate(cert).fingerprint256;
  await new Promise((resolve,reject)=>{
   const request=https.get({host:process.env.NATURE_TOUCH_IPAD_BIND_ADDRESS,port:state.httpsPort,path:'/',ca:cert},response=>{
    const fingerprint=response.socket.getPeerCertificate().fingerprint256;
    response.resume();
    if(response.statusCode!==200||fingerprint!==expected)return reject(Error('HTTPS identity/status mismatch'));
    response.once('end',resolve);response.once('error',reject);
   });
   request.setTimeout(1000,()=>request.destroy(Error('HTTPS readiness timeout')));request.once('error',reject);
  });
  if(!done&&!state.httpsReady)record('HTTPS_READY',{httpsReady:true});
 }catch(error){state.lastHttpsError=String(error.message).slice(0,200);}
 finally{probeBusy=false;}
}
try{
 const required=['NATURE_TOUCH_IPAD_BIND_ADDRESS','NATURE_TOUCH_IPAD_TLS_KEY_PATH','NATURE_TOUCH_IPAD_TLS_CERT_PATH','NATURE_TOUCH_IPAD_PASSWORD'];
 if(required.some(k=>!process.env[k]))throw Error('Missing mandatory startup LAN configuration: '+required.filter(k=>!process.env[k]).join(','));
 state.httpsRequired=true;
 const main=path.join(__dirname,selected.file);
 if(crypto.createHash('sha256').update(fs.readFileSync(main)).digest('hex')!==selected.sha256)throw Error('Business Main SHA256 mismatch');
 if(!fs.readFileSync(main,'utf8').includes('firmwareVersion: "'+selected.version+'"'))throw Error('Firmware identity gate mismatch');
 require.resolve('serialport');require('serialport');record('DEPENDENCIES_LOADED');
 require(main);record('MAIN_IMPORTED');
 const deadline=Date.now()+30000;
 timer=setInterval(()=>{
  if(done)return;
  const windows=BrowserWindow.getAllWindows();
  const mainWindow=windows.find(w=>w.webContents.getURL().endsWith('/index.html'));
  const projector=windows.find(w=>w.webContents.getURL().endsWith('/projector.html'));
  state.mainLoaded=!!mainWindow&&!mainWindow.webContents.isLoading();
  state.projectorLoaded=!!projector&&!projector.webContents.isLoading();
  state.mainVisible=!!mainWindow&&mainWindow.isVisible();state.projectorVisible=!!projector&&projector.isVisible();
  if(state.mainLoaded&&state.projectorLoaded&&!uiBusy){
   uiBusy=true;Promise.all([
    mainWindow.webContents.executeJavaScript('window.natureTouch?.getExhibitionSnapshot?.().then(s=>s.phase)'),
    projector.webContents.executeJavaScript('document.querySelector("main")?.dataset.phase')
   ]).then(([mainPhase,projectorPhase])=>{state.mainPhase=mainPhase;state.projectorPhase=projectorPhase;})
    .catch(error=>{state.lastUiError=String(error.message).slice(0,200)}).finally(()=>{uiBusy=false;});
  }
  void probeHttps();
  if(state.mainLoaded&&state.projectorLoaded&&state.mainVisible&&state.projectorVisible&&state.mainPhase==='READY'&&state.projectorPhase==='READY'&&state.httpsReady){
   done=true;clearInterval(timer);removeTemporaryHooks();record('READY',{healthy:true});
   healthTimer=setInterval(()=>{
    const current=BrowserWindow.getAllWindows();
    const m=current.find(w=>w.webContents.getURL().endsWith('/index.html'));
    const p=current.find(w=>w.webContents.getURL().endsWith('/projector.html'));
    const visible=!!m&&!!p&&m.isVisible()&&p.isVisible();
    record(visible?'READY':'DEGRADED',{healthy:visible,mainVisible:!!m&&m.isVisible(),projectorVisible:!!p&&p.isVisible()});
   },1000);healthTimer.unref();
  }else if(Date.now()>deadline)fail(Error('Startup deadline: windows/visibility/HTTPS readiness not achieved'),'STARTUP_TIMEOUT');
 },100);
}catch(error){fail(error);app.quit();}
