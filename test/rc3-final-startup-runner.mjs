import{spawn}from'node:child_process';import{createServer}from'node:net';
import{resolve,join}from'node:path';import{networkInterfaces}from'node:os';
import{readFileSync,mkdirSync,writeFileSync,existsSync}from'node:fs';
import{verifyFinalMain}from'../tools/rc3-deployment/verify-final-main.mjs';
const root=resolve(import.meta.dirname,'..');verifyFinalMain();
const bind=Object.values(networkInterfaces()).flat().find(i=>i?.family==='IPv4'&&!i.internal&&existsSync(join(root,'.local/ipad-lan/cert-'+i.address+'.pem')))?.address;
if(!bind)throw Error('No current private interface with existing test TLS certificate');
const directory=join(root,'.validation/rc3-final-startup-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(directory,{recursive:true});
const results=[];
for(const mode of ['startup','startup-rc2','missing-env','occupied-port','telemetry-error']){
 let occupied;
 const port=await new Promise((resolve,reject)=>{const s=createServer(socket=>{socket.on('error',()=>{});socket.destroy();});s.once('error',reject);s.listen(0,mode==='occupied-port'?bind:'127.0.0.1',()=>{const p=s.address().port;if(mode==='occupied-port'){occupied=s;resolve(p)}else s.close(()=>resolve(p));});});
 if(port===8443)throw Error('8443 forbidden in offline tests');
 const out=join(directory,mode),env={...process.env,RC3_RUNTIME_EVIDENCE:out,RC3_TEST_BIND:bind,RC3_TEST_PORT:String(port)};
 delete env.NODE_PATH;delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
 const child=spawn(join(root,'desktop/node_modules/electron/dist/electron.exe'),[join(root,'test/rc3-final-startup.cjs'),'--test-mode='+mode],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',done)});
 if(occupied)await new Promise(done=>occupied.close(done));
 writeFileSync(join(directory,mode+'-stdout.log'),stdout);writeFileSync(join(directory,mode+'-stderr.log'),stderr);
 const record=JSON.parse(readFileSync(join(out,'result.json'),'utf8'));results.push(record);
 if(code!==0||record.result!=='PASS')throw Error(JSON.stringify({mode,code,errors:record.errors,directory}));
 console.log('PASS '+mode);
}
const report={result:'PASS',directory,results,port8443Used:false,hardwareAccess:false,physicalWindowVisibilityVerified:false};
writeFileSync(join(root,'firmware/deployment/nature_touch_rc3_20261105/final-startup-tests.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({result:'PASS',directory,cases:results.length}));
