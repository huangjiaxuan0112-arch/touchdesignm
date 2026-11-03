// Offline only: compile and run actual Nano HEX; never opens COM or uploads.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preservePendingReceive } from '../unified-controller/avr-usart-compat.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = mkdtempSync(join(root, 'docs/evidence/d7-led-only-'));
const hash = p => createHash('sha256').update(readFileSync(join(root, p))).digest('hex');
const protectedPaths = [
  'firmware/diagnostic/d7_start_stop/d7_start_stop.ino',
  'firmware/diagnostic/d7_start_stop/windows-control.cjs',
  ...['nature_touch_unified.ino', 'real-actuators.h', 'actuator-driver.h', 'simulated-actuators.h', 'experience-timelines.h']
    .map(p => 'firmware/unified/nature_touch_unified/' + p),
];
const before = Object.fromEntries(protectedPaths.map(p => [p, hash(p)]));
writeFileSync(join(out, 'results.json'), JSON.stringify({ result: 'INCOMPLETE', before }));
const build = mkdtempSync(join(tmpdir(), 'nature-touch-d7-led-'));
const cli = join(homedir(), 'AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe');
const config = join(build, 'arduino-cli.yaml');
writeFileSync(config, `directories:\n  data: ${JSON.stringify(join(homedir(), 'AppData/Local/Arduino15'))}\n  user: ${JSON.stringify(build)}\n  downloads: ${JSON.stringify(join(build, 'downloads'))}\nbuild_cache:\n  path: ${JSON.stringify(join(build, 'cache'))}\n`);
const args = ['--config-file', config, 'compile', '--fqbn', 'arduino:avr:nano:cpu=atmega328',
  '--libraries', join(homedir(), 'AppData/Local/Arduino15/libraries'), '--build-path', build,
  join(root, 'firmware/diagnostic/d7_led_only')];
const compile = execFileSync(cli, args, { encoding: 'utf8', timeout: 180000 });
writeFileSync(join(out, 'compile.log'), compile);
const hex = readFileSync(join(build, 'd7_led_only.ino.hex'), 'utf8');
writeFileSync(join(out, 'diagnostic.hex.txt'), hex);
const flash = new Uint8Array(32768).fill(255);
let base = 0;
for (const line of hex.trim().split(/\r?\n/)) {
  const b = [...Buffer.from(line.slice(1), 'hex')];
  assert.equal(b.reduce((a, n) => a + n, 0) & 255, 0);
  if (b[3] === 0) flash.set(b.slice(4, 4 + b[0]), base + b[1] * 256 + b[2]);
  else if (b[3] === 4) base = (b[4] * 256 + b[5]) * 65536;
}
const require = createRequire(join(root, 'test/avr8js-wind/package.json'));
const { CPU, avrInstruction, AVRIOPort, portBConfig, portCConfig, portDConfig,
  AVRTimer, timer0Config, timer1Config, timer2Config, AVRUSART, usart0Config } = require('avr8js');
class Nano {
  constructor() {
    this.cpu = new CPU(new Uint16Array(flash.slice().buffer), 0x800);
    this.frames = []; this.rx = []; this.text = ''; this.edges = []; this.isolation = [];
    const cpu = this.cpu;
    new AVRIOPort(cpu, portBConfig); new AVRIOPort(cpu, portCConfig);
    const port = new AVRIOPort(cpu, portDConfig);
    new AVRTimer(cpu, timer0Config); new AVRTimer(cpu, timer1Config); new AVRTimer(cpu, timer2Config);
    this.uart = new AVRUSART(cpu, usart0Config, 16000000);
    this.repairs = preservePendingReceive(cpu, usart0Config);
    this.uart.onByteTransmit = byte => {
      if (byte === 10) { this.frames.push({ at: this.now, text: this.text.trim() }); this.text = ''; }
      else this.text += String.fromCharCode(byte);
    };
    port.addListener((value, old) => {
      if ((value ^ old) & 128) this.edges.push({ us: cpu.cycles / 16, high: Boolean(value & 128) });
      if ((value ^ old) & 96) this.isolation.push({ type: 'D5D6_EDGE', value, old });
    });
    for (const reg of [portDConfig.DDR, portDConfig.PORT]) {
      const hook = cpu.writeHooks[reg];
      cpu.writeHooks[reg] = (value, old, mask) => {
        if ((value | old) & 96) this.isolation.push({ reg, value, old });
        return hook?.(value, old, mask);
      };
    }
    this.advance(250);
    assert.match(this.frames[0].text, /READY_NO_SIGNAL attached=0/);
    assert.equal(cpu.data[portDConfig.DDR] & 224, 0);
  }
  get now() { return this.cpu.cycles / 16000; }
  advance(ms) {
    const end = this.cpu.cycles + ms * 16000;
    while (this.cpu.cycles < end) {
      if (this.rx.length && !this.uart.rxBusy && this.cpu.cycles >= (this.nextRx || 0)) {
        if (this.uart.writeByte(this.rx[0])) { this.rx.shift(); this.nextRx = this.cpu.cycles + this.uart.cyclesPerChar + 32; }
      }
      avrInstruction(this.cpu); this.cpu.tick();
    }
  }
  send(text) { this.rx.push(...Buffer.from(text + '\n')); this.advance(250); return this.frames.at(-1).text; }
  select(command) {
    const result = this.send(command); assert.match(result, /event=AWAIT_CONFIRM attached=0/);
    return result.match(/pending=(\d+)/)[1];
  }
  widths(from) {
    const edges = this.edges.slice(from), widths = [];
    for (let i = 1; i < edges.length; i++)
      if (edges[i - 1].high && !edges[i].high) widths.push(edges[i].us - edges[i - 1].us);
    return widths;
  }
  check() {
    assert.deepEqual(this.isolation, []);
    assert.ok(this.frames.every(f => f.text.endsWith('physical_off=UNVERIFIED led=UNOBSERVED')));
    return { frames: this.frames, d7Edges: this.edges, d5d6Activity: this.isolation, usartRepairs: this.repairs };
  }
}
const results = [];
function test(name, run) {
  const n = new Nano(); run(n); results.push({ name, result: 'PASS', ...n.check() }); console.log('PASS ' + name);
}
test('启动/复位无输出；未确认、错误编号、过期确认均不输出', n => {
  n.advance(5200); assert.deepEqual(n.edges, []);
  n.send('CONFIRM 1'); assert.deepEqual(n.edges, []);
  const ticket = n.select('SHORT_PULSE');
  n.send('CONFIRM 999'); assert.deepEqual(n.edges, []);
  n.advance(5200); n.send('CONFIRM ' + ticket); assert.deepEqual(n.edges, []);
  for (const text of ['START', 'SHORT_PULSE X', 'CONFIRM 1 X', 'X'.repeat(70), 'SHORT_PULSE\0']) n.send(text);
  assert.deepEqual(n.edges, []);
});
test('1200/1800us 实际波形；每次需新确认；STOP 移除信号', n => {
  for (const [command, width] of [['SHORT_PULSE', 1200], ['LONG_PULSE', 1800]]) {
    const from = n.edges.length, ticket = n.select(command);
    assert.equal(n.edges.length, from);
    assert.match(n.send('CONFIRM ' + ticket), /event=APPLIED attached=1/);
    const widths = n.widths(from); assert.ok(widths.length >= 5);
    assert.ok(widths.every(w => Math.abs(w - width) < 12), JSON.stringify(widths));
    assert.match(n.send('LONG_PULSE'), /REJECT_ACTIVE_USE_STOP_FIRST/);
    n.send('STOP'); const stopped = n.edges.length;
    assert.equal(n.cpu.data[portDConfig.DDR] & 128, 0);
    n.advance(500); assert.equal(n.edges.length, stopped);
    n.send('CONFIRM ' + ticket); assert.equal(n.edges.length, stopped);
  }
  const reset = new Nano(); reset.advance(500); assert.deepEqual(reset.edges, []); reset.check();
});
test('2秒主机超时；不会自动续发，旧确认失效', n => {
  const ticket = n.select('LONG_PULSE'); n.send('CONFIRM ' + ticket); n.advance(2200);
  assert.ok(n.frames.some(f => /HOST_TIMEOUT_SIGNAL_REMOVED attached=0/.test(f.text)));
  const stopped = n.edges.length; n.send('STATUS'); n.send('CONFIRM ' + ticket); n.advance(300);
  assert.equal(n.edges.length, stopped);
});
test('有心跳仍在5秒结束；无自动重复周期', n => {
  n.send('CONFIRM ' + n.select('SHORT_PULSE'));
  for (let i = 0; i < 18; i++) { n.advance(100); n.send('STATUS'); }
  assert.ok(n.frames.some(f => /MAX_TEST_SIGNAL_REMOVED attached=0/.test(f.text)));
  const stopped = n.edges.length; n.advance(1500); assert.equal(n.edges.length, stopped);
});
for (const p of protectedPaths) assert.equal(hash(p), before[p]);
writeFileSync(join(out, 'results.json'), JSON.stringify({ result: 'PASS', utc: new Date().toISOString(), compile,
  before, protectedFilesUnchanged: true, build, config, cli, fqbn: 'arduino:avr:nano:cpu=atmega328',
  sourceSha256: hash('firmware/diagnostic/d7_led_only/d7_led_only.ino'),
  method: 'Actual compiled Nano HEX in AVR8js with existing USART RXC compatibility adapter. No serial device, LED or physical reset/bootloader tested.',
  physicalObservations: [], repeatability: 'NOT_TESTED', results }, null, 2));
console.log(compile); console.log('Evidence: ' + out);
