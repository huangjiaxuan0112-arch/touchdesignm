import { ArduinoFirmwareService } from '../desktop/electron/serial/arduino-firmware-service'
import type { SerialTransport } from '../desktop/electron/serial/serial-transport'
import { firmwareExhibitionReady } from '../desktop/electron/exhibition-routing'

/** The caller supplies a transport; importing this module never discovers or opens USB. */
export async function identifyStatusOnly(
  transport: SerialTransport,
  port: string,
  log: (event:string,data:unknown)=>void = () => {},
) {
  const guarded:SerialTransport = {
    listPorts:()=>transport.listPorts(),
    open:async(path,baud)=>{
      const connection=await transport.open(path,baud)
      return {
        write:async(line)=>{
          const frame=JSON.parse(line)
          if(!['IDENTIFY','STATUS_QUERY'].includes(frame.type))throw Error('Read-only TX blocked: '+frame.type)
          log('TX',frame)
          await connection.write(line)
        },
        close:()=>connection.close(),
        onData:listener=>connection.onData(listener),
        onError:listener=>connection.onError(listener),
        onClose:listener=>connection.onClose(listener),
      }
    },
  }
  const service=new ArduinoFirmwareService(guarded,{readOnly:true,allowSimulationTest:false,allowRealHardwareControl:false})
  try{
    const ports=await service.listPorts()
    if(!ports.some(p=>p.path===port))throw Error('Selected port was not discovered; no port opened.')
    const identity=await service.connect(port)
    log('IDENTITY',identity)
    if(!firmwareExhibitionReady(identity,true)||identity.experience.state!=='IDLE')throw Error('RC2 identity/version or IDLE mismatch; stop without control commands.')
    const status=await service.queryStatus('owner-status')
    log('STATUS',status)
    if(service.getSnapshot().experience.state!=='IDLE'||!firmwareExhibitionReady(service.getSnapshot(),true)||status.snapshot.state!=='IDLE'||status.snapshot.operationId!==null||status.snapshot.selectedExperienceId!==null)throw Error('Expected freshly deployed idle Nano with no selected mode or operation.')
    return {port,identity,status}
  }finally{await service.disconnect();log('CLOSED',service.getSnapshot())}
}

async function ownerCli(){
  const {resolve,dirname,join}=await import('node:path')
  const {fileURLToPath}=await import('node:url')
  const {mkdirSync,appendFileSync}=await import('node:fs')
  const args=process.argv.slice(2),portIndex=args.indexOf('--port'),port=portIndex>=0?args[portIndex+1]:''
  if(!args.includes('--loads-isolated')||!/^COM[0-9]+$/.test(port??''))throw Error('Owner only: specify --port COM<n> --loads-isolated after physical load-power isolation. No USB opened.')
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
  const directory=join(root,'.local/onsite-acceptance')
  mkdirSync(directory,{recursive:true})
  const file=join(directory,'rc2-readonly-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid+'.jsonl')
  const log=(event:string,data:unknown)=>appendFileSync(file,JSON.stringify({at:new Date().toISOString(),event,data})+'\n')
  // Native transport is loaded only in this explicit owner CLI, never in offline tests.
  const {NativeSerialTransport}=await import('../desktop/electron/serial/native-serial-transport')
  try{
    const result=await identifyStatusOnly(new NativeSerialTransport(),port,log)
    log('RESULT',{result:'PASS',scope:'REAL_USB_IDENTITY_AND_STATUS_ONLY'})
    console.log(JSON.stringify({result:'PASS',port,firmware:result.identity.firmware,firmwareVersion:result.identity.firmwareVersion,
      timelineVersion:result.identity.timelineVersion,protocolVersion:result.identity.protocolVersion,state:result.status.snapshot.state,log:file,realStartSent:false}))
  }catch(error){log('RESULT',{result:'FAIL',error:String(error)});throw error}
}
void import('node:url').then(async({fileURLToPath})=>{
 const {resolve}=await import('node:path')
 if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await ownerCli()
}).catch(error=>{console.error(String(error));process.exitCode=1})
