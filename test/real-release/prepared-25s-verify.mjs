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
const out = resolve(process.env.REAL_RELEASE_RESULTS || join(root, 'firmware/releases/nature_touch_v3_rc3_prepared_25s_offline/logs')); mkdirSync(out,{recursive:true});
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
const locked = compile(original, 'production-default');
const header = readFileSync(join(original, 'real-actuators.h'), 'utf8');
const gates = ["D6_MAPPING_VERIFIED","PHYSICAL_OUTPUTS_PERMITTED","D5_D6_OUTPUTS_PERMITTED","D7_ACTIVATION_REVIEWED","POWER_CUTOFF_VERIFIED","OVERPRESSURE_PROTECTION_VERIFIED","STARTUP_AND_TRANSITION_BEHAVIOR_VERIFIED","STOP_VALVE_VERIFIED","PUMP_OFF_SETTLE_VERIFIED","VALVE_SETTLE_VERIFIED"];
for(const gate of gates) assert.ok(header.includes('static constexpr bool '+gate+' = true;'));
assert.ok(header.includes('PUMP_OFF_SETTLE_MS = 500;'));assert.ok(header.includes('VALVE_SETTLE_MS = 300;'));
const realBuild = ['--build-property', 'compiler.cpp.extra_flags=-DNATURE_TOUCH_ACTUATOR_DRIVER=1'];
const active = compile(original, 'real-release', realBuild);
const baselineBuild = compile(baseline, 'rc2-baseline', realBuild);
const preparedBuild = active;
mkdirSync(join(candidate,'real'),{recursive:true});
copyFileSync(join(temp,'real-release-build/nature_touch_unified.ino.hex'),join(candidate,'real/nature_touch_unified.ino.hex'));
copyFileSync(join(temp,'real-release-build/nature_touch_unified.ino.elf'),join(candidate,'real/nature_touch_unified.ino.elf'));
copyFileSync(join(temp,'production-default-build/nature_touch_unified.ino.hex'),join(out,'simulation.hex'));

const require = createRequire(join(root, 'test/avr8js-wind/package.json'));
const { CPU, avrInstruction, AVRIOPort, portBConfig, portCConfig, portDConfig,
  AVRTimer, timer0Config, timer1Config, timer2Config, AVRUSART, usart0Config } = require('avr8js');
const OFF = [1200, 1200, 1200], FILL = [1800, 1200, 1800], DRAIN = [1800, 1800, 1200];
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

const checks=[], evidence=[], summaries=[];
function check(name,fn,binary=active) {
  const n=new Nano(binary);
  try { const extra=fn(n); evidence.push({name,commands:n.commandTrace,...n.evidence(),extra}); checks.push({name,result:'PASS'}); console.log('PASS '+name); }
  catch(e) {writeFileSync(join(out,'failure.json'),JSON.stringify({name,error:e.stack,commands:n.commandTrace,frames:n.frames},null,2)); throw e;}
}
function advanceTo(n,elapsed) {
  while(n.elapsed<elapsed) {
    const left=elapsed-n.elapsed;
    if(left>800) {n.advance(500);n.request('STATUS_QUERY','h'+Math.floor(n.now));}
    else n.advance(left);
  }
}
function totals(n) {
  const start=n.commandTrace.find(t=>t.state[2]===1800);
  assert.ok(start);
  // millis operation origin read independently; command trace recorded at 0.5ms resolution.
  const origin=n.now-n.elapsed, end=origin+25000;
  const trace=n.commandTrace;
  let d6=0,d7=0,initial=0,final=0;
  for(let i=0;i<trace.length;i++) {
    const lo=Math.max(trace[i].at,origin), hi=Math.min(trace[i+1]?.at??n.now,end);
    if(hi<=lo)continue;
    if(trace[i].state[1]===1800) {d6+=hi-lo; final+=Math.max(0,hi-Math.max(lo,origin+20000));}
    if(trace[i].state[2]===1800) {d7+=hi-lo; initial+=Math.max(0,Math.min(hi,origin+5000)-lo);}
  }
  return {d6Ms:d6,d7Ms:d7,initialD7Ms:initial,finalD6Ms:final,startCommandDelayMs:start.at-origin};
}
for(const [profile,binary] of [['RC2',baselineBuild],['RC3-ready',active]]) {
 for(const mode of ['WIND','WAVE','BUBBLE']) check(profile+' '+mode+' full 25s/3s cycle',n=>{
    n.heartbeat(1200);
    n.begin(mode);
    advanceTo(n,25600); // JSON completion telemetry can trail the logical OFF deadline.
    const row={profile,mode,...totals(n)};
    summaries.push(row);
    const expected={WIND:[8350,7050],WAVE:[8000,9300],BUBBLE:[6148,7652]}[mode];
    // D6 computed independently below from timeline; tolerance covers loop and 0.5ms sampling.
    const header=readFileSync(join(baseline,'experience-timelines.h'),'utf8');
    const actions=[...header.split('static const ScheduledAction '+mode+'_ACTIONS')[1].split('};')[0].matchAll(/\{\s*(\d+),\s*([01])\s*\}/g)].map(m=>[+m[1],+m[2]]);
    const expected6=actions.filter(x=>!x[1]).reduce((a,x)=>a+Math.max(0,x[0]-800),0);
    const improved=profile!=='RC2';
    assert.ok(Math.abs(row.d6Ms-(expected6+(improved&&mode==='WAVE'?500:0)))<25,JSON.stringify(row));
    const prepared=profile==='RC3-ready';
    assert.ok(Math.abs(row.d7Ms-(expected[1]+(prepared?800:improved?500:0)))<25,JSON.stringify(row));
    assert.ok(Math.abs(row.initialD7Ms-(prepared?5000:improved?4700:4200))<15,JSON.stringify(row));
    assert.ok(Math.abs(row.finalD6Ms-(improved&&mode==='WAVE'?4700:4200))<15,JSON.stringify(row));
    assert.equal(n.frames.filter(f=>f.message.name==='COMPLETED').length,1);
    assert.equal(n.request('STATUS_QUERY','finished').snapshot.state,'COMPLETED');
    if(profile!=='RC2') {
      n.request('SELECT','earlyselect',{experienceId:mode});
      assert.equal(n.request('START','earlystart',{operationId:'early'}).accepted,false);
      advanceTo(n,28020);
      assert.ok(n.commandState()[1]===1200&&n.commandState()[2]===1200);
      const before=n.commandTrace.length;
      assert.equal(n.request('START','second',{operationId:'second'}).accepted,true);
      n.advance(30);
      if(prepared) assert.equal(n.commandState()[2],1800);
      n.request('STOP','stopsecond',{operationId:'second'});
      n.advance(1000); assert.deepEqual(n.commandState(),OFF);
    }
    return row;
 },binary);
}
for(const binary of [active]) {
 check('STOP / FAULT / timeout and recovery '+binary.hexSha256.slice(0,8),n=>{
    n.heartbeat(1000);n.begin();n.advance(1000);
    n.request('STOP','stop',{operationId:'run'}); n.offSustained(1000);
    n.begin('WAVE','next');n.advance(1000);n.injectFault();n.advance(5);n.offSustained(1000);
    assert.equal(n.request('STATUS_QUERY','fault').snapshot.faultCode,'ACTUATOR_FAULT');
    n.request('RECOVER','recover');n.offSustained(1000);
    n.begin('BUBBLE','timeout'); n.advance(5100);n.offSustained(1000);
    assert.equal(n.request('STATUS_QUERY','timeoutstatus').snapshot.faultCode,'HOST_TIMEOUT');
    return {faultAndTimeoutStop:true};
 },binary);
 check('cancel pending reversal '+binary.hexSha256.slice(0,8),n=>{
    n.heartbeat(1000); n.begin();
    advanceTo(n,5100);n.request('STOP','cancel',{operationId:'run'});n.offSustained(1500);
    assert.ok(n.commandTrace.filter(t=>t.elapsed>=5100).every(t=>t.state[1]===1200&&t.state[2]===1200));
 },binary);
}
check('Prepared idle lease expires to original valve STOP, reset is pump OFF',n=>{
  n.heartbeat(1000);assert.deepEqual(n.commandState(),[1800,1200,1200]);
  n.advance(5300);n.offSustained();
},preparedBuild);
check('Simulation default emits no GPIO pulses',n=>{
 n.begin();n.advance(100);n.request('STOP','stop',{operationId:'run'});n.advance(50);
 assert.deepEqual(n.modes,[]);
},locked);
for(const [p,digest] of Object.entries(baselineHashes))assert.equal(sha(readFileSync(join(baseline,p))),digest);
const result={result:'PASS',checks,summaries,evidence,baselineHashes,
 realHexSha256:active.hexSha256,realCompile:active.log,fixtureCompile:preparedBuild.log,
 physicalCOM:false,uploaded:false,readyOpenPhysicallyVerified:'USER_CONFIRMED_PASS',
 scope:'Actual compiled AVR HEX, virtual GPIO and Servo command SRAM. 0.5ms command sampling; not physical pump output. No serial device access.'};
writeFileSync(join(out,'results.json'),JSON.stringify(result,null,2));
writeFileSync(join(out,'summary.json'),JSON.stringify({checks,summaries,realHexSha256:active.hexSha256},null,2));
console.log(JSON.stringify({checks:checks.length,summaries,out}));
