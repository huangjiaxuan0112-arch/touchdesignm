// STEP 3G OFFLINE ONLY. No serialport import, device discovery, or upload command.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { preservePendingReceive } from '../unified-controller/avr-usart-compat.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(process.env.REAL_RELEASE_RESULTS || join(root, 'firmware/releases/nature_touch_rc3_comm_diagnostics_20261105/evidence/avr-tx')); mkdirSync(out,{recursive:true});
const temp = mkdtempSync(join(tmpdir(), 'nature-touch-step3g-OFFLINE-'));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = path => sha(readFileSync(join(root, path)));
const candidate = join(root, 'firmware/releases/nature_touch_v3_rc3_prepared_25s_offline');
const original = join(candidate, 'source/nature_touch_unified');
const baseline = join(root, 'firmware/releases/nature_touch_v3_real_rc2_d5-open-both_20261105T0535Z/source/nature_touch_unified');
const baselineHashes = Object.fromEntries(readdirSync(baseline).map(p=>[p,sha(readFileSync(join(baseline,p)))]));
const cli = join(homedir(), 'AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe');
const libraries = join(homedir(), 'AppData/Local/Arduino15/libraries');
const config = join(temp, 'arduino-cli.yaml');
writeFileSync(config, `directories:\n  data: ${JSON.stringify(join(homedir(), 'AppData/Local/Arduino15'))}\n  user: ${JSON.stringify(temp)}\n  downloads: ${JSON.stringify(join(temp, 'downloads'))}\nbuild_cache:\n  path: ${JSON.stringify(join(temp, 'cache'))}\n`);
const gcc = join(homedir(), 'AppData/Local/Arduino15/packages/arduino/tools/avr-gcc');
const nm = join(gcc, readdirSync(gcc).sort().at(-1), 'bin/avr-nm.exe');
function compile(sketch, tag, extra = []) {
  const build = join(temp, tag + '-build');
  const args = ['--config-file', config, 'compile', '--fqbn', 'arduino:avr:nano:cpu=atmega328',
    '--libraries', libraries, '--build-path', build, ...extra, sketch];
  const log = execFileSync(cli, args, { encoding: 'utf8', timeout: 180000 });
  writeFileSync(join(out, tag + '-compile.log'), log);
  const name = sketch.split(/[\\/]/).at(-1);
  const hex = readFileSync(join(build, name + '.ino.hex'), 'utf8');
  const symbolsText = execFileSync(nm, ['--demangle', '--numeric-sort', join(build, name + '.ino.elf')], { encoding: 'utf8' });
  writeFileSync(join(out, tag + '-symbols.txt'), symbolsText);
  const symbols = new Map([...symbolsText.matchAll(/^([\da-f]+)\s+\w\s+(.+)$/gmi)].map(m => [m[2].trim(), parseInt(m[1], 16) - 0x800000]));
  const flash = new Uint8Array(32768).fill(255); let base = 0;
  for (const line of hex.trim().split(/\r?\n/)) {
    const b = [...Buffer.from(line.slice(1), 'hex')];
    assert.equal(b.reduce((a, n) => a + n, 0) & 255, 0);
    if (b[3] === 0) flash.set(b.slice(4, 4 + b[0]), base + b[1] * 256 + b[2]);
    else if (b[3] === 4) base = (b[4] * 256 + b[5]) * 65536;
  }
  return { log, hex, hexSha256: sha(hex), symbols, flash };
}

import { FirmwareJsonlDecoder, parseFirmwareJsonObject } from '../../desktop/electron/serial/firmware-protocol.ts';
const realBuild=['--build-property','compiler.cpp.extra_flags=-DNATURE_TOUCH_ACTUATOR_DRIVER=1'];
const variants=[['RC2',compile(baseline,'rc2',realBuild)],['RC3',compile(original,'rc3',realBuild)]];
const require=createRequire(join(root,'test/avr8js-wind/package.json'));
const {CPU,avrInstruction,AVRIOPort,portBConfig,portCConfig,portDConfig,AVRTimer,timer0Config,timer1Config,timer2Config,AVRUSART,usart0Config}=require('avr8js');
class Nano {
 constructor(binary) {
  this.binary=binary;this.cpu=new CPU(new Uint16Array(binary.flash.slice().buffer),0x800);
  for(const config of [portBConfig,portCConfig,portDConfig])new AVRIOPort(this.cpu,config);
  for(const config of [timer0Config,timer1Config,timer2Config])new AVRTimer(this.cpu,config);
  this.uart=new AVRUSART(this.cpu,usart0Config,16000000);
  this.repairs=preservePendingReceive(this.cpu,usart0Config);
  this.frames=[];this.pending=[];this.tx=[];this.line=[];this.txCommands=[];this.minSP=0x8ff;
  this.decoder=new FirmwareJsonlDecoder(384);this.mainFrames=[];this.decodeErrors=[];
  this.uart.onByteTransmit=byte=>{
   this.tx.push({cycle:this.cpu.cycles,byte});this.line.push(byte);
   for(const frame of this.decoder.push(String.fromCharCode(byte))){
    this.mainFrames.push(frame);
    if(frame.type!=='line')this.decodeErrors.push(frame);
    else try{parseFirmwareJsonObject(frame.line)}catch(error){this.decodeErrors.push({frame,error:error.message})}
   }
   if(byte===10) {
    const bytes=Buffer.from(this.line),raw=bytes.toString('latin1');
    let message,error;try{message=JSON.parse(raw)}catch(e){error=e.message}
    this.frames.push({at:this.now,raw,length:bytes.length-1,message,error});this.line=[];
   }
  };
  this.advance(250);
 }
 get now(){return this.cpu.cycles/16000}
 advance(ms){
  const end=this.cpu.cycles+ms*16000;let nextSample=this.cpu.cycles;
  while(this.cpu.cycles<end){
   if(this.pending.length&&!this.uart.rxBusy&&this.cpu.cycles>=(this.nextRx||0)){
    if(this.uart.writeByte(this.pending[0])){this.pending.shift();this.nextRx=this.cpu.cycles+this.uart.cyclesPerChar+32}
   }
   avrInstruction(this.cpu);this.cpu.tick();
   if(this.cpu.cycles>=nextSample){
    nextSample=this.cpu.cycles+64;
    const sp=this.cpu.dataView.getUint16(0x5d,true);if(sp>=0x100)this.minSP=Math.min(this.minSP,sp);
   }
  }
 }
 request(type,requestId,payload={}){
  const raw=JSON.stringify({type,requestId,...payload})+'\n',start=this.frames.length;
  this.txCommands.push({at:this.now,raw});this.pending.push(...Buffer.from(raw));
  const wanted=()=>this.frames.slice(start).find(f=>f.message?.requestId===requestId&&
   (type==='STATUS_QUERY'?f.message.type==='STATUS':['ACK','NACK'].includes(f.message.type)));
  const deadline=this.now+2000;
  while(!wanted()&&this.now<deadline)this.advance(2);
  assert.ok(wanted(),JSON.stringify({missing:type,requestId,tail:this.frames.slice(-4)}));
  assert.equal(this.decodeErrors.length,0,'Firmware TX rejected by actual Main decoder');
  return wanted().message;
 }
}
const summaries=[];
for(const [name,binary] of variants){
 const n=new Nano(binary);
 n.request('IDENTIFY','r1',{protocol:2});n.request('STATUS_QUERY','r2');
 n.request('SELECT','16007753e4d8c8c0',{experienceId:'WIND'});n.advance(900);
 n.request('START','4b3efc263b38427f',{operationId:'623a6219872c4ec5'});
 n.request('STATUS_QUERY','c6e6d98a05d64f73');
 const began=n.now;
 for(let i=3;i<=7;i++){n.advance(1000);n.request('STATUS_QUERY','r'+i)}
 // Continuous bounded-duration output, including action deadlines, completion and maximum IDs.
 while(n.now-began<60000){
  n.request('STATUS_QUERY','abcdefghijklmnop');
  if(n.now-began>29000&&!n.identifiedAfterComplete){
   n.request('IDENTIFY','ABCDEFGHIJKLMNOP',{protocol:2});n.identifiedAfterComplete=true;
  }
 }
 n.advance(500);
 assert.equal(n.frames.filter(f=>f.error).length,0);
 assert.equal(n.decodeErrors.length,0);
 const bssEnd=binary.symbols.get('__bss_end');
 const stackGap=n.minSP-bssEnd;
 assert.ok(stackGap>0,'Observed stack/global collision');
 const status=n.frames.filter(f=>f.message?.type==='STATUS');
 const summary={variant:name,result:'PASS',durationMs:n.now,statusFrames:status.length,totalFrames:n.frames.length,
  maximumWireFrameBytesExcludingLF:Math.max(...n.frames.map(f=>f.length)),
  maxStatusCharacters:Math.max(...status.map(f=>f.raw.trimEnd().length)),
  r7:status.find(f=>f.message.requestId==='r7'),sampledMinSP:n.minSP,bssEnd,sampledStackGapBytes:stackGap,
  sampling:'SP sampled every <=64 CPU cycles; observed minimum is not a universal stack bound',
  compiledHexSha256:binary.hexSha256,virtualUsartRepairs:n.repairs.length};
 summaries.push(summary);
 writeFileSync(join(out,name+'-tx.json'),JSON.stringify({summary,frames:n.frames,commands:n.txCommands,bytes:n.tx,
  decodedByActualMain:n.mainFrames,decodeErrors:n.decodeErrors,USARTModel:'AVR8js with documented RXC compatibility adapter'},null,2));
 console.log(JSON.stringify(summary));
}
writeFileSync(join(out,'summary.json'),JSON.stringify({result:'PASS',summaries,physicalCOM:false},null,2));
