import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync,writeFileSync } from 'node:fs'
import { FirmwareJsonlDecoder,parseFirmwareJsonObject } from '../../desktop/electron/serial/firmware-protocol'
import { FirmwareWireProbe,wireDiagnostic } from '../../desktop/electron/serial/firmware-wire-diagnostics'

const output=new URL('../../firmware/releases/nature_touch_rc3_comm_diagnostics_20261105/evidence/',import.meta.url)
const rc2=JSON.parse(readFileSync(new URL('avr-tx/RC2-tx.json',output),'utf8'))
const rc3=JSON.parse(readFileSync(new URL('avr-tx/RC3-tx.json',output),'utf8'))
const actualFrames=[...rc2.frames,...rc3.frames].map((f:{raw:string})=>f.raw) as string[]
const decoded=(chunks:string[])=>{const d=new FirmwareJsonlDecoder(384);return chunks.flatMap(c=>d.push(c))}

test('actual RC2/RC3 UART TX preserves exact frames across every split point and deterministic coalescing',()=>{
  let splits=0
  for(const raw of actualFrames) {
    const expected=[{type:'line',line:raw.replace(/\r?\n$/,'')}]
    for(let cut=0;cut<=raw.length;cut++) {
      assert.deepEqual(decoded([raw.slice(0,cut),raw.slice(cut)]),expected)
      splits++
    }
  }
  const stream=actualFrames.join('')
  const expected=actualFrames.map(raw=>({type:'line',line:raw.replace(/\r?\n$/,'')}))
  for(const width of [1,2,3,7,31,64,383,384,385,4096,stream.length]) {
    const chunks=[];for(let i=0;i<stream.length;i+=width)chunks.push(stream.slice(i,i+width))
    assert.deepEqual(decoded(chunks),expected)
  }
  writeFileSync(new URL('decoder-fragmentation.json',output),JSON.stringify({result:'PASS',actualFrames:actualFrames.length,everySplitCases:splits,chunkWidths:12},null,2))
})

test('frame length boundary, missing LF, truncation, and recovery do not silently repair JSON',()=>{
  const make=(n:number)=>'{"v":"'+'x'.repeat(n-8)+'"}'
  for(const n of [383,384,385]) {
    const line=make(n);assert.equal(line.length,n)
    assert.equal(decoded([line+'\n'])[0].type,n<=384?'line':'oversized')
    // Existing implementation counts CR against 384 before removing it.
    assert.equal(decoded([line+'\r\n'])[0].type,n<384?'line':'oversized')
  }
  const lostLF=decoded([actualFrames[1].trimEnd()+actualFrames[2]])
  const joined=lostLF[0]
  if(joined.type==='line') assert.throws(()=>parseFirmwareJsonObject(joined.line))
  else assert.equal(joined.type,'oversized')
  const truncated=decoded(['{"type":"STATUS","requestId":"r7"\n'])
  assert.equal(truncated[0].type,'line')
  const fragment=truncated[0]
  if(fragment.type==='line')assert.throws(()=>parseFirmwareJsonObject(fragment.line))
  const d=new FirmwareJsonlDecoder(384)
  assert.deepEqual(d.push('x'.repeat(10000)),[])
  assert.equal(d.push('\n{"type":"ACK"}\n').length,2)
})

test('native byte probe retains raw hex, CRLF, stream offsets and chunk boundaries before text decoding',()=>{
  const probe=new FirmwareWireProbe()
  const bytes=Buffer.from('{"type":"STATUS","x":"é"}\r\n')
  const split=bytes.indexOf(0xc3)+1
  assert.deepEqual(probe.push(bytes.subarray(0,split),true),[])
  const raw=probe.push(bytes.subarray(split),true)[0]
  const diag=wireDiagnostic(raw)
  assert.equal(diag.source,'native-buffer');assert.equal(diag.bytes,bytes.length-1)
  assert.equal(diag.chunks,2);assert.equal(diag.terminator,'CRLF')
  assert.equal(diag.startOffset,0);assert.equal(diag.endOffset,bytes.length)
  assert.equal(diag.prefix?.hex,bytes.subarray(0,Math.min(32,bytes.length-1)).toString('hex'))
  assert.equal(diag.asciiOnly,false)
  const long=new FirmwareWireProbe();long.push(Buffer.alloc(1000000,0x78),true)
  const partial=long.partial()!
  assert.equal(partial.head.length,1536);assert.equal(partial.tail.length,32)
  assert.equal(partial.meta.bytes,1000000)
})

test('exhaustive source-derived real STATUS bounds fit 384 including CR; 358/247 remains unreconstructable',()=>{
  let max=0,maxFrame=''
  const codes=[null,'INVALID_TIMELINE','ACTUATOR_FAULT','HOST_TIMEOUT']
  for(const state of ['IDLE','RUNNING','STOPPING','COMPLETED','FAULT'])
  for(const mode of [null,'WIND','WAVE','BUBBLE'])
  for(const requestId of ['r7','x'.repeat(16)])
  for(const operationId of [null,'x'.repeat(16)])
  for(const elapsedMs of [0,999,9999,25000])
  for(const faultCode of codes) {
    const s=JSON.stringify({type:'STATUS',requestId,acknowledgement:{type:'ACK',command:'STATUS_QUERY',accepted:true,requestId,state},
      snapshot:{state,selectedExperienceId:mode,operationId,elapsedMs,durationMs:mode?25000:null,faultCode,hardwareOutputsEnabled:true}})
    if(s.length>max){max=s.length;maxFrame=s}
    assert.ok(s.length+1<=384)
  }
  const log=JSON.parse(readFileSync(new URL('history.json',output),'utf8')).rows
  const faults=log.filter((e:{event:string;timestamp:string})=>e.event==='firmware.protocol.invalid'&&['2026-11-05T07:00:58.481Z','2026-11-05T07:13:38.949Z'].includes(e.timestamp))
  assert.equal(faults.length,2);assert.ok(faults.every((e:{wire?:unknown})=>e.wire===undefined))
  writeFileSync(new URL('length-bounds-and-history.json',output),JSON.stringify({
    maximumRealStatusCharacters:max,maximumIncludingCR:max+1,maxFrame,faults,
    faultsHaveRawBytes:false,oldLogReasonLimit:160,
    caveat:'Bounds enumerate source-supported values, not proof that physical firmware executed this exact build.'},null,2))
})
