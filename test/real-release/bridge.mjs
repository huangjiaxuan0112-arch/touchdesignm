import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';import {createInterface} from 'node:readline';import {join} from 'node:path';import {preservePendingReceive} from '../unified-controller/avr-usart-compat.mjs';
const root=process.cwd();const record={realHexSha256:JSON.parse(fs.readFileSync(join(root,'firmware/releases/latest-real.json'),'utf8')).realHexSha256};
const latest=JSON.parse(fs.readFileSync(join(root,'firmware/releases/latest-real.json'),'utf8'));
const releaseRoot=join(root,'firmware/releases',latest.release);
const hex=fs.readFileSync(join(releaseRoot,'real/nature_touch_unified.ino.hex'),'utf8');
const flash=new Uint8Array(32768).fill(255);let base=0;for(const line of hex.trim().split(/\r?\n/)){const b=[...Buffer.from(line.slice(1),'hex')];assert.equal(b.reduce((s,x)=>s+x,0)&255,0);if(b[3]===0)flash.set(b.slice(4,4+b[0]),base+b[1]*256+b[2]);else if(b[3]===4)base=(b[4]*256+b[5])*65536;}
const text=fs.readFileSync(join(releaseRoot,'logs/real-release-symbols.txt'),'utf8');const symbols=new Map([...text.matchAll(/^([\da-f]+)\s+\w\s+(.+)$/gmi)].map(m=>[m[2].trim(),parseInt(m[1],16)-0x800000]));const active={flash,symbols};
const require=createRequire(join(root,'test/avr8js-wind/package.json'));const {CPU,avrInstruction,AVRIOPort,portBConfig,portCConfig,portDConfig,AVRTimer,timer0Config,timer1Config,timer2Config,AVRUSART,usart0Config}=require('avr8js');const OFF=[1200,1200,1200];
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
  advance(ms) {
    const end = this.cpu.cycles + ms * 16000;
    while (this.cpu.cycles < end) {
      if (this.rx.length && !this.uart.rxBusy && this.cpu.cycles >= (this.nextRx || 0)) {
        if (this.uart.writeByte(this.rx[0])) { this.rx.shift(); this.nextRx = this.cpu.cycles + this.uart.cyclesPerChar + 32; }
      }
      avrInstruction(this.cpu); this.cpu.tick();
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

let nano=new Nano(),delivered=0,paused=true;
const send=x=>process.stdout.write(JSON.stringify(x)+'\n');const deliver=()=>{while(delivered<nano.frames.length)send({kind:'frame',...nano.frames[delivered++]})};
send({kind:'ready',hexSha256:record.realHexSha256});
const timer=setInterval(()=>{if(paused)return;nano.advance(10);deliver()},10);
const input=createInterface({input:process.stdin});input.on('line',line=>{const message=JSON.parse(line);if(message.reset){nano=new Nano();delivered=0;paused=false;deliver()}if(message.line)nano.rx.push(...Buffer.from(message.line+'\n'));if(message.pause)paused=true;if(message.fault)nano.injectFault()});
input.on('close',()=>{clearInterval(timer);fs.writeFileSync(join(root,'.validation/exhibition-handover/bridge-results.json'),JSON.stringify({realHexSha256:record.realHexSha256,evidence:nano.evidence(),physicalCOM:false},null,2));process.exit(0)});
