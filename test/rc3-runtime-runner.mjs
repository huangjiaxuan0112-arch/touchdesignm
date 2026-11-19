import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {verifyPackage} from '../tools/rc3-deployment/verify.mjs';
const root=resolve(import.meta.dirname,'..');
const directory=join(root,'.validation/rc3-runtime-'+new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(directory,{recursive:true});
verifyPackage();
const results=[];
for(const mode of ['legacy-resolution','native','startup','startup-rc2']){
 const out=join(directory,mode);
 const env={...process.env,RC3_RUNTIME_EVIDENCE:out};
 delete env.NODE_PATH;delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
 for(const key of Object.keys(env))if(key.startsWith('NATURE_TOUCH_IPAD_'))delete env[key];
 const child=spawn(join(root,'desktop/node_modules/electron/dist/electron.exe'),
  [join(root,'test/rc3-runtime-startup.cjs'),'--test-mode='+mode],
  {cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',done)});
 writeFileSync(join(directory,mode+'-stdout.log'),stdout);writeFileSync(join(directory,mode+'-stderr.log'),stderr);
 const record=JSON.parse(readFileSync(join(out,'result.json'),'utf8'));results.push(record);
 if(code!==0||record.result!=='PASS')throw Error(JSON.stringify({mode,code,errors:record.errors,directory}));
 console.log('PASS '+mode);
}
writeFileSync(join(directory,'summary.json'),JSON.stringify({result:'PASS',results},null,2));
const target=join(root,'firmware/deployment/nature_touch_rc3_20261105/runtime-tests.json');
writeFileSync(target,JSON.stringify({result:'PASS',directory,results},null,2));
console.log(JSON.stringify({result:'PASS',directory,modes:results.length}));
