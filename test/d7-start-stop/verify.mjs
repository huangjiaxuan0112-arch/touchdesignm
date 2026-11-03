// Compiles and runs the actual Nano HEX. No serialport import, COM or upload.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preservePendingReceive } from '../unified-controller/avr-usart-compat.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = mkdtempSync(join(root, 'docs/evidence/d7-start-stop-'));
const require = createRequire(join(root, 'test/avr8js-wind/package.json'));
const { CPU, avrInstruction, AVRIOPort, portBConfig, portCConfig, portDConfig,
  AVRTimer, timer0Config, timer1Config, timer2Config, AVRUSART, usart0Config } = require('avr8js');
const { D7Control } = require('../../firmware/diagnostic/d7_start_stop/windows-control.cjs');
const sha = path => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
const protectedPaths = [
  'firmware/unified/nature_touch_unified/nature_touch_unified.ino',
  'firmware/unified/nature_touch_unified/actuator-driver.h',
  'firmware/unified/nature_touch_unified/real-actuators.h',
  'firmware/unified/nature_touch_unified/experience-timelines.h',
  'firmware/unified/nature_touch_unified/simulated-actuators.h',
  'firmware/diagnostic/rc_switch_off_signal/rc_switch_off_signal.ino',
  '卒研music/wind/sketch_oct21a/sketch_oct21a.ino',
  '卒研music/ocean waves/sketch_oct21b/sketch_oct21b.ino',
  '卒研music/bubbles/sketch_sep30a/sketch_oct21a/sketch_oct21a.ino',
];
const before = Object.fromEntries(protectedPaths.map(p => [p, sha(p)]));
writeFileSync(join(out, 'results.json'), JSON.stringify({ result: 'INCOMPLETE', before }));
const cli = join(homedir(), 'AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe');
const sketch = join(root, 'firmware/diagnostic/d7_start_stop');
const build = mkdtempSync(join(tmpdir(), 'nature-touch-d7-'));
// Explicit existing data directory avoids Windows redirected profile discovery.
const config = join(build, 'arduino-cli.yaml');
writeFileSync(config, `directories:\n  data: ${JSON.stringify(join(homedir(), 'AppData/Local/Arduino15'))}\n  user: ${JSON.stringify(build)}\n  downloads: ${JSON.stringify(join(build, 'downloads'))}\nbuild_cache:\n  path: ${JSON.stringify(join(build, 'cache'))}\n`);
const compile = execFileSync(cli, ['--config-file', config, 'compile', '--fqbn', 'arduino:avr:nano:cpu=atmega328',
  '--libraries', join(homedir(), 'AppData/Local/Arduino15/libraries'), '--build-path', build, sketch],
  { encoding: 'utf8', timeout: 180000 });
writeFileSync(join(out, 'compile.log'), compile);
const hex = readFileSync(join(build, 'd7_start_stop.ino.hex'), 'utf8');
writeFileSync(join(out, 'diagnostic.hex.txt'), hex);
const flash = new Uint8Array(32768).fill(255);
let base = 0;
for (const line of hex.trim().split(/\r?\n/)) {
  const b = [...Buffer.from(line.slice(1), 'hex')];
  assert.equal(b.reduce((a, v) => a + v, 0) & 255, 0);
  if (b[3] === 0) flash.set(b.slice(4, 4 + b[0]), base + b[1] * 256 + b[2]);
  else if (b[3] === 4) base = (b[4] * 256 + b[5]) * 65536;
}
const ino = readFileSync(join(sketch, 'd7_start_stop.ino'), 'utf8');
assert.doesNotMatch(ino, /\b(?:attach|detach|digitalWrite|analogWrite|pinMode|writeMicroseconds)\s*\(/);
assert.doesNotMatch(ino, /\bServo\s+\w+\s*;/);

class Nano {
  constructor() {
    this.frames = []; this.rx = []; this.line = ''; this.edges = []; this.ddr = []; this.portWrites = [];
    this.cpu = new CPU(new Uint16Array(flash.slice().buffer), 0x800);
    const cpu = this.cpu;
    new AVRIOPort(cpu, portBConfig); new AVRIOPort(cpu, portCConfig);
    const port = new AVRIOPort(cpu, portDConfig);
    new AVRTimer(cpu, timer0Config); new AVRTimer(cpu, timer1Config); new AVRTimer(cpu, timer2Config);
    this.uart = new AVRUSART(cpu, usart0Config, 16000000);
    this.repairs = preservePendingReceive(cpu, usart0Config);
    this.control = new D7Control(text => this.raw(text), () => this.now);
    this.uart.onByteTransmit = byte => {
      this.control.receive(String.fromCharCode(byte));
      if (byte === 10) { this.frames.push({ at: this.now, text: this.line.trim() }); this.line = ''; }
      else this.line += String.fromCharCode(byte);
    };
    port.addListener((value, old) => { if ((value ^ old) & 0xe0) this.edges.push({ at: this.now, value }); });
    for (const [register, collection] of [[portDConfig.DDR, this.ddr], [portDConfig.PORT, this.portWrites]]) {
      const original = cpu.writeHooks[register];
      cpu.writeHooks[register] = (value, old, mask) => {
        if ((value | old) & 0xe0) collection.push({ at: this.now, value, old });
        return original?.(value, old, mask);
      };
    }
    this.advance(200);
    assert.match(this.frames[0].text, /event=READY state=STOPPED/);
  }
  get now() { return this.cpu.cycles / 16000; }
  raw(text) { this.rx.push(...Buffer.from(text)); }
  advance(ms) {
    const end = this.cpu.cycles + ms * 16000;
    while (this.cpu.cycles < end) {
      if (this.rx.length && !this.uart.rxBusy && this.cpu.cycles >= (this.nextRx || 0)) {
        if (this.uart.writeByte(this.rx[0])) { this.rx.shift(); this.nextRx = this.cpu.cycles + this.uart.cyclesPerChar + 32; }
      }
      avrInstruction(this.cpu); this.cpu.tick();
    }
  }
  send(text) { this.raw(text + '\n'); this.advance(200); return this.frames.at(-1).text; }
  has(event) { return this.frames.some(f => f.text.includes('event=' + event + ' ')); }
  verify() {
    assert.deepEqual(this.edges, []); assert.deepEqual(this.ddr, []); assert.deepEqual(this.portWrites, []);
    assert.equal(this.cpu.data[portDConfig.DDR] & 0xe0, 0);
    assert.ok(this.frames.every(f => f.text.endsWith('output=DISABLED off=UNVERIFIED')));
    return { frames: this.frames, gpioEdges: this.edges, gpioOutputModes: this.ddr,
      gpioHighOrChangedWrites: this.portWrites, usartRepairs: this.repairs };
  }
}
const results = [];
function test(name, run) {
  const n = new Nano(); run(n); results.push({ name, result: 'PASS', ...n.verify() }); console.log('PASS ' + name);
}
test('START/STOP、重复 START 不重置起点、Windows 接口与虚拟串口联通', n => {
  n.control.command('START'); n.advance(200);
  assert.equal(n.control.state, 'SIM_RUNNING');
  assert.match(n.send('START'), /event=START_DUPLICATE/);
  n.control.command('STOP'); n.advance(200);
  assert.equal(n.control.state, 'STOPPED');
  assert.match(n.send('STOP\r'), /event=STOP state=STOPPED/);
});
test('主机静默 5000ms、超时锁定、心跳不恢复、STOP 后显式 START', n => {
  n.send('START'); n.advance(5100);
  assert.ok(n.has('HOST_TIMEOUT'));
  const frame = n.frames.find(f => f.text.includes('event=HOST_TIMEOUT '));
  assert.match(frame.text, /elapsed=500[0-9]/);
  assert.match(n.send('START'), /event=REJECT_STOP_REQUIRED/);
  n.send('PING'); assert.equal(n.control.state, 'TIMEOUT_LOCKED');
  n.send('STOP'); assert.match(n.send('START'), /event=START_SIM_ONLY/);
});
test('持续心跳仍在 10000ms 达到单次上限、重复 START 不延期', n => {
  n.send('START');
  for (let i = 0; i < 11; i++) { n.advance(700); n.send('PING'); if (i === 3) n.send('START'); }
  n.advance(500);
  assert.ok(n.has('MAX_TEST')); assert.equal(n.control.state, 'TIMEOUT_LOCKED');
  assert.match(n.frames.find(f => f.text.includes('event=MAX_TEST ')).text, /elapsed=1000[0-9]/);
});
test('非法、超长、嵌入 NUL、半帧均不能续租或激活，解析可恢复', n => {
  for (const text of ['START X', 'start', 'START\0', 'X'.repeat(80), '', 'STA\rRT']) {
    n.send(text); assert.equal(n.control.state, 'STOPPED');
  }
  n.send('START');
  for (let i = 0; i < 6; i++) { n.advance(700); n.send('INVALID'); }
  assert.ok(n.has('HOST_TIMEOUT'));
  n.send('STOP'); n.raw('STA'); n.advance(6000); assert.equal(n.control.state, 'STOPPED');
  n.raw('RT\n'); n.advance(200); assert.equal(n.control.state, 'SIM_RUNNING');
  n.send('STOP');
});
test('启动等待无自动运行，超时后等待无自动重启', n => {
  n.advance(11000); assert.equal(n.control.state, 'STOPPED');
  n.send('START'); n.advance(11000); assert.equal(n.control.state, 'TIMEOUT_LOCKED');
  n.send('STATUS'); assert.equal(n.control.state, 'TIMEOUT_LOCKED');
});
// A new virtual CPU executes reset startup, not the previous run's SRAM.
test('复位重新执行同一 HEX，不恢复此前运行', n => {
  n.send('START'); assert.equal(n.control.state, 'SIM_RUNNING');
  const reset = new Nano(); reset.send('STATUS'); assert.equal(reset.control.state, 'STOPPED'); reset.verify();
});
let time = 0, sent = [];
const c = new D7Control(line => sent.push(line), () => time);
assert.throws(() => c.command('START'));
c.receive('OTHER READY\n'); assert.throws(() => c.command('START'));
c.receive('D7DIAG/1 t=0 event=READY state=STOPPED elapsed=0 output=DISABLED off=UNVERIFIED\n');
assert.deepEqual(sent, []); // READY itself never sends START.
c.command('START'); assert.deepEqual(sent, ['START\n']);
time = 2501; assert.throws(() => c.command('START'));
c.reset(); assert.throws(() => c.command('START'));
for (const path of protectedPaths) assert.equal(sha(path), before[path], path + ' changed');
writeFileSync(join(out, 'results.json'), JSON.stringify({ result: 'PASS', testedAt: new Date().toISOString(),
  method: 'Actual compiled Nano HEX in AVR8js with existing test-side USART RXC compatibility adapter; no physical serial access. Reset uses fresh virtual CPU; bootloader/electrical behavior not modeled.',
  compile, before, protectedFilesUnchanged: true, interfaceChecks: 'identity, stale response, reset, READY never starts: PASS', results }, null, 2));
console.log(compile); console.log('Evidence: ' + out);
