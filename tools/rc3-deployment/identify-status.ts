import {ArduinoFirmwareService} from '../../desktop/electron/serial/arduino-firmware-service'
import type {SerialTransport} from '../../desktop/electron/serial/serial-transport'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export async function identifyDeploymentOnly(transport:SerialTransport,port:string,release:'RC3'|'RC2'='RC3',
 log:(event:string,data:unknown)=>void=()=>{},settleMs=2500){
 const expected=release==='RC3'?'3.0.0-rc3-offline':'3.0.0-rc2'
 const guard:SerialTransport={listPorts:()=>transport.listPorts(),open:async(path,baud)=>{
  const c=await transport.open(path,baud)
  return {write:async(line:string)=>{const q=JSON.parse(line);if(!['IDENTIFY','STATUS_QUERY'].includes(q.type))throw Error('Read-only TX denied: '+q.type);log('TX',q);await c.write(line)},
   close:()=>c.close(),onData:(f)=>c.onData(f),onError:(f)=>c.onError(f),onClose:(f)=>c.onClose(f)}
 }}
 const service=new ArduinoFirmwareService(guard,{readOnly:true,allowSimulationTest:false,allowRealHardwareControl:false,connectSettleMs:settleMs})
 const validate=()=>{
  const s=service.getSnapshot(),e=s.experience
  if(!s.identified||s.protocolVersion!==2||s.firmware!=='nature-touch-unified-real'||s.firmwareVersion!==expected||
   s.timelineVersion!=='25s-4c1e4167'||s.sourceRevision!=='5356f28e'||s.hardwareOutputsEnabled!==true||
   e.state!=='IDLE'||e.selectedExperienceId!==null||e.operationId!==null||e.faultCode!==null)
    throw Error('Deployment identity or inactive IDLE mismatch. No SELECT/START/RECOVER sent.')
  return s
 }
 try{
  if(!(await service.listPorts()).some(p=>p.path===port))throw Error('Selected port not discovered; no open.')
  await service.connect(port);const identity=validate();log('IDENTIFY',identity)
  const statuses=[]
  for(let i=0;i<3;i++){const status=await service.queryStatus('owner-check-'+i);validate();statuses.push(status);log('STATUS',status)}
  return {result:'READ_ONLY_PASS',release,identity,statuses,readyMeaning:'Protocol IDLE; physical pump/valve state not measured',physicalAcceptance:false,realStartSent:false}
 }finally{await service.disconnect();log('CLOSED',service.getSnapshot())}
}

async function ownerCli(){
 const args=process.argv.slice(2),value=(name:string)=>args[args.indexOf(name)+1]
 if(!args.includes('--execute')||!args.includes('--authorize-com')||!args.includes('--loads-isolated'))
  throw Error('Owner only: --execute --authorize-com --loads-isolated required before any native import or COM access.')
 const port=args.includes('--port')?value('--port'):''
 const release=args.includes('--release')?value('--release'):'RC3'
 if(!/^COM[0-9]+$/.test(port)||!['RC2','RC3'].includes(release))throw Error('Explicit COM port and RC2/RC3 required.')
 const {execFileSync}=await import('node:child_process')
 execFileSync(process.execPath,[fileURLToPath(new URL('./verify.mjs',import.meta.url))],{stdio:'inherit'})
 execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./Assert-ApplicationStopped.ps1',import.meta.url))],{stdio:'inherit'})
 const {mkdirSync,appendFileSync}=await import('node:fs')
 const {join}=await import('node:path')
 const directory=resolve(fileURLToPath(new URL('../../firmware/deployment/nature_touch_rc3_20261105/onsite-logs',import.meta.url)))
 mkdirSync(directory,{recursive:true})
 const file=join(directory,release+'-readonly-'+new Date().toISOString().replace(/[:.]/g,'-')+'.jsonl')
 const log=(event:string,data:unknown)=>appendFileSync(file,JSON.stringify({at:new Date().toISOString(),event,data})+'\n')
 const {NativeSerialTransport}=await import('../../desktop/electron/serial/native-serial-transport')
 const result=await identifyDeploymentOnly(new NativeSerialTransport(),port,release as 'RC3'|'RC2',log)
 log('RESULT',result);console.log(JSON.stringify({...result,log:file}))
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void ownerCli().catch(e=>{console.error(String(e));process.exitCode=1})
