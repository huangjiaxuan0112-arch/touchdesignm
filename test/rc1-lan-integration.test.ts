import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { request as httpsRequest } from 'node:https'
import { ArduinoFirmwareService } from '../desktop/electron/serial/arduino-firmware-service'
import { MockSerialTransport } from '../desktop/electron/serial/mock-serial-transport'
import { ExperienceCoordinator } from '../desktop/electron/experience-coordinator'
import { ExhibitionLifecycleController } from '../desktop/experience/exhibition-lifecycle-controller'
import { MockExperienceController } from '../desktop/experience/mock-experience-controller'
import { createExperienceIpcHandlers } from '../desktop/electron/experience-ipc-handlers'
import { createTestIpadLanServer } from '../desktop/electron/ipad-lan-server'
import { EXHIBITION_FIRMWARE_TARGET, firmwareExhibitionReady } from '../desktop/electron/exhibition-routing'
import type { ExperienceControlState } from '../desktop/shared/experience-control-protocol'
import type { ExperienceId } from '../desktop/shared/experience-definitions'

class Clock {
  time=0
  id=0
  timers=new Map<number,{at:number; fn:()=>void}>()
  now=()=>this.time
  schedule=(fn:()=>void,ms:number)=>{const id=++this.id;this.timers.set(id,{at:this.time+ms,fn});return()=>{this.timers.delete(id)}}
  advance(ms:number){const end=this.time+ms;for(;;){const next=[...this.timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;this.timers.delete(next[0]);this.time=next[1].at;next[1].fn()}this.time=end}
}
const password='Offline-RC2-LAN-fixture-20261105'
// Protocol response fixture only: no NativeSerialTransport import, USB or actual firmware execution.
function device(version: string = EXHIBITION_FIRMWARE_TARGET.firmwareVersion){
  let state:ExperienceControlState='IDLE', selected:ExperienceId|null=null, operationId:string|null=null
  const writes:Record<string,unknown>[]=[]
  const transport=new MockSerialTransport({ports:[{path:'OFFLINE_NANO',manufacturer:'In-memory protocol fixture'}],respond:line=>{
    const q=JSON.parse(line);writes.push(q)
    const ack={type:'ACK',accepted:true,command:q.type,requestId:q.requestId,state}
    if(q.type==='IDENTIFY')return JSON.stringify({...ack,protocol:2,firmware:'nature-touch-unified-real',
      ...EXHIBITION_FIRMWARE_TARGET,firmwareVersion:version,hardwareOutputsEnabled:true,capabilities:['WIND','WAVE','BUBBLE','REAL_ACTUATORS']})
    if(q.type==='STATUS_QUERY')return JSON.stringify({type:'STATUS',requestId:q.requestId,acknowledgement:ack,
      snapshot:{state,selectedExperienceId:selected,operationId,elapsedMs:state==='COMPLETED'?30000:0,
        durationMs:selected?30000:null,faultCode:state==='FAULT'?'HOST_TIMEOUT':null,hardwareOutputsEnabled:true}})
    if(q.type==='SELECT'){state='IDLE';selected=q.experienceId;operationId=null}
    if(q.type==='START'){state='RUNNING';operationId=q.operationId}
    if(q.type==='STOP'){const op=operationId;state='IDLE';operationId=null;return JSON.stringify({...ack,state:'STOPPING',operationId:op})+'\n'+JSON.stringify({type:'EVENT',name:'STOPPED',operationId:op})}
    if(q.type==='RECOVER'){state='IDLE';selected=null;operationId=null}
    return JSON.stringify({...ack,state,operationId})
  }})
  return {transport,writes,
    complete(){state='COMPLETED';transport.lastConnection!.emitData(JSON.stringify({type:'EVENT',name:'COMPLETED',operationId,experienceId:selected})+'\n')},
    fault(){state='FAULT';transport.lastConnection!.emitData(JSON.stringify({type:'EVENT',name:'FAULT',operationId,code:'HOST_TIMEOUT'})+'\n')},
    lateComplete(){transport.lastConnection!.emitData(JSON.stringify({type:'EVENT',name:'COMPLETED',operationId})+'\n')},
  }
}
function http(port:number,path:string,body?:unknown,cookie?:string){
  return new Promise<{status:number;body:any;cookie:string}>((resolve,reject)=>{
    const req=httpsRequest({hostname:'127.0.0.1',port,path,rejectUnauthorized:false,method:body?'POST':'GET',
      headers:{Origin:'https://127.0.0.1:'+port,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})}},res=>{
      let text='';res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode!,body:JSON.parse(text),cookie:res.headers['set-cookie']?.[0]?.split(';')[0]??''}))
    });req.on('error',reject);req.end(body?JSON.stringify(body):undefined)
  })
}
async function system(version: string = EXHIBITION_FIRMWARE_TARGET.firmwareVersion,approved=true){
  const clock=new Clock(),board=device(version)
  const service=new ArduinoFirmwareService(board.transport,{readOnly:!approved,allowRealHardwareControl:approved,connectSettleMs:0,heartbeatIntervalMs:60000})
  await service.connect('OFFLINE_NANO')
  const mock=new MockExperienceController({clock})
  const adapter={
    selectExperience:(r:string,m:ExperienceId)=>service.selectExperience(r,m),start:(r:string,o:string)=>service.start(r,o),
    stop:(r:string,o:string)=>service.stop(r,o),queryStatus:(r:string)=>service.queryStatus(r),
    recover:(r:string)=>service.recover(r),getExperienceSnapshot:()=>service.getSnapshot().experience,
    canStart:()=>firmwareExhibitionReady(service.getSnapshot(),approved),onStateChange:(fn:()=>void)=>service.onStateChange(()=>fn()),
  }
  const mockAdapter={selectExperience:mock.selectExperience.bind(mock),start:mock.start.bind(mock),stop:mock.stop.bind(mock),
    recover:mock.recover.bind(mock),queryStatus:mock.queryStatus.bind(mock),getExperienceSnapshot:mock.getSnapshot.bind(mock),canStart:()=>true,
    onStateChange:(fn:()=>void)=>mock.onStateChange(()=>fn())}
  const coordinator=new ExperienceCoordinator({mock:mockAdapter,firmware:adapter})
  const lifecycle=new ExhibitionLifecycleController(coordinator,{getSnapshot:()=>service.getSnapshot().experience},clock,
    {mode:'firmware',requireProjectorMedia:true,canSelect:adapter.canStart})
  const server=createTestIpadLanServer({bindAddress:'127.0.0.1',port:0,password,
    tlsKey:readFileSync(new URL('./fixtures/ipad-test-key.pem',import.meta.url),'utf8'),
    tlsCertificate:readFileSync(new URL('./fixtures/ipad-test-cert.pem',import.meta.url),'utf8'),
    staticDirectory:fileURLToPath(new URL('../desktop/ipad/',import.meta.url))},lifecycle,()=>{
      const s=service.getSnapshot(),verified=adapter.canStart()
      return {runtimeMode:'exhibition',deviceSource:'firmware',deviceReady:verified,
        device:{connectionState:s.connectionState,identified:s.identified,state:s.experience.state,firmware:s.firmware,
          firmwareVersion:s.firmwareVersion??null,verified,hardwareOutputsEnabled:s.hardwareOutputsEnabled}}
    })
  const detach=service.onStateChange(()=>server.publishStatus())
  const port=await server.start(),login=await http(port,'/api/login',{password})
  assert.equal(login.status,200)
  const cookie=login.cookie
  const handlers=createExperienceIpcHandlers({mock,firmware:service},coordinator,lifecycle)
  return {clock,board,service,lifecycle,server,port,cookie,
    start:(op:string)=>handlers['experience:dispatch']({type:'START',mode:'mock',operationId:op,requestId:'start-'+op}) as Promise<any>,
    report:(experienceId:ExperienceId,op:string,event:'ready'|'playing'|'ended')=>lifecycle.reportProjectorMedia({
      event,experienceId,operationId:op,occurredAtMs:clock.now(),currentTime:event==='ended'?25:0,...(event==='ready'?{durationSeconds:25}:{})}),
    close:async()=>{detach();await server.close();lifecycle.dispose();coordinator.dispose();await service.disconnect()},
  }
}
test('iPad HTTPS -> firmware lifecycle waits for explicit completion in all three in-memory protocol rounds',async()=>{
  const s=await system()
  try{
    assert.deepEqual(s.board.writes.map(x=>x.type),['IDENTIFY','STATUS_QUERY'],'connect must not SELECT or START')
    for(const [index,mode]of (['WIND','WAVE','BUBBLE'] as const).entries()){
      const selected=await http(s.port,'/api/select',{experienceId:mode,mode:'mock'},s.cookie)
      assert.equal(selected.status,202)
      assert.equal(s.board.writes.filter(x=>x.type==='SELECT').at(-1)?.experienceId,mode)
      const op='lan-op-'+index,pending=s.start(op)
      assert.equal(s.lifecycle.getSnapshot().phase,'STARTING')
      assert.equal(s.board.writes.filter(x=>x.type==='START').length,index,'no device START before mediaReady')
      assert.equal(await s.report(mode,'stale-op','ready'),false)
      await s.report(mode,op,'ready');await pending
      assert.equal(s.lifecycle.getSnapshot().phase,'WAITING')
      await s.report(mode,op,'playing')
      await assert.rejects(s.start('repeat-'+index),/cannot START/)
      assert.equal((await http(s.port,'/api/select',{experienceId:'WIND'},s.cookie)).status,409)
      s.clock.advance(10000);assert.equal(s.lifecycle.getSnapshot().phase,'EXPERIENCE')
      s.clock.advance(15000);assert.equal(s.lifecycle.getSnapshot().phase,'AWAIT_COMPLETION')
      await s.report(mode,op,'ended')
      s.clock.advance(5000);assert.equal(s.lifecycle.getSnapshot().phase,'AWAIT_COMPLETION','30s alone is not completion confirmation')
      s.board.transport.lastConnection!.emitData(JSON.stringify({type:'EVENT',name:'COMPLETED',operationId:'stale-op'})+'\n')
      assert.equal(s.service.getSnapshot().experience.state,'RUNNING')
      s.board.complete();s.clock.advance(0);assert.equal(s.lifecycle.getSnapshot().phase,'COOLDOWN')
      assert.equal((await http(s.port,'/api/select',{experienceId:mode},s.cookie)).status,409)
      s.clock.advance(2999);assert.equal(s.lifecycle.getSnapshot().phase,'COOLDOWN')
      s.board.lateComplete();s.clock.advance(1);assert.equal(s.lifecycle.getSnapshot().phase,'READY')
    }
    assert.equal(s.board.writes.filter(x=>x.type==='START').length,3)
    assert.equal(s.board.writes.filter(x=>x.type==='SELECT').length,3)
    assert.equal(s.board.writes.some(x=>x.type==='RECOVER'),false)
    assert.equal(s.board.transport.opened.length,1,'no automatic reopen')
  }finally{await s.close()}
})
for(const [version,approved]of [['unknown',true],[EXHIBITION_FIRMWARE_TARGET.firmwareVersion,false]] as const)test('iPad cannot bypass 30s identity/deployment gate: '+version+'/'+approved,async()=>{
  const s=await system(version,approved)
  try{const before=s.board.writes.length
    assert.equal((await http(s.port,'/api/select',{experienceId:'WIND',mode:'mock'},s.cookie)).status,503)
    assert.equal(s.board.writes.length,before)
    assert.equal(s.lifecycle.getSnapshot().phase,'READY')
  }finally{await s.close()}
})
test('real-service HOST_TIMEOUT event locks the same lifecycle immediately; late COMPLETED cannot restart or clear FAULT',async()=>{
  const s=await system()
  try{
    await http(s.port,'/api/select',{experienceId:'WIND'},s.cookie)
    const pending=s.start('fault-op');await s.report('WIND','fault-op','ready');await pending
    const before=s.board.writes.length
    s.board.fault();assert.equal(s.lifecycle.getSnapshot().phase,'FAULT')
    const latched=s.lifecycle.getSnapshot();await s.service.queryStatus('fault-status')
    assert.deepEqual(s.lifecycle.getSnapshot(),latched,'repeated FAULT status preserves the same latched lifecycle revision')
    s.board.lateComplete();s.clock.advance(60000)
    assert.equal(s.service.getSnapshot().experience.state,'FAULT')
    assert.equal(s.lifecycle.getSnapshot().phase,'FAULT')
    assert.equal((await http(s.port,'/api/select',{experienceId:'WAVE'},s.cookie)).status,409)
    assert.deepEqual(s.board.writes.slice(before).map(x=>x.type),['STATUS_QUERY'],'only the explicit fault-status read is allowed; no automatic control')
  }finally{await s.close()}
})
