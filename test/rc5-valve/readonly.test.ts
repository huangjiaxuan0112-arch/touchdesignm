import{test}from'node:test';import assert from'node:assert/strict';import{identifyMappingOnly}from'../../tools/rc5-valve/identify-status';import{MockSerialTransport}from'../../desktop/electron/serial/mock-serial-transport';
function fixture(version='3.0.0-rc5-d5route'){
 const tx:string[]=[];const transport=new MockSerialTransport({ports:[{path:'OFFLINE_NANO'}],respond:line=>{
  const q=JSON.parse(line);tx.push(q.type);const ack={type:'ACK',command:q.type,requestId:q.requestId,accepted:true,state:'IDLE'};
  if(q.type==='IDENTIFY')return JSON.stringify({...ack,protocol:2,firmware:'nature-touch-unified-real',firmwareVersion:version,
   timelineVersion:'25s-4c1e4167',sourceRevision:'5356f28e',hardwareOutputsEnabled:true,capabilities:['WIND','WAVE','BUBBLE','REAL_ACTUATORS']});
  return JSON.stringify({type:'STATUS',requestId:q.requestId,acknowledgement:ack,snapshot:{state:'IDLE',operationId:null,selectedExperienceId:null,elapsedMs:0,durationMs:null,faultCode:null,hardwareOutputsEnabled:true}});
 }});return{tx,transport};
}
test('RC5 owner tool accepts matching Protocol v2 only and never sends a control command',async()=>{
 const f=fixture();const result=await identifyMappingOnly(f.transport,'OFFLINE_NANO','RC5',()=>{},0);
 assert.equal(result.result,'READ_ONLY_PASS');assert.equal(result.identity.firmwareVersion,'3.0.0-rc5-d5route');
 assert.ok(f.tx.every(t=>['IDENTIFY','STATUS_QUERY'].includes(t)));assert.equal(result.realStartSent,false);
});
test('RC5 owner tool rejects RC4 identity before any mode or actuator command',async()=>{
 const f=fixture('3.0.0-rc4-d6inflate');await assert.rejects(identifyMappingOnly(f.transport,'OFFLINE_NANO','RC5',()=>{},0),/identity/);
 assert.deepEqual(f.tx,['IDENTIFY','STATUS_QUERY']);
});
