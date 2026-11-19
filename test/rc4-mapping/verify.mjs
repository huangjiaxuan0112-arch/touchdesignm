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
const out = resolve(process.env.REAL_RELEASE_RESULTS || join(root, 'firmware/releases/nature_touch_v3_rc4_d6_inflate_20261105/logs')); mkdirSync(out,{recursive:true});
const temp = mkdtempSync(join(tmpdir(), 'nature-touch-step3g-OFFLINE-'));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = path => sha(readFileSync(join(root, path)));
const candidate = join(root, 'firmware/releases/nature_touch_v3_rc4_d6_inflate_20261105');
const original = join(candidate, 'source/nature_touch_unified');
const baseline = join(root, 'firmware/releases/nature_touch_v3_rc3_prepared_25s_offline/source/nature_touch_unified');
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
const locked = compile(original, 'production-default');
const header = readFileSync(join(original, 'real-actuators.h'), 'utf8');
const gates = ["D6_MAPPING_VERIFIED","PHYSICAL_OUTPUTS_PERMITTED","D5_D6_OUTPUTS_PERMITTED","D7_ACTIVATION_REVIEWED","POWER_CUTOFF_VERIFIED","OVERPRESSURE_PROTECTION_VERIFIED","STARTUP_AND_TRANSITION_BEHAVIOR_VERIFIED","STOP_VALVE_VERIFIED","PUMP_OFF_SETTLE_VERIFIED","VALVE_SETTLE_VERIFIED"];
for(const gate of gates) assert.ok(header.includes('static constexpr bool '+gate+' = true;'));
assert.ok(header.includes('PUMP_OFF_SETTLE_MS = 500;'));assert.ok(header.includes('VALVE_SETTLE_MS = 300;'));
const realBuild = ['--build-property', 'compiler.cpp.extra_flags=-DNATURE_TOUCH_ACTUATOR_DRIVER=1'];
const active = compile(original, 'real-release', realBuild);

const preparedBuild = active;
mkdirSync(join(candidate,'real'),{recursive:true});
copyFileSync(join(temp,'real-release-build/nature_touch_unified.ino.hex'),join(candidate,'real/nature_touch_unified.ino.hex'));
copyFileSync(join(temp,'real-release-build/nature_touch_unified.ino.elf'),join(candidate,'real/nature_touch_unified.ino.elf'));
copyFileSync(join(temp,'production-default-build/nature_touch_unified.ino.hex'),join(out,'simulation.hex'));

const require = createRequire(join(root, 'test/avr8js-wind/package.json'));
const { CPU, avrInstruction, AVRIOPort, portBConfig, portCConfig, portDConfig,
  AVRTimer, timer0Config, timer1Config, timer2Config, AVRUSART, usart0Config } = require('avr8js');
const OFF = [1200, 1200, 1200], FILL = [1800, 1800, 1200], DRAIN = [1800, 1200, 1800];
class Nano {
  constructor(binary = active) {
    this.binary = binary; this.cpu = new CPU(new Uint16Array(binary.flash.slice().buffer), 0x800);
    this.frames = []; this.line = ''; this.rx = []; this.edges = { 5: [], 6: [], 7: [] }; this.modes = [];
    const cpu = this.cpu;
    new AVRIOPort(cpu, portBConfig); new AVRIOPort(cpu, portCConfig);
    const port = new AVRIOPort(cpu, portDConfig);
    new AVRTimer(cpu, timer0Config); new AVRTimer(cpu, timer1Config); new AVRTimer(cpu, timer2Config);
    this.uart = new AVRUSART(cpu, usart0Config, 16000000);
    this.repairs = preservePendingReceive(cpu, usart0Config);
    this.uart.onByteTransmit = byte => {
      if (byte === 10) { this.frames.push({ at: this.now, message: JSON.parse(this.line.trim()) }); this.line = ''; }
      else this.line += String.fromCharCode(byte);
    };
    port.addListener((value, old) => {
      for (const pin of [5, 6, 7]) if ((value ^ old) & (1 << pin))
        this.edges[pin].push({ us: cpu.cycles / 16, high: Boolean(value & (1 << pin)) });
    });
    const hook = cpu.writeHooks[portDConfig.DDR];
    cpu.writeHooks[portDConfig.DDR] = (value, old, mask) => {
      for (const pin of [5, 6, 7]) if ((value ^ old) & (1 << pin))
        this.modes.push({ us: cpu.cycles / 16, pin, output: Boolean(value & (1 << pin)) });
      return hook?.(value, old, mask);
    };
    this.advance(250);
    assert.ok(this.frames.some(f => f.message.name === 'READY'));
  }
  get now() { return this.cpu.cycles / 16000; }
  get elapsed() {
    const millis = this.binary.symbols.get('timer0_millis');
    const started = this.binary.symbols.get('operationStartedAt');
    assert.ok(millis >= 0 && started >= 0);
    return (this.cpu.dataView.getUint32(millis, true) - this.cpu.dataView.getUint32(started, true)) >>> 0;
  }
  commandState() {
    const address = this.binary.symbols.get('servos');
    assert.ok(address >= 0, 'Servo command symbol missing');
    return [0,1,2].map(i => this.cpu.dataView.getUint16(address+i*3+1,true)/2+2);
  }
  advance(ms) {
    const end = this.cpu.cycles + ms * 16000;
    while (this.cpu.cycles < end) {
      if (this.rx.length && !this.uart.rxBusy && this.cpu.cycles >= (this.nextRx || 0)) {
        if (this.uart.writeByte(this.rx[0])) { this.rx.shift(); this.nextRx = this.cpu.cycles + this.uart.cyclesPerChar + 32; }
      }
      avrInstruction(this.cpu); this.cpu.tick();
      if (this.binary.symbols.has('servos') && this.cpu.cycles >= (this.sampleNext || 0)) {
        this.sampleNext = this.cpu.cycles + 8000;
        const state = this.commandState();
        if (state.every(v=>v===1200||v===1800)) {
          assert.ok(!(state[1]===1800 && state[2]===1800), 'command overlap');
          this.commandTrace ||= [];
          if (!this.commandTrace.length || state.some((v,i)=>v!==this.commandTrace.at(-1).state[i]))
            this.commandTrace.push({at:this.now, state, elapsed:this.elapsed});
        }
      }
    }
  }
  request(type, requestId, payload = {}) {
    const start = this.frames.length;
    this.rx.push(...Buffer.from(JSON.stringify({ type, requestId, ...payload }) + '\n'));
    const wanted = () => this.frames.slice(start).find(f => f.message.requestId === requestId &&
      (type === 'STATUS_QUERY' ? f.message.type === 'STATUS' : ['ACK', 'NACK'].includes(f.message.type)));
    const deadline = this.now + 2000;
    while (!wanted() && this.now < deadline) this.advance(5);
    assert.ok(wanted(), 'Missing reply ' + type);
    return wanted().message;
  }
  begin(mode = 'WIND', id = 'run') {
    assert.equal(this.request('SELECT', 'select' + id, { experienceId: mode }).accepted, true);
    this.heartbeat(900); // Allow cold/post-STOP preparation before issuing START.
    assert.equal(this.request('START', 'start' + id, { operationId: id }).accepted, true);
  }
  start(mode = 'WIND', id = 'run') {
    this.begin(mode, id); this.advance(900); this.assertState(FILL, this.now - 80);
  }
  pulses(pin) {
    const edges = this.edges[pin], result = [];
    for (let i = 1; i < edges.length; i++) if (edges[i - 1].high && !edges[i].high)
      result.push({ pin, riseUs: edges[i - 1].us, fallUs: edges[i].us, widthUs: edges[i].us - edges[i - 1].us });
    return result;
  }
  assertState(values, afterMs = 0) {
    for (let index = 0; index < 3; index++) {
      const pulses = this.pulses(index + 5).filter(p => p.riseUs >= afterMs * 1000);
      assert.ok(pulses.length >= 2, 'Missing D' + (index + 5) + ' pulses');
      assert.ok(pulses.every(p => Math.abs(p.widthUs - values[index]) <= 12), JSON.stringify(pulses.slice(-8)));
      // Preserve startup frames, but qualify steady repetition after 100ms;
      // existing Servo multi-channel startup traces have irregular first periods.
      for (let i = 1; i < pulses.length; i++) if (pulses[i - 1].riseUs >= 100000)
        assert.ok(Math.abs(pulses[i].riseUs - pulses[i - 1].riseUs - 20000) < 30,
          `D${index + 5} period=${pulses[i].riseUs - pulses[i - 1].riseUs}us`);
    }
  }
  offSustained(ms = 300) {
    this.advance(60); const from = this.now; this.advance(ms); this.assertState(OFF, from);
    assert.equal(this.cpu.data[portDConfig.DDR] & 224, 224);
    assert.equal(this.modes.length, 3); assert.ok(this.modes.every(m => m.output));
  }
  heartbeat(ms) {
    const end = this.now + ms; let id = 0;
    while (this.now < end) { this.advance(Math.min(700, end - this.now)); this.request('STATUS_QUERY', 'hb' + id++); }
  }
  injectFault() { const address = this.binary.symbols.get('RealActuators::faultLatched'); assert.ok(address >= 0); this.cpu.data[address] = 1; }
  evidence() {
    const pulses = [5, 6, 7].flatMap(pin => this.pulses(pin));
    const pumpOn = { 6: false, 7: false };
    for (const p of pulses.filter(p => p.pin !== 5).sort((a, b) => a.fallUs - b.fallUs)) {
      const on = 1800, off = 1200;
      assert.ok(Math.min(Math.abs(p.widthUs - on), Math.abs(p.widthUs - off)) <= 12, 'Unexpected pulse width');
      pumpOn[p.pin] = Math.abs(p.widthUs - on) <= 12;
      assert.ok(!(pumpOn[6] && pumpOn[7]), 'Both pumps have decoded ON commands');
    }
    return { frames: this.frames, pulses, gpioModes: this.modes, decodedPumpOverlap: false, usartRepairs: this.repairs };
  }
}


const checks=[],evidence=[],summaries=[];
function test(name,fn,binary=active){
 const n=new Nano(binary);
 try{const extra=fn(n);evidence.push({name,commands:n.commandTrace,...n.evidence(),extra});checks.push({name,result:'PASS'});console.log('PASS '+name);}
 catch(e){writeFileSync(join(out,'failure.json'),JSON.stringify({name,error:e.stack,commands:n.commandTrace,frames:n.frames},null,2));throw e;}
}
function to(n,elapsed){while(n.elapsed<elapsed){const remaining=elapsed-n.elapsed;if(remaining>800){n.advance(500);n.request('STATUS_QUERY','h'+Math.floor(n.now))}else n.advance(remaining)}}
for(const mode of ['WIND','WAVE','BUBBLE'])test(mode+' actual D6-INFLATE / D7-DEFLATE 25s + cooldown + restart',n=>{
 const identity=n.request('IDENTIFY','identity',{protocol:2});
 assert.equal(identity.firmwareVersion,'3.0.0-rc4-d6inflate');
 n.heartbeat(1000);assert.deepEqual(n.commandState(),[1800,1200,1200]);
 n.begin(mode);to(n,25600);
 const first=n.commandTrace.find(t=>t.state[1]===1800);
 assert.ok(first&&first.elapsed<=1);
 const origin=first.at-first.elapsed;
 const off=n.commandTrace.find(t=>t.at>first.at&&t.state[1]===1200);
 assert.ok(Math.abs(off.elapsed-5000)<=2);
 assert.ok(n.commandTrace.filter(t=>t.at>=first.at&&t.at<off.at).every(t=>t.state[1]===1800&&t.state[2]===1200));
 const final=n.commandTrace.find(t=>t.elapsed>=20000&&t.elapsed<25000&&t.state[2]===1800);
 const expectedStart=mode==='WAVE'?20300:20800;
 assert.ok(final&&Math.abs(final.elapsed-expectedStart)<=2);
 const end=n.commandTrace.find(t=>t.elapsed>=24999&&t.state[1]===1200&&t.state[2]===1200);
 assert.ok(end&&Math.abs(end.elapsed-25000)<=2);
 let fill=0,drain=0,lastOn=null,offAt=null;
 for(let i=0;i<n.commandTrace.length;i++){
  const t=n.commandTrace[i],next=n.commandTrace[i+1]?.at??n.now;
  const duration=Math.max(0,Math.min(next,origin+25000)-Math.max(t.at,origin));
  if(t.state[1]===1800)fill+=duration;
  if(t.state[2]===1800)drain+=duration;
  const pin=t.state[1]===1800?6:t.state[2]===1800?7:null;
  if(pin===null&&lastOn!==null)offAt??=t.at;
  if(pin!==null&&pin!==lastOn){if(lastOn!==null)assert.ok(offAt!==null&&t.at-offAt>=798);lastOn=pin;offAt=null}
 }
 const expected={WIND:[7850,8350],WAVE:[10100,8500],BUBBLE:[8452,6148]}[mode];
 assert.ok(Math.abs(fill-expected[0])<15);assert.ok(Math.abs(drain-expected[1])<15);
 const pulses=[6,7].flatMap(pin=>n.pulses(pin)).sort((a,b)=>a.fallUs-b.fallUs);
 let previousPin=null,decodedOff=null;const decodedHandover=[];
 for(const p of pulses){
  const on=Math.abs(p.widthUs-1800)<=12;
  if(!on&&p.pin===previousPin)decodedOff??=p.fallUs;
  if(on&&previousPin!==p.pin){if(previousPin!==null){assert.ok(decodedOff!==null&&p.fallUs-decodedOff>750000);decodedHandover.push({from:previousPin,to:p.pin,gapUs:p.fallUs-decodedOff})}previousPin=p.pin;decodedOff=null}
 }
 assert.ok(n.pulses(6).filter(p=>p.riseUs>=first.at*1000&&p.riseUs<off.at*1000-20000).every(p=>Math.abs(p.widthUs-1800)<12));
 assert.ok(n.pulses(7).filter(p=>p.riseUs>=final.at*1000+20000&&p.riseUs<end.at*1000-20000).every(p=>Math.abs(p.widthUs-1800)<12));
 const events=n.frames.filter(f=>f.message.name==='ACTUATOR_EVENT').map(f=>f.message);
 for(const e of events){assert.equal(e.D5,180);assert.equal(e.D6,e.action==='INFLATE'?180:0);assert.equal(e.D7,e.action==='INFLATE'?0:180)}
 assert.equal(events.length,{WIND:12,WAVE:10,BUBBLE:14}[mode]);
 if(mode==='WAVE')assert.ok(!n.commandTrace.some(t=>t.elapsed>=19500&&t.elapsed<20000&&t.state[1]===1800));
 assert.equal(n.frames.filter(f=>f.message.name==='COMPLETED').length,1);
 n.request('SELECT','earlyselect',{experienceId:mode});
 assert.equal(n.request('START','tooearly',{operationId:'early'}).accepted,false);
 to(n,28020);
 assert.ok(n.commandTrace.filter(t=>t.at>=end.at).every(t=>t.state[1]===1200&&t.state[2]===1200));
 assert.equal(n.request('START','second',{operationId:'second'}).accepted,true);
 n.advance(30);assert.deepEqual(n.commandState(),FILL);
 n.request('STOP','stopsecond',{operationId:'second'});n.offSustained(1000);
 const summary={mode,firstOnPin:6,firstOnElapsedMs:first.elapsed,initialD6NominalMs:off.elapsed-first.elapsed,
  finalOnPin:7,finalD7StartMs:final.elapsed,finalD7NominalMs:end.elapsed-final.elapsed,
  d6OnMs:fill,d7OnMs:drain,completedMs:end.elapsed,cooldownMs:3000,decodedHandover};
 summaries.push(summary);return summary;
});
test('Cold START is rejected before preparation; first accepted output is D6 before ACK',n=>{
 assert.equal(n.request('SELECT','coldselect',{experienceId:'WIND'}).accepted,true);
 assert.equal(n.request('START','cold',{operationId:'cold'}).accepted,false);
 assert.ok(n.commandTrace.every(t=>t.state[1]===1200&&t.state[2]===1200));
 n.heartbeat(1000);assert.equal(n.request('START','warm',{operationId:'warm'}).accepted,true);
 const first=n.commandTrace.find(t=>t.state[1]===1800),ack=n.frames.find(f=>f.message.requestId==='warm');
 assert.ok(first&&first.at<ack.at);
 n.request('STOP','stop',{operationId:'warm'});n.offSustained();
});
for(const kind of ['STOP','FAULT','HOST_TIMEOUT'])test(kind+' on active D6 and pending reversal cancels outputs',n=>{
 n.begin();n.advance(1000);
 if(kind==='STOP')n.request('STOP','stop',{operationId:'run'});
 if(kind==='FAULT')n.injectFault();
 if(kind==='HOST_TIMEOUT')n.advance(5100);
 n.advance(2);n.offSustained(1000);
 if(kind!=='STOP')assert.equal(n.request('STATUS_QUERY','status').snapshot.faultCode,kind==='FAULT'?'ACTUATOR_FAULT':'HOST_TIMEOUT');
 if(kind!=='STOP'){assert.equal(n.request('RECOVER','recover').accepted,true);n.offSustained(500)}
 n.begin('WAVE','next');
 while(n.elapsed<4400){n.advance(400);n.request('STATUS_QUERY','hb'+Math.floor(n.now))}
 n.advance(Math.max(0,5520-n.elapsed));
 if(kind==='STOP')n.request('STOP','cancel',{operationId:'next'});
 if(kind==='FAULT')n.injectFault();
 if(kind==='HOST_TIMEOUT'){
  const now=n.cpu.dataView.getUint32(active.symbols.get('timer0_millis'),true);
  n.cpu.dataView.setUint32(active.symbols.get('lastHostContactAt'),(now-5000)>>>0,true);
 }
 n.advance(2);n.offSustained(1200);
 assert.ok(!n.commandTrace.some(t=>t.state[2]===1800));
});
test('Idle lease loss and reset preserve pump OFF and original valve STOP',n=>{
 n.heartbeat(1000);assert.deepEqual(n.commandState(),[1800,1200,1200]);
 n.advance(5300);n.offSustained();
 const reset=new Nano();assert.ok(reset.commandTrace.every(t=>t.state[1]===1200&&t.state[2]===1200));
});
test('Simulation default emits no physical GPIO',n=>{
 n.begin();n.advance(50);n.request('STOP','stop',{operationId:'run'});n.advance(50);assert.deepEqual(n.modes,[]);
},locked);
for(const [p,digest]of Object.entries(baselineHashes))assert.equal(sha(readFileSync(join(baseline,p))),digest);
assert.equal(readFileSync(join(original,'experience-timelines.h'),'utf8'),readFileSync(join(baseline,'experience-timelines.h'),'utf8').replace(/\r/g,''));
assert.equal(readFileSync(join(original,'experience-scheduler.h'),'utf8'),readFileSync(join(baseline,'experience-scheduler.h'),'utf8').replace(/\r/g,''));
const result={result:'PASS',checks,summaries,evidence,baselineHashes,realHexSha256:active.hexSha256,realCompile:active.log,physicalCOM:false,uploaded:false,
 scope:'Actual compiled AVR GPIO pulses and Servo SRAM, RC4 D6 inflate / D7 deflate; no physical hardware test'};
writeFileSync(join(out,'results.json'),JSON.stringify(result,null,2));
writeFileSync(join(out,'summary.json'),JSON.stringify({result:'PASS',checks,summaries,realHexSha256:active.hexSha256},null,2));
console.log(JSON.stringify({result:'PASS',checks:checks.length,summaries,out}));
