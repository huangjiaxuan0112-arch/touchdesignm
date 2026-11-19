import{spawn}from'node:child_process';
import{mkdirSync,createWriteStream,existsSync,readFileSync}from'node:fs';
import{resolve,join}from'node:path';
import{verifyMain}from'./verify-main.mjs';
import{readStartupStatus}from'../rc3-deployment/status.mjs';
const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2);
const release=args.includes('--release')?args[args.indexOf('--release')+1]:'RC4';
if(!['RC4','RC3'].includes(release))throw Error('Release must be RC4 or RC3');
const artifact=verifyMain();
if(!args.includes('--execute')){
 console.log(JSON.stringify({result:'DRY_RUN_ONLY',entry:artifact.absoluteEntry,release,version:artifact.entries[release].version,
  realMainStarted:false,serialOpened:false,httpsPort:8443}));
}else{
 const prior=readStartupStatus();
 if(prior.processes.length||prior.listenerPids.length)throw Error('Existing Main/residual process or 8443 owner: '+JSON.stringify(prior));
 const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
 const directory=join(root,'.local/main-startup',id);mkdirSync(directory,{recursive:true});
 const env={...process.env,NATURE_TOUCH_LAUNCH_RUN_DIR:directory,NATURE_TOUCH_LAUNCH_RELEASE:release};
 delete env.NODE_PATH;delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
 const child=spawn(join(root,'desktop/node_modules/electron/dist/electron.exe'),[artifact.absoluteEntry],{cwd:join(root,'desktop'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(createWriteStream(join(directory,'stdout.log')));child.stderr.pipe(createWriteStream(join(directory,'stderr.log')));
 console.log('Main launched but NOT READY; pid='+child.pid+'; logs='+directory);
 let announced=false;
 const monitor=setInterval(()=>{
  const file=join(directory,'status.json');if(!existsSync(file))return;
  let status;try{status=JSON.parse(readFileSync(file,'utf8'))}catch{return}
  if(status.pid===child.pid&&status.phase==='READY'&&status.healthy&&status.mainVisible&&status.projectorVisible&&status.httpsReady&&!announced){announced=true;console.log('READY: Main + Projector visible and HTTPS verified; pid='+child.pid);}
  if(['FAILED','STARTUP_TIMEOUT'].includes(status.phase)){console.error('STARTUP FAILED: '+status.error+'; logs='+directory);clearInterval(monitor);}
 },300);
 child.once('error',e=>{clearInterval(monitor);console.error('Process launch failed:',e);process.exitCode=1});
 child.once('exit',code=>{clearInterval(monitor);if(!announced||code!==0)process.exitCode=1;console.log('Main exited; code='+code+'; logs='+directory)});
}
