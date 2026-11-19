import assert from 'node:assert/strict'
import { test } from 'node:test'
import { identifyStatusOnly } from '../tools/owner-readonly-identity'
import { MockSerialTransport } from '../desktop/electron/serial/mock-serial-transport'
import { EXHIBITION_FIRMWARE_TARGET } from '../desktop/electron/exhibition-routing'
function fixture(version: string = EXHIBITION_FIRMWARE_TARGET.firmwareVersion,faultOnExplicitStatus=false){
 let reads=0
 const writes:string[]=[]
 const transport=new MockSerialTransport({onWrite:(line,connection)=>{if(JSON.parse(line).type==='STATUS_QUERY'&&++reads===2&&faultOnExplicitStatus)connection.emitData(JSON.stringify({type:'EVENT',name:'FAULT',code:'ACTUATOR_FAULT',operationId:''})+'\n')},ports:[{path:'OFFLINE_NANO'}],respond:line=>{
  const q=JSON.parse(line);writes.push(q.type)
  const ack={type:'ACK',command:q.type,requestId:q.requestId,accepted:true,state:'IDLE'}
  return q.type==='IDENTIFY'?JSON.stringify({...ack,protocol:2,firmware:'nature-touch-unified-real',
   ...EXHIBITION_FIRMWARE_TARGET,firmwareVersion:version,hardwareOutputsEnabled:true,capabilities:['WIND','WAVE','BUBBLE','REAL_ACTUATORS']}):
   JSON.stringify({type:'STATUS',requestId:q.requestId,acknowledgement:ack,snapshot:{hardwareOutputsEnabled:true,state:'IDLE',selectedExperienceId:null,operationId:null,elapsedMs:0,durationMs:null,faultCode:null}})
 }})
 return {transport,writes}
}
test('owner read-only 30s check uses only IDENTIFY/STATUS and closes its in-memory port',async()=>{
 const f=fixture()
 const result=await identifyStatusOnly(f.transport,'OFFLINE_NANO')
 assert.equal(result.identity.firmwareVersion,EXHIBITION_FIRMWARE_TARGET.firmwareVersion)
 assert.deepEqual(f.writes,['IDENTIFY','STATUS_QUERY','STATUS_QUERY'])
 await assert.rejects(f.transport.lastConnection!.write('{}'),/closed/)
})
test('owner read-only check rejects a wrong firmware version without SELECT/START or recovery',async()=>{
 const f=fixture('old-version')
 await assert.rejects(identifyStatusOnly(f.transport,'OFFLINE_NANO'),/identity\/version/)
 assert.deepEqual(f.writes,['IDENTIFY','STATUS_QUERY'])
})
test('owner read-only check refuses undiscovered port before any open or write',async()=>{
 const f=fixture()
 await assert.rejects(identifyStatusOnly(f.transport,'NOT_DISCOVERED'),/not discovered/)
 assert.equal(f.transport.opened.length,0)
 assert.deepEqual(f.writes,[])
})

test('owner read-only check rejects a fault arriving during the final status read',async()=>{
 const f=fixture(EXHIBITION_FIRMWARE_TARGET.firmwareVersion,true)
 await assert.rejects(identifyStatusOnly(f.transport,'OFFLINE_NANO'),/freshly deployed idle/)
 assert.equal(f.writes.some(x=>['SELECT','START','STOP','RECOVER'].includes(x)),false)
})
