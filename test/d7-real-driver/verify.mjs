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
const out = mkdtempSync(join(root, 'docs/evidence/pneumatic-driver-'));
const temp = mkdtempSync(join(tmpdir(), 'nature-touch-step3g-OFFLINE-'));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = path => sha(readFileSync(join(root, path)));
const original = join(root, 'firmware/unified/nature_touch_unified');
const protectedPaths = [
  ...['nature_touch_unified.ino', 'actuator-driver.h', 'simulated-actuators.h', 'experience-timelines.h', 'real-actuators.h'].map(p => 'firmware/unified/nature_touch_unified/' + p),
  'firmware/diagnostic/d7_start_stop/d7_start_stop.ino', 'firmware/diagnostic/d7_led_only/d7_led_only.ino',
  'docs/evidence/d7-reset-user-report-20261029.json', 'docs/evidence/d7-led-short-r7cS1T/trial.json',
  'docs/evidence/d7-reset-latest-pass-20261029.json',
  'docs/evidence/d5-electrical-physical-pass-20261029.json',
  'docs/evidence/d5-pneumatic-flow-user-report-20261029.json',
  'docs/evidence/d6-legacy-endpoints-physical-pass-20261029.json',
  'docs/evidence/pneumatic-routing-confirmed-20261029.json',
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
const gates = ['PHYSICAL_OUTPUTS_PERMITTED', 'D5_D6_OUTPUTS_PERMITTED', 'D7_ACTIVATION_REVIEWED',
  'POWER_CUTOFF_VERIFIED', 'OVERPRESSURE_PROTECTION_VERIFIED', 'STARTUP_AND_TRANSITION_BEHAVIOR_VERIFIED',
  'STOP_VALVE_VERIFIED', 'D6_MAPPING_VERIFIED', 'PUMP_OFF_SETTLE_VERIFIED', 'VALVE_SETTLE_VERIFIED'];
const header = readFileSync(join(original, 'real-actuators.h'), 'utf8');
for (const gate of gates) assert.ok(header.includes(`static constexpr bool ${gate} = false;`));
assert.ok(header.includes('STOP_VALVE_US = 1200;'));
assert.ok(header.includes('D6_OFF_US = 1200, D6_ON_US = 1800;'));
assert.ok(header.includes('PUMP_OFF_SETTLE_MS = 500;'));
assert.ok(header.includes('VALVE_SETTLE_MS = 300;'));
assert.doesNotMatch(header, /\b(?:detach|digitalWrite|pinMode)\s*\(/);
assert.deepEqual([...header.matchAll(/\.attach\(([^)]+)\)/g)].map(m => m[1]), ['D6_PIN', 'D7_PIN', 'D5_PIN']);
const virtualSketch = join(temp, 'virtual-only', 'nature_touch_unified'); mkdirSync(virtualSketch, { recursive: true });
for (const file of readdirSync(original)) if (/\.(ino|h)$/.test(file)) copyFileSync(join(original, file), join(virtualSketch, file));
let virtualHeader = header;
for (const gate of gates) virtualHeader = virtualHeader.replace(`static constexpr bool ${gate} = false;`, `static constexpr bool ${gate} = true;`);
// Synthetic parameters for virtual logic checks ONLY; not measured hardware values.
virtualHeader = virtualHeader.replace('PUMP_OFF_SETTLE_MS = 500;', 'PUMP_OFF_SETTLE_MS = 100;')
  .replace('VALVE_SETTLE_MS = 300;', 'VALVE_SETTLE_MS = 100;');
writeFileSync(join(virtualSketch, 'real-actuators.h'), virtualHeader);
const realBuild = ['--build-property', 'compiler.cpp.extra_flags=-DNATURE_TOUCH_ACTUATOR_DRIVER=1'];
const active = compile(virtualSketch, 'VIRTUAL-ONLY-PNEUMATIC', realBuild);
// Enlarge only the temporary waiting window to test cancellation in each stage.
// At 9600 baud a STOP round-trip can otherwise outlast a 200ms synthetic handover.
const pendingSketch = join(temp, 'pending-only', 'nature_touch_unified'); mkdirSync(pendingSketch, { recursive: true });
for (const file of readdirSync(virtualSketch)) if (/\.(ino|h)$/.test(file)) copyFileSync(join(virtualSketch, file), join(pendingSketch, file));
writeFileSync(join(pendingSketch, 'real-actuators.h'), virtualHeader
  .replace('PUMP_OFF_SETTLE_MS = 100;', 'PUMP_OFF_SETTLE_MS = 1000;')
  .replace('VALVE_SETTLE_MS = 100;', 'VALVE_SETTLE_MS = 1000;'));
const pendingBinary = compile(pendingSketch, 'VIRTUAL-ONLY-PENDING', realBuild);
const require = createRequire(join(root, 'test/avr8js-wind/package.json'));
const { CPU, avrInstruction, AVRIOPort, portBConfig, portCConfig, portDConfig,
  AVRTimer, timer0Config, timer1Config, timer2Config, AVRUSART, usart0Config } = require('avr8js');
const OFF = [1200, 1200, 1200], FILL = [1800, 1200, 1800], DRAIN = [1200, 1800, 1200];
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
    this.begin(mode, id); this.advance(300); this.assertState(FILL, this.now - 80);
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
const checks = [], evidence = [];
function test(name, run, binary = active) {
  const n = new Nano(binary);
  try {
    const extra = run(n);
    evidence.push({ name, ...n.evidence(), extra }); checks.push({ name, result: 'PASS' }); console.log('PASS ' + name);
  } catch (error) {
    writeFileSync(join(out, 'failure.json'), JSON.stringify({ name, error: error.stack, frames: n.frames,
      pulses: [5, 6, 7].flatMap(pin => n.pulses(pin)), modes: n.modes }, null, 2));
    throw error;
  }
}
test('Production default unchanged: zero D5/D6/D7 output', n => {
  n.begin(); n.advance(200); n.request('STOP', 'stop', { operationId: 'run' }); n.advance(200);
  assert.deepEqual(n.modes, []); for (const pin of [5, 6, 7]) assert.deepEqual(n.edges[pin], []);
}, locked);
test('Startup preloads all OFF; no ON or default 1500us before START', n => {
  n.assertState(OFF); n.offSustained();
  return { firstCompleteOffPulseUs: Object.fromEntries([5, 6, 7].map(pin => [pin, n.pulses(pin)[0].fallUs])),
    origin: 'Application PC=0 at 16MHz; not physical reset-release latency; no bootloader model.' };
});
test('Real selector uses truthful protocol v2 identity and output capability', n => {
  const identity = n.request('IDENTIFY', 'identity', { protocol: 2 });
  assert.equal(identity.firmware, 'nature-touch-unified-real');
  assert.equal(identity.protocol, 2); assert.equal(identity.hardwareOutputsEnabled, true);
  assert.ok(identity.capabilities.includes('REAL_ACTUATORS'));
  assert.ok(!identity.capabilities.includes('SIMULATION_ONLY'));
  assert.equal(n.request('STATUS_QUERY', 'outputstatus').snapshot.hardwareOutputsEnabled, true);
});
test('START -> correct INFLATE; STOP -> sustained pumps OFF plus test-only STOP valve', n => {
  n.start(); assert.equal(n.request('STOP', 'stop', { operationId: 'run' }).accepted, true); n.offSustained();
  assert.equal(n.request('STATUS_QUERY', 'status').snapshot.state, 'IDLE');
});
test('Pump reversal goes through OFF before ON in both directions', n => {
  n.start(); n.heartbeat(Math.max(0, 5400 - n.elapsed)); n.advance(60); n.assertState(DRAIN, n.now - 50);
  n.heartbeat(Math.max(0, 7000 - n.elapsed)); n.advance(60); n.assertState(FILL, n.now - 50);
  // A completed OFF frame must precede the opposite pump ON by a logical gap.
  const events = [6, 7].flatMap(pin => n.pulses(pin)).sort((a, b) => a.fallUs - b.fallUs);
  let oldOnPin = null, oldOffAt = null; const handovers = [];
  for (const p of events) {
    const isOn = Math.abs(p.widthUs - 1800) <= 12;
    if (!isOn && p.pin === oldOnPin) oldOffAt ??= p.fallUs;
    if (isOn && oldOnPin !== p.pin) {
      if (oldOnPin !== null) {
        assert.ok(oldOffAt !== null && p.fallUs - oldOffAt > 150000);
        handovers.push({ from: oldOnPin, to: p.pin, decodedOffToOnUs: p.fallUs - oldOffAt });
      }
      oldOnPin = p.pin; oldOffAt = null;
    }
  }
  assert.ok(handovers.length >= 2); return { handovers, physicalTurnOffMeasured: false };
});
test('HOST_TIMEOUT cancels work and holds OFF; RECOVER never restarts', n => {
  n.start(); n.advance(5300); n.offSustained();
  assert.equal(n.request('STATUS_QUERY', 'status').snapshot.faultCode, 'HOST_TIMEOUT');
  assert.equal(n.request('START', 'again', { operationId: 'again' }).accepted, false);
  assert.equal(n.request('RECOVER', 'recover').accepted, true); n.offSustained();
});
test('Actuator FAULT returns both pumps OFF and stays latched', n => {
  n.start(); n.injectFault(); n.advance(200); n.offSustained();
  assert.equal(n.request('STATUS_QUERY', 'status').snapshot.faultCode, 'ACTUATOR_FAULT');
  assert.equal(n.request('START', 'again', { operationId: 'again' }).accepted, false); n.offSustained();
});
test('STOP during initial handover cancels pending ON permanently', n => {
  n.begin(); assert.equal(n.request('STOP', 'cancel', { operationId: 'run' }).accepted, true); n.offSustained(500);
  assert.ok(n.pulses(7).every(p => Math.abs(p.widthUs - 1200) <= 12));
}, pendingBinary);
test('STOP during valve-settle stage cancels pending ON permanently', n => {
  n.begin(); n.advance(1100);
  assert.equal(n.request('STOP', 'cancel', { operationId: 'run' }).accepted, true); n.offSustained(1100);
  assert.ok(n.pulses(7).every(p => Math.abs(p.widthUs - 1200) <= 12));
}, pendingBinary);
test('FAULT during initial handover cancels pending ON permanently', n => {
  n.begin(); n.injectFault(); n.advance(200); n.offSustained(500);
  assert.ok(n.pulses(7).every(p => Math.abs(p.widthUs - 1200) <= 12));
});
test('Reset from ON initializes OFF without restoring old START', n => {
  n.start(); const reset = new Nano(); reset.offSustained(600);
  assert.equal(reset.request('STATUS_QUERY', 'resetstatus').snapshot.state, 'IDLE');
  return { resetEvidence: reset.evidence(), physicalResetRetested: false };
});
for (const [mode, duration] of [['WIND', 24000], ['WAVE', 25000], ['BUBBLE', 27420]]) {
  test(mode + ' completes at original scheduler deadline; no appended deflation', n => {
    n.start(mode); n.heartbeat(duration + 200); n.offSustained();
    const status = n.request('STATUS_QUERY', 'final');
    assert.equal(status.snapshot.state, 'COMPLETED'); assert.equal(status.snapshot.elapsedMs, duration);
    assert.equal(n.frames.filter(f => f.message.name === 'COMPLETED').length, 1);
    if (mode === 'BUBBLE') {
      const start = n.frames.find(f => f.message.name === 'ACTUATOR_EVENT' && f.message.action === 'INFLATE').at;
      const continuous = n.pulses(7).filter(p => p.riseUs / 1000 > start + 400 && p.riseUs / 1000 < start + 4500);
      assert.ok(continuous.length > 100); assert.ok(continuous.every(p => Math.abs(p.widthUs - 1800) <= 12));
    }
  });
}
for (const path of protectedPaths) assert.equal(hash(path), before[path], path + ' changed during tests');
const result = { result: 'PASS', utc: new Date().toISOString(), defaultHexIdenticalToPreviousProduction: true,
  productionCompile: locked.log, productionHexSha256: locked.hexSha256, virtualOnlyCompile: active.log,
  virtualOnlyHexSha256: active.hexSha256, pendingOnlyCompile: pendingBinary.log,
  pendingOnlyHexSha256: pendingBinary.hexSha256, temporaryBuildDirectory: temp,
  virtualOnlyChanges: ['Actual real selector=1, unchanged in copied source', ...gates.map(g => g + '=true in temporary copy only'),
    'STOP_VALVE_US=1200, PUMP_OFF_SETTLE_MS=100, VALVE_SETTLE_MS=100, and all verification gates true in a temporary copy only: synthetic assumptions, NOT measured or approved for hardware',
    'Separate pending-cancellation fixture uses 1000ms + 1000ms synthetic waits to keep STOP inside the pending window'],
  productionLocksUnchanged: true, before, checks, evidence,
  scope: 'Actual compiled unified HEX in AVR8js with test-side USART RXC adapter. No COM, upload or physical outputs. Output-capable HEX remains in temp. Decoded nonoverlap does not prove physical pump shutdown. Handover waits fit inside original action windows; physical calibration remains pending.' };
writeFileSync(join(out, 'results.json'), JSON.stringify(result, null, 2));
console.log(locked.log); console.log(active.log); console.log('Evidence: ' + out);
