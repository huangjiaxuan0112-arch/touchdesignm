// STEP 3E OFFLINE ONLY. No serialport import, device discovery, or upload command.
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
const out = mkdtempSync(join(root, 'docs/evidence/d7-real-driver-'));
const temp = mkdtempSync(join(tmpdir(), 'nature-touch-step3e-OFFLINE-'));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = path => sha(readFileSync(join(root, path)));
const original = join(root, 'firmware/unified/nature_touch_unified');
const protectedPaths = [
  ...['nature_touch_unified.ino', 'actuator-driver.h', 'simulated-actuators.h', 'experience-timelines.h', 'real-actuators.h'].map(p => 'firmware/unified/nature_touch_unified/' + p),
  'firmware/diagnostic/d7_start_stop/d7_start_stop.ino', 'firmware/diagnostic/d7_led_only/d7_led_only.ino',
  'docs/evidence/d7-reset-user-report-20261029.json', 'docs/evidence/d7-led-short-r7cS1T/trial.json',
  'docs/evidence/d7-reset-latest-pass-20261029.json',
];
const before = Object.fromEntries(protectedPaths.map(p => [p, hash(p)]));
writeFileSync(join(out, 'results.json'), JSON.stringify({ result: 'INCOMPLETE', before }));
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
const baselineHex = readFileSync(join(root, 'docs/evidence/firmware-upload-review-20261027/nature_touch_unified.ino.hex'), 'utf8');
assert.equal(locked.hexSha256, sha(baselineHex), 'Default production HEX changed');
writeFileSync(join(out, 'production-default.hex.txt'), locked.hex);
const gates = ['PHYSICAL_OUTPUTS_PERMITTED', 'D7_ACTIVATION_REVIEWED', 'POWER_CUTOFF_VERIFIED', 'OVERPRESSURE_PROTECTION_VERIFIED'];
const header = readFileSync(join(original, 'real-actuators.h'), 'utf8');
for (const gate of gates) assert.ok(header.includes(`static constexpr bool ${gate} = false;`));
assert.ok(header.includes('static constexpr bool D5_D6_OUTPUTS_PERMITTED = false;'));
assert.doesNotMatch(header, /\b(?:detach|digitalWrite|pinMode)\s*\(/);
assert.deepEqual([...header.matchAll(/\.attach\(([^)]+)\)/g)].map(m => m[1]), ['D7_PIN']);
// Temporary virtual-only copy. Repo selector and safety gates are never changed.
const virtualSketch = join(temp, 'virtual-only', 'nature_touch_unified'); mkdirSync(virtualSketch, { recursive: true });
for (const file of readdirSync(original)) if (/\.(ino|h)$/.test(file)) copyFileSync(join(original, file), join(virtualSketch, file));
let virtualHeader = header;
for (const gate of gates) virtualHeader = virtualHeader.replace(`static constexpr bool ${gate} = false;`, `static constexpr bool ${gate} = true;`);
writeFileSync(join(virtualSketch, 'real-actuators.h'), virtualHeader);
writeFileSync(join(virtualSketch, 'actuator-driver.h'), '#include "real-actuators.h"\nnamespace Actuators = RealActuators;\n');
const active = compile(virtualSketch, 'VIRTUAL-ONLY-D7');
// Do not publish the output-capable HEX to workspace evidence; it stays in temp.
const require = createRequire(join(root, 'test/avr8js-wind/package.json'));
const { CPU, avrInstruction, AVRIOPort, portBConfig, portCConfig, portDConfig,
  AVRTimer, timer0Config, timer1Config, timer2Config, AVRUSART, usart0Config } = require('avr8js');
class Nano {
  constructor(binary = active) {
    this.binary = binary; this.cpu = new CPU(new Uint16Array(binary.flash.slice().buffer), 0x800);
    this.frames = []; this.line = ''; this.rx = []; this.edges = []; this.d5d6 = []; this.modes = [];
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
      if ((value ^ old) & 128) this.edges.push({ us: cpu.cycles / 16, high: Boolean(value & 128) });
      if ((value ^ old) & 96) this.d5d6.push({ event: 'EDGE', value, old });
    });
    for (const reg of [portDConfig.DDR, portDConfig.PORT]) {
      const hook = cpu.writeHooks[reg];
      cpu.writeHooks[reg] = (value, old, mask) => {
        if ((value | old) & 96) this.d5d6.push({ reg, value, old });
        if (reg === portDConfig.DDR && ((value ^ old) & 128)) this.modes.push({ us: cpu.cycles / 16, output: Boolean(value & 128) });
        return hook?.(value, old, mask);
      };
    }
    this.advance(250);
    assert.ok(this.frames.some(f => f.message.name === 'READY'));
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
  request(type, requestId, payload = {}) {
    const start = this.frames.length;
    this.rx.push(...Buffer.from(JSON.stringify({ type, requestId, ...payload }) + '\n'));
    const wanted = () => this.frames.slice(start).find(f => f.message.requestId === requestId &&
      (type === 'STATUS_QUERY' ? f.message.type === 'STATUS' : ['ACK', 'NACK'].includes(f.message.type)));
    const deadline = this.now + 2000;
    while (!wanted() && this.now < deadline) this.advance(5);
    assert.ok(wanted(), 'Missing reply ' + type + '; partial=' + this.line);
    return wanted().message;
  }
  start(id = 'run') {
    assert.equal(this.request('SELECT', 'select' + id, { experienceId: 'WIND' }).accepted, true);
    assert.equal(this.request('START', 'start' + id, { operationId: id }).accepted, true);
    this.advance(80); this.assertPulse(1800, this.now - 60);
  }
  pulses() {
    const result = [];
    for (let i = 1; i < this.edges.length; i++) if (this.edges[i - 1].high && !this.edges[i].high)
      result.push({ riseUs: this.edges[i - 1].us, fallUs: this.edges[i].us, widthUs: this.edges[i].us - this.edges[i - 1].us });
    return result;
  }
  assertPulse(us, afterMs = 0) {
    const pulses = this.pulses().filter(p => p.riseUs >= afterMs * 1000);
    assert.ok(pulses.length >= 2, 'Insufficient pulses for ' + us);
    assert.ok(pulses.every(p => Math.abs(p.widthUs - us) <= 12), JSON.stringify(pulses.slice(-10)));
    for (let i = 1; i < pulses.length; i++) assert.ok(Math.abs(pulses[i].riseUs - pulses[i - 1].riseUs - 20000) < 30);
  }
  offSustained(ms = 500) {
    this.advance(60); const from = this.now; this.advance(ms);
    this.assertPulse(1200, from);
    assert.equal(this.cpu.data[portDConfig.DDR] & 128, 128);
    assert.deepEqual(this.modes.map(m => m.output), [true], 'D7 must stay attached');
  }
  evidence() {
    assert.deepEqual(this.d5d6, []);
    return { frames: this.frames, pulses: this.pulses(), d7Modes: this.modes, d5d6Activity: this.d5d6, usartRepairs: this.repairs };
  }
}
const checks = [], evidence = [];
function test(name, run, binary = active) {
  const n = new Nano(binary); const extra = run(n);
  evidence.push({ name, ...n.evidence(), extra }); checks.push({ name, result: 'PASS' }); console.log('PASS ' + name);
}
test('Production default stays simulation-only: zero D5/D6/D7 output', n => {
  assert.equal(n.request('SELECT', 's', { experienceId: 'WIND' }).accepted, true);
  assert.equal(n.request('START', 'a', { operationId: 'locked' }).accepted, true);
  n.advance(200); n.request('STOP', 'stop', { operationId: 'locked' }); n.advance(200);
  assert.deepEqual(n.edges, []); assert.deepEqual(n.modes, []);
}, locked);
test('Virtual startup preloads sustained 1200us; no 1500/1800us before START', n => {
  n.assertPulse(1200); n.offSustained();
  const first = n.pulses()[0];
  return { firstOffRiseUs: first.riseUs, firstCompleteOffPulseUs: first.fallUs,
    origin: 'Application reset vector PC=0 at 16MHz, no bootloader/crystal-startup/reset-held model; not physical reset-release latency.' };
});
test('Protocol v2 START -> 1800us, STOP -> sustained 1200us', n => {
  n.start(); assert.equal(n.request('STOP', 'stop', { operationId: 'run' }).accepted, true); n.offSustained();
  assert.equal(n.request('STATUS_QUERY', 'status').snapshot.state, 'IDLE');
});
test('HOST_TIMEOUT -> sustained OFF; RECOVER does not restart', n => {
  n.start(); n.advance(5300); n.offSustained();
  assert.equal(n.request('STATUS_QUERY', 'status').snapshot.faultCode, 'HOST_TIMEOUT');
  assert.equal(n.request('START', 'again', { operationId: 'again' }).accepted, false);
  assert.equal(n.request('RECOVER', 'recover').accepted, true); n.offSustained();
});
test('Injected actuator FAULT -> sustained OFF, never self-clears', n => {
  n.start(); const address = n.binary.symbols.get('RealActuators::faultLatched'); assert.ok(address >= 0);
  n.cpu.data[address] = 1; n.advance(200); n.offSustained();
  assert.equal(n.request('STATUS_QUERY', 'status').snapshot.faultCode, 'ACTUATOR_FAULT');
  assert.equal(n.request('START', 'again', { operationId: 'again' }).accepted, false); n.offSustained();
});
test('D6 deflation remains locked: OFF + FAULT without D5/D6 output', n => {
  n.start();
  for (let i = 0; i < 5; i++) { n.advance(700); n.request('STATUS_QUERY', 'hb' + i); }
  n.advance(500); n.offSustained();
  assert.equal(n.request('STATUS_QUERY', 'status').snapshot.faultCode, 'ACTUATOR_FAULT');
});
test('Reset from ON starts a fresh application at OFF with no restored START', n => {
  n.start();
  const reset = new Nano(active); reset.offSustained(1000); reset.assertPulse(1200);
  assert.equal(reset.request('STATUS_QUERY', 'resetstatus').snapshot.state, 'IDLE');
  return { resetEvidence: reset.evidence(), firstCompleteOffPulseUs: reset.pulses()[0].fallUs,
    physicalResetRetested: false, note: 'Fresh virtual CPU, same compiled HEX. External switch state and bootloader not modeled.' };
});
for (const path of protectedPaths) assert.equal(hash(path), before[path], path + ' changed during tests');
const result = { result: 'PASS', utc: new Date().toISOString(), defaultHexIdenticalToPreviousProduction: true,
  productionCompile: locked.log, productionHexSha256: locked.hexSha256, virtualOnlyCompile: active.log,
  virtualOnlyHexSha256: active.hexSha256, temporaryBuildDirectory: temp,
  virtualOnlyChanges: ['Copied selector aliases Actuators=RealActuators', ...gates.map(g => g + '=true in temporary copy only')],
  productionLocksUnchanged: true, d5d6LockNeverChanged: true, before, checks, evidence,
  scope: 'Actual compiled unified application HEX in AVR8js with existing test-side USART RXC adapter. No COM, upload, physical outputs or repeated physical tests. Output-capable HEX remains only in temporary directory.' };
writeFileSync(join(out, 'results.json'), JSON.stringify(result, null, 2));
console.log(locked.log); console.log(active.log); console.log('Evidence: ' + out);
