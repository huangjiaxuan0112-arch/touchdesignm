import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {identifyDeploymentOnly} from '../tools/rc3-deployment/identify-status'
import {MockSerialTransport} from '../desktop/electron/serial/mock-serial-transport'
const pkg=new URL('../firmware/deployment/nature_touch_rc3_20261105/',import.meta.url)
const manifest=JSON.parse(readFileSync(new URL('PACKAGE_MANIFEST.json',pkg),'utf8'))
function fixture(version='3.0.0-rc3-offline',fault=false){
 const writes:string[]=[];let statuses=0
 const transport=new MockSerialTransport({ports:[{path:'OFFLINE_NANO'}],respond:line=>{
  const q=JSON.parse(line);writes.push(q.type)
  const ack={type:'ACK',command:q.type,accepted:true,requestId:q.requestId,state:'IDLE'}
  if(q.type==='IDENTIFY')return JSON.stringify({...ack,protocol:2,firmware:'nature-touch-unified-real',
   firmwareVersion:version,timelineVersion:'25s-4c1e4167',sourceRevision:'5356f28e',hardwareOutputsEnabled:true,capabilities:['WIND','WAVE','BUBBLE','REAL_ACTUATORS']})
  statuses++
  return JSON.stringify({type:'STATUS',requestId:q.requestId,acknowledgement:ack,snapshot:{
   state:fault&&statuses>=2?'FAULT':'IDLE',selectedExperienceId:null,operationId:null,elapsedMs:0,durationMs:null,
   faultCode:fault&&statuses>=2?'ACTUATOR_FAULT':null,hardwareOutputsEnabled:true}})
 }})
 return {transport,writes}
}
test('all 27 frozen payloads match; Main differs from accepted live implementation only by exact version gate',()=>{
 for(const [path,digest]of Object.entries(manifest.checksums))assert.equal(createHash('sha256').update(readFileSync(new URL(path,pkg))).digest('hex'),digest)
 const main=readFileSync(new URL(manifest.rc3.main,pkg),'utf8'),rollback=readFileSync(new URL(manifest.rc2.main,pkg),'utf8')
 assert.equal(main.replace('firmwareVersion: "3.0.0-rc3-offline"','firmwareVersion: "3.0.0-rc2"'),rollback)
 assert.equal(createHash('sha256').update(rollback).digest('hex'),manifest.acceptedMainSha256)
})
for(const release of ['RC3','RC2'] as const)test(release+' isolated read-only handshake accepts only matching version; no control command',async()=>{
 const f=fixture(manifest[release.toLowerCase()].version)
 const result=await identifyDeploymentOnly(f.transport,'OFFLINE_NANO',release,()=>{},0)
 assert.equal(result.result,'READ_ONLY_PASS');assert.equal(result.physicalAcceptance,false)
 assert.deepEqual(f.writes,['IDENTIFY','STATUS_QUERY','STATUS_QUERY','STATUS_QUERY','STATUS_QUERY'])
 await assert.rejects(f.transport.lastConnection!.write('{}'),/closed/)
})
test('RC3 handshake rejects RC2 identity without issuing SELECT/START/RECOVER',async()=>{
 const f=fixture('3.0.0-rc2');await assert.rejects(identifyDeploymentOnly(f.transport,'OFFLINE_NANO','RC3',()=>{},0),/identity/)
 assert.deepEqual(f.writes,['IDENTIFY','STATUS_QUERY'])
})
test('read-only fault or missing port fails closed without control commands',async()=>{
 const f=fixture('3.0.0-rc3-offline',true)
 await assert.rejects(identifyDeploymentOnly(f.transport,'OFFLINE_NANO','RC3',()=>{},0),/IDLE/)
 assert.ok(f.writes.every(t=>['IDENTIFY','STATUS_QUERY'].includes(t)))
 const missing=fixture();await assert.rejects(identifyDeploymentOnly(missing.transport,'MISSING','RC3',()=>{},0),/not discovered/)
 assert.equal(missing.transport.opened.length,0)
})
test('deployment tools default to dry-run and require separate hardware authorization',()=>{
 const upload=readFileSync(new URL('../tools/rc3-deployment/Owner-Upload.ps1',import.meta.url),'utf8')
 assert.ok(upload.indexOf('if(-not $Execute)')<upload.indexOf('Get-CimInstance'))
 assert.ok(upload.includes('$AuthorizeHardware'));assert.ok(upload.includes('$ConfirmLoadsIsolated'))
 const launch=readFileSync(new URL('../tools/rc3-deployment/Owner-Launch-Main.ps1',import.meta.url),'utf8')
 assert.ok(launch.indexOf('if(-not $Execute)')<launch.indexOf('Assert-ApplicationStopped.ps1'))
 const cli=readFileSync(new URL('../tools/rc3-deployment/identify-status.ts',import.meta.url),'utf8')
 assert.ok(cli.indexOf("args.includes('--authorize-com')")<cli.indexOf("import('../../desktop/electron/serial/native-serial-transport')"))
})
