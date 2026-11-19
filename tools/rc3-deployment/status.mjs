import {execFileSync}from'node:child_process';
import {readFileSync,readdirSync,existsSync,statSync}from'node:fs';
import {resolve,join}from'node:path';
const root=resolve(import.meta.dirname,'../..');
export function classifyStartup(processInfo,status,listenerPids=[],now=Date.now()){
 if(!processInfo)return {state:'EXITED',ready:false};
 if(!status||status.pid!==processInfo.pid)return {state:'UNVERIFIED_OR_RESIDUAL',ready:false,reason:'No PID-matched startup health record'};
 if(['FAILED','STARTUP_TIMEOUT','DEGRADED'].includes(status.phase))return {state:status.phase,ready:false,error:status.error};
 const fresh=now-Date.parse(status.updatedAt)<5000;
 if(status.phase==='READY'&&status.healthy&&fresh&&status.mainVisible&&status.projectorVisible&&status.httpsReady&&listenerPids.includes(processInfo.pid))
  return {state:'RUNNING_READY',ready:true};
 if(status.phase==='READY')return {state:'STALE_OR_INCOMPLETE_HEALTH',ready:false};
 return {state:now-Date.parse(status.startedAt)>35000?'STUCK_STARTUP':'STARTING',ready:false,phase:status.phase};
}
export function readStartupStatus(){
 const script=`[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $root='${root.replaceAll("'","''")}'; $all=@(Get-CimInstance Win32_Process); $m=@($all|Where-Object {$_.Name -eq 'electron.exe' -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine -like ('*'+$root+'*')}); $listeners=@(Get-NetTCPConnection -State Listen -LocalPort 8443 -ErrorAction SilentlyContinue); @{processes=@($m|ForEach-Object {@{pid=$_.ProcessId;parentPid=$_.ParentProcessId;command=$_.CommandLine;createdUtc=$_.CreationDate.ToUniversalTime().ToString('o')}});listenerPids=@($listeners|ForEach-Object {$_.OwningProcess})}|ConvertTo-Json -Depth 4 -Compress`;
 const data=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8'}).replace(/^\uFEFF/,''));
 const directory=join(root,'.local/main-startup');
 const runs=existsSync(directory)?readdirSync(directory).map(n=>join(directory,n,'status.json')).filter(existsSync).map(p=>{
  try{return JSON.parse(readFileSync(p,'utf8'))}catch{return null}
 }).filter(Boolean):[];
 return {checkedUtc:new Date().toISOString(),listenerPids:data.listenerPids,
  processes:data.processes.map(p=>({...p,...classifyStartup(p,runs.find(r=>r.pid===p.pid),data.listenerPids)})),
  permission:'READ_ONLY_PROCESS_AND_TCP_METADATA_NO_SERIAL'};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))console.log(JSON.stringify(readStartupStatus(),null,2));
