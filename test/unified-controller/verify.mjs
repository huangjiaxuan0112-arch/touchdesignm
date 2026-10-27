// Actual unified Nano HEX execution, virtual UART only. No serialport import.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { EXPERIENCE_DEFINITIONS } from '../../desktop/shared/experience-definitions.ts';
import { preservePendingReceive } from './avr-usart-compat.mjs';
const require = createRequire(new URL('../avr8js-wind/package.json', import.meta.url));
const { CPU, avrInstruction, AVRTimer, timer0Config, timer1Config, timer2Config,
  AVRIOPort, portBConfig, portCConfig, portDConfig, AVRUSART, usart0Config } = require('avr8js');
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const output = resolve(process.env.UNIFIED_RESULTS || join(here, 'results'));
mkdirSync(output, { recursive: true });
const sha = data => createHash('sha256').update(data).digest('hex');
const startedAtUtc = new Date().toISOString();
writeFileSync(join(output, 'results.json'), JSON.stringify({ result: 'INCOMPLETE', startedAtUtc }));
const cli = process.env.ARDUINO_CLI || join(homedir(), 'AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe');
const gccRoot = join(homedir(), 'AppData/Local/Arduino15/packages/arduino/tools/avr-gcc');
const nm = process.env.AVR_NM || join(gccRoot, readdirSync(gccRoot).sort().at(-1), 'bin/avr-nm.exe');
const build = mkdtempSync(join(tmpdir(), 'nature-touch-unified-step4-'));
const sketch = join(root, 'firmware/unified/nature_touch_unified');
const compileArgs = ['compile', '--fqbn', 'arduino:avr:nano:cpu=atmega328', '--build-path', build, sketch];
const compileLog = execFileSync(cli, compileArgs, { encoding: 'utf8', timeout: 180000 });
writeFileSync(join(output, 'compile.log'), compileLog);
const stdioBridge = process.argv.includes('--stdio-bridge');
if (!stdioBridge) console.log(compileLog);
const symbolsText = execFileSync(nm, ['--demangle', '--numeric-sort', join(build, 'nature_touch_unified.ino.elf')], { encoding: 'utf8' });
writeFileSync(join(output, 'symbols.txt'), symbolsText);
const symbols = new Map([...symbolsText.matchAll(/^([\da-f]+)\s+\w\s+(.+)$/gmi)].map(m => [m[2].trim(), parseInt(m[1], 16)]));
function address(name) {
  assert.ok(symbols.has(name), `Missing compiled symbol ${name}`);
  return symbols.get(name) - 0x800000;
}
const hex = readFileSync(join(build, 'nature_touch_unified.ino.hex'), 'utf8');
writeFileSync(join(output, 'unified.hex.txt'), hex);
const flash = new Uint8Array(32768).fill(255);
let base = 0, eof = false;
for (const line of hex.trim().split(/\r?\n/)) {
  assert.ok(!eof && /^:(?:[\da-f]{2})+$/i.test(line));
  const b = [...Buffer.from(line.slice(1), 'hex')], size = b[0], type = b[3];
  assert.equal(b.length, size + 5); assert.equal(b.reduce((a, v) => a + v, 0) & 255, 0);
  if (type === 0) flash.set(b.slice(4, 4 + size), base + b[1] * 256 + b[2]);
  else if (type === 1) eof = true;
  else if (type === 4) base = (b[4] * 256 + b[5]) * 65536;
  else throw Error(`Unexpected HEX record ${type}`);
}
assert.ok(eof);
const protectedPaths = [
  ...JSON.parse(readFileSync(join(root, 'test/avr8js-wind/preservation-baseline.json'), 'utf8').replace(/^\uFEFF/, ''))
    .filter(e => !e.path.endsWith('nature_touch_unified.ino')).map(e => e.path),
  ...['wind', 'wave', 'bubble'].flatMap(mode => readdirSync(join(root, 'test/avr8js-wind/results-step3', mode)).map(file => `test/avr8js-wind/results-step3/${mode}/${file}`)),
  'test/avr8js-wind/results-step3/all-modes.json', 'docs/phase-3b-step3-all-modes-simulation.md',
  'docs/phase-2d-protocol-validation.md',
];
const before = Object.fromEntries([...new Set(protectedPaths)].map(path => [path, sha(readFileSync(join(root, path)))]));

class VirtualNano {
  constructor(name) {
    this.name = name; this.frames = []; this.inputFrames = []; this.outputRecords = []; this.rx = []; this.rxIndex = 0;
    this.traceStack = Boolean(process.env.TRACE_STACK);
    this.nextRxCycle = 0; this.line = ''; this.gpioEdges = []; this.enabledPins = [];
    this.cpu = new CPU(new Uint16Array(flash.slice().buffer), 0x800);
    this.stackLowWater = this.cpu.SP;
    const cpu = this.cpu;
    new AVRIOPort(cpu, portBConfig); new AVRIOPort(cpu, portCConfig);
    const port = new AVRIOPort(cpu, portDConfig);
    new AVRTimer(cpu, timer0Config); new AVRTimer(cpu, timer1Config); new AVRTimer(cpu, timer2Config);
    this.uart = new AVRUSART(cpu, usart0Config, 16000000);
    this.usartRepairs = preservePendingReceive(cpu, usart0Config);
    this.uart.onByteTransmit = byte => {
      this.stackLowWater = Math.min(this.stackLowWater, cpu.SP);
      if (byte === 10) {
        const text = this.line.trim(); this.line = '';
        this.frames.push({ virtualMs: this.now, message: JSON.parse(text) });
      } else this.line += String.fromCharCode(byte);
    };
    port.addListener((value, old) => { if ((value ^ old) & 0xe0) this.gpioEdges.push({ virtualMs: this.now, value: value & 0xe0 }); });
    const originalDDR = cpu.writeHooks[portDConfig.DDR];
    cpu.writeHooks[portDConfig.DDR] = (value, old, mask) => {
      if (value & 0xe0) this.enabledPins.push({ virtualMs: this.now, value });
      return originalDDR?.(value, old, mask);
    };
    const rev = address('ActuatorSimulation::revision');
    cpu.writeHooks[address('inputLineReady')] = value => {
      if (value) {
        const start = address('inputLine'), size = cpu.data[address('inputLength')];
        this.inputFrames.push({ virtualMs: this.now, line: Buffer.from(cpu.data.slice(start, start + size)).toString(),
          tooLong: Boolean(cpu.data[address('lineTooLong')]) });
      }
      return false;
    };
    cpu.writeHooks[rev] = (value, old) => {
      if (value === old) return false; // startup BSS writes are not API calls
      this.outputRecords.push({ virtualMs: this.now, revision: value,
        intent: ['STOPPED', 'INFLATING', 'DEFLATING'][cpu.data[address('ActuatorSimulation::intent')]],
        recordedAtMs: cpu.dataView.getUint32(address('ActuatorSimulation::recordedAtMs'), true),
        commandCount: cpu.dataView.getUint16(address('ActuatorSimulation::commandCount'), true) });
      return false;
    };
    this.waitFor(() => this.frames.some(f => f.message.name === 'READY'), 2000);
    this.advance(5);
  }
  get now() { return this.cpu.cycles / 16000; }
  get intent() { return ['STOPPED', 'INFLATING', 'DEFLATING'][this.cpu.data[address('ActuatorSimulation::intent')]]; }
  get state() { return ['IDLE', 'RUNNING', 'STOPPING', 'COMPLETED', 'FAULT'][this.cpu.dataView.getUint16(address('controlState'), true)]; }
  advance(ms) {
    const end = this.cpu.cycles + ms * 16000;
    while (this.cpu.cycles < end) {
      if (this.rxIndex < this.rx.length && this.cpu.cycles >= this.nextRxCycle && !this.uart.rxBusy) {
        if (this.uart.writeByte(this.rx[this.rxIndex])) {
          this.rxIndex++; this.nextRxCycle = this.cpu.cycles + this.uart.cyclesPerChar + 32;
        }
      }
      avrInstruction(this.cpu); this.cpu.tick();
      if (this.traceStack) this.stackLowWater = Math.min(this.stackLowWater, this.cpu.SP);
    }
  }
  waitFor(predicate, maxMs = 3000) {
    const deadline = this.now + maxMs;
    while (!predicate() && this.now < deadline) this.advance(5);
    if (!predicate()) {
      writeFileSync(join(output, `failure-${this.name}.json`), JSON.stringify({ state: this.state, intent: this.intent,
        stackLowWater: this.stackLowWater, bssEnd: address('__bss_end'),
        frames: this.frames, inputFrames: this.inputFrames, outputRecords: this.outputRecords, partialOutput: this.line,
        rxIndex: this.rxIndex, rxLength: this.rx.length }, null, 2));
    }
    assert.ok(predicate(), `${this.name}: wait timed out at ${this.now} ms`);
  }
  raw(text) { this.rx.push(...Buffer.from(text + '\n')); }
  request(type, requestId, payload = {}) {
    const from = this.frames.length;
    this.raw(JSON.stringify({ type, requestId, ...payload }));
    this.waitFor(() => this.frames.slice(from).some(f => f.message.requestId === requestId &&
      (type === 'STATUS_QUERY' ? f.message.type === 'STATUS' : ['ACK', 'NACK'].includes(f.message.type))));
    return this.frames.slice(from).find(f => f.message.requestId === requestId &&
      (type === 'STATUS_QUERY' ? f.message.type === 'STATUS' : ['ACK', 'NACK'].includes(f.message.type))).message;
  }
  start(mode, operationId, prefix = 's') {
    assert.equal(this.request('SELECT', `${prefix}select`, { experienceId: mode }).accepted, true);
    assert.equal(this.request('START', `${prefix}start`, { operationId }).accepted, true);
    this.waitFor(() => this.intent === 'INFLATING');
  }
  runWithHeartbeat(ms) {
    const end = this.now + ms;
    let id = 0;
    while (this.now < end) {
      this.advance(Math.min(1200, end - this.now));
      this.request('STATUS_QUERY', `hb${id++}`);
    }
  }
  verifyDisabled() {
    assert.deepEqual(this.enabledPins, [], 'D5/D6/D7 were configured as outputs');
    assert.deepEqual(this.gpioEdges, [], 'Unexpected D5/D6/D7 edge');
    assert.equal(this.cpu.data[portDConfig.DDR] & 0xe0, 0);
    for (const f of this.frames) {
      assert.ok(JSON.stringify(f.message).length <= 384, 'Response exceeds existing host line limit');
      if ('hardwareOutputsEnabled' in f.message) assert.equal(f.message.hardwareOutputsEnabled, false);
      if (f.message.snapshot) assert.equal(f.message.snapshot.hardwareOutputsEnabled, false);
    }
  }
  evidence() {
    this.verifyDisabled();
    return { name: this.name, virtualSeconds: this.now / 1000, state: this.state,
      intent: this.intent, outputRecords: this.outputRecords, frames: this.frames, inputFrames: this.inputFrames,
      gpioEdges: this.gpioEdges, enabledPins: this.enabledPins, injectedFault: this.injectedFault,
      usartRepairs: this.usartRepairs, sampledStackLowWater: this.stackLowWater, staticRamEnd: address('__bss_end') };
  }
}

// Test-only bridge: the existing virtual Nano runs the compiled HEX behind the
// Electron app's normal serial transport. No native serial device is involved.
if (stdioBridge) {
  const { createInterface } = await import('node:readline');
  const n = new VirtualNano('electron-virtual-nano');
  let delivered = 0;
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  const deliver = () => {
    while (delivered < n.frames.length) send({ kind: 'frame', ...n.frames[delivered++] });
  };
  send({ kind: 'ready' });
  deliver();
  const timer = setInterval(() => { n.advance(10); deliver(); }, 10);
  const input = createInterface({ input: process.stdin });
  let rejectNextRecovery = false;
  input.on('line', text => {
    const message = JSON.parse(text);
    if (message.rejectNextRecovery) rejectNextRecovery = true;
    if (message.line) {
      if (rejectNextRecovery && JSON.parse(message.line).type === 'RECOVER') {
        // Test-only race: device left FAULT after the host's status precheck.
        // The real compiled command parser must produce INVALID_STATE itself.
        n.cpu.data[address('ActuatorSimulation::faultLatched')] = 0;
        n.cpu.dataView.setUint16(address('controlState'), 0, true);
        rejectNextRecovery = false;
      }
      n.raw(message.line);
    }
    if (message.fault) n.cpu.data[address('ActuatorSimulation::faultLatched')] = 1;
  });
  await new Promise(resolve => input.once('close', resolve));
  clearInterval(timer);
  writeFileSync(join(output, 'bridge-results.json'), JSON.stringify({ result: 'PASS',
    method: 'Compiled Nano HEX behind Electron test-only serial adapter; no COM',
    compileLog, hexSha256: sha(hex), evidence: n.evidence() }, null, 2));
  process.exit(0);
}

const checks = [], evidence = [];
function test(name, body) {
  if (process.env.UNIFIED_CASE && !name.includes(process.env.UNIFIED_CASE)) return;
  try { body(); checks.push({ name, result: 'PASS' }); console.log(`PASS: ${name}`); }
  catch (e) { checks.push({ name, result: 'FAIL', error: e.stack }); console.log(`FAIL: ${name}: ${e.message}`); }
}
function ack(n, type, id, payload) { const r = n.request(type, id, payload); assert.equal(r.accepted, true); return r; }
function noActionsAfter(n, from) { assert.ok(n.outputRecords.slice(from).every(r => r.intent === 'STOPPED')); }
const completions = [];
test('USART model regression: pending RXC survives an unrelated UDRIE update', () => {
  const stock = new CPU(new Uint16Array(16384), 0x800);
  const uart = new AVRUSART(stock, usart0Config, 16000000);
  stock.writeData(usart0Config.UCSRB, 0x90);
  uart.writeByte(0x73, true);
  assert.ok(stock.data[usart0Config.UCSRA] & 0x80);
  stock.writeData(usart0Config.UCSRB, 0xb0);
  assert.equal(stock.data[usart0Config.UCSRA] & 0x80, 0, 'Reproduce installed 0.21.1 model limitation');
  const fixed = new CPU(new Uint16Array(16384), 0x800);
  const fixedUart = new AVRUSART(fixed, usart0Config, 16000000);
  const repairs = preservePendingReceive(fixed, usart0Config);
  fixed.writeData(usart0Config.UCSRB, 0x90); fixedUart.writeByte(0x73, true);
  fixed.writeData(usart0Config.UCSRB, 0xb0);
  assert.ok(fixed.data[usart0Config.UCSRA] & 0x80);
  assert.equal(fixed.readData(usart0Config.UDR), 0x73);
  assert.equal(repairs.length, 1);
});
for (const mode of ['WIND', 'WAVE', 'BUBBLE']) {
  test(`${mode}: select, start, complete once, stay stopped`, () => {
    const n = new VirtualNano(mode);
    const identity = ack(n, 'IDENTIFY', 'identify', { protocol: 2 });
    assert.equal(identity.hardwareOutputsEnabled, false);
    assert.equal(n.intent, 'STOPPED');
    n.start(mode, `run${mode}`);
    n.runWithHeartbeat(EXPERIENCE_DEFINITIONS[mode].totalDurationMs + 600);
    const status = n.request('STATUS_QUERY', 'final');
    assert.equal(status.snapshot.state, 'COMPLETED'); assert.equal(n.intent, 'STOPPED');
    const expected = EXPERIENCE_DEFINITIONS[mode].timeline.filter(e => e.kind === 'ACTION');
    const actual = n.frames.filter(f => f.message.name === 'ACTUATOR_EVENT').map(f => f.message);
    assert.deepEqual(actual.map(e => [e.atMs, e.action, e.durationMs]), expected.map(e => [e.atMs, e.action, e.durationMs]));
    const intentions = n.outputRecords.filter(r => r.intent !== 'STOPPED');
    assert.deepEqual(intentions.map(r => r.intent), expected.map(e => e.action === 'INFLATE' ? 'INFLATING' : 'DEFLATING'));
    assert.equal(n.frames.filter(f => f.message.name === 'COMPLETED').length, 1);
    const stopped = n.outputRecords.at(-1);
    const timing = intentions.map((r, i) => ({ actionIndex: i, nominalMs: expected[i].atMs,
      actualMs: r.recordedAtMs - intentions[0].recordedAtMs,
      latenessMs: r.recordedAtMs - intentions[0].recordedAtMs - expected[i].atMs }));
    assert.ok(timing.every(t => Math.abs(t.latenessMs) <= 2), 'Logical action deadline missed by more than 2 ms under heartbeats');
    assert.ok(Math.abs(stopped.recordedAtMs - intentions[0].recordedAtMs - EXPERIENCE_DEFINITIONS[mode].totalDurationMs) <= 2,
      'Logical completion deadline missed by more than 2 ms');
    completions.push({ mode, nominalMs: EXPERIENCE_DEFINITIONS[mode].totalDurationMs,
      recordedCompletionMs: stopped.recordedAtMs - intentions[0].recordedAtMs,
      virtualCpuDurationMs: stopped.virtualMs - intentions[0].virtualMs, timing });
    const count = n.outputRecords.length; n.advance(1000); assert.equal(n.outputRecords.length, count);
    assert.equal(n.request('START', 'noauto', { operationId: 'new' }).code, 'INVALID_STATE');
    if (mode === 'BUBBLE') {
      assert.equal(intentions.length, 31);
      assert.deepEqual(intentions.slice(0, 2).map(r => r.intent), ['INFLATING', 'INFLATING']);
      assert.ok(intentions[1].recordedAtMs - intentions[0].recordedAtMs >= 4420);
      n.start('BUBBLE', 'repeatB', 'r');
      n.runWithHeartbeat(28000);
      assert.equal(n.state, 'COMPLETED'); assert.equal(n.intent, 'STOPPED');
      assert.equal(n.frames.filter(f => f.message.name === 'COMPLETED').length, 2);
      const repeat = n.frames.filter(f => f.message.name === 'ACTUATOR_EVENT' && f.message.operationId === 'repeatB').map(f => f.message);
      assert.deepEqual(repeat.map(e => [e.atMs, e.action, e.durationMs]), expected.map(e => [e.atMs, e.action, e.durationMs]));
    }
    evidence.push(n.evidence());
  });
}
test('STOP before START and invalid requests cannot actuate', () => {
  const n = new VirtualNano('idle-invalid');
  assert.equal(n.request('STOP', 'stop', { operationId: 'none' }).code, 'INVALID_STATE');
  assert.equal(n.request('START', 'start', { operationId: 'none' }).code, 'NO_EXPERIENCE_SELECTED');
  assert.equal(n.request('SELECT', 'select', { experienceId: 'BAD' }).code, 'UNKNOWN_EXPERIENCE');
  const from = n.frames.length; n.raw('{bad json');
  n.waitFor(() => n.frames.slice(from).some(f => f.message.code === 'INVALID_SCHEMA'));
  assert.equal(n.intent, 'STOPPED'); assert.equal(n.state, 'IDLE');
  noActionsAfter(n, 0); evidence.push(n.evidence());
});
test('STOP cancels every future action; switching modes requires explicit START', () => {
  const n = new VirtualNano('stop-and-switch'); n.start('BUBBLE', 'cancel'); n.advance(400);
  const before = n.outputRecords.length;
  assert.equal(ack(n, 'STOP', 'stop', { operationId: 'cancel' }).state, 'STOPPING');
  n.waitFor(() => n.frames.some(f => f.message.name === 'STOPPED'));
  assert.equal(n.intent, 'STOPPED'); assert.equal(n.state, 'IDLE');
  n.advance(28000); noActionsAfter(n, before);
  assert.equal(n.frames.filter(f => f.message.name === 'COMPLETED').length, 0);
  ack(n, 'SELECT', 'wave', { experienceId: 'WAVE' }); n.advance(500);
  noActionsAfter(n, before); assert.equal(n.state, 'IDLE');
  ack(n, 'START', 'waveStart', { operationId: 'switch' }); n.waitFor(() => n.intent === 'INFLATING');
  ack(n, 'STOP', 'waveStop', { operationId: 'switch' }); n.waitFor(() => n.state === 'IDLE');
  evidence.push(n.evidence());
});
test('duplicate and conflicting commands do not add actuator actions', () => {
  const n = new VirtualNano('duplicates'); n.start('WIND', 'dup');
  const before = n.outputRecords.length;
  assert.equal(ack(n, 'START', 'sstart', { operationId: 'dup' }).state, 'RUNNING');
  assert.equal(n.request('START', 'sstart', { operationId: 'other' }).code, 'REQUEST_ID_REUSED');
  assert.equal(n.request('SELECT', 'busy', { experienceId: 'WAVE' }).code, 'INVALID_STATE');
  assert.equal(n.request('STOP', 'wrong', { operationId: 'other' }).code, 'OPERATION_MISMATCH');
  assert.equal(n.outputRecords.length, before);
  ack(n, 'STOP', 'stop', { operationId: 'dup' }); n.waitFor(() => n.state === 'IDLE');
  const stoppedCount = n.outputRecords.length;
  ack(n, 'STOP', 'stop', { operationId: 'dup' }); assert.equal(n.outputRecords.length, stoppedCount);
  assert.equal(n.request('START', 'reuse', { operationId: 'dup' }).code, 'OPERATION_ID_REUSED');
  evidence.push(n.evidence());
});
test('host protocol silence faults, cancels, and requires explicit RECOVER', () => {
  const n = new VirtualNano('host-timeout'); n.start('WIND', 'timeout');
  n.advance(5600); assert.equal(n.state, 'FAULT'); assert.equal(n.intent, 'STOPPED');
  const first = n.outputRecords.find(r => r.intent === 'INFLATING'), stop = n.outputRecords.at(-1);
  assert.ok(stop.recordedAtMs - first.recordedAtMs >= 5000 && stop.recordedAtMs - first.recordedAtMs < 5010);
  const count = n.outputRecords.length; n.advance(3000); noActionsAfter(n, count);
  const status = n.request('STATUS_QUERY', 'status'); assert.equal(status.snapshot.faultCode, 'HOST_TIMEOUT');
  assert.equal(n.request('START', 'blocked', { operationId: 'blocked' }).code, 'INVALID_STATE');
  ack(n, 'RECOVER', 'recover'); assert.equal(n.intent, 'STOPPED'); assert.equal(n.state, 'IDLE');
  assert.equal(n.request('START', 'noSelect', { operationId: 'new' }).code, 'NO_EXPERIENCE_SELECTED');
  n.advance(1000); noActionsAfter(n, count);
  evidence.push(n.evidence());
});
test('invalid traffic does not keep a running host lease alive', () => {
  const n = new VirtualNano('invalid-traffic'); n.start('WAVE', 'noise');
  for (let i = 0; i < 6; i++) { n.advance(850); n.request('NOPE', `bad${i}`); }
  assert.equal(n.state, 'FAULT'); assert.equal(n.intent, 'STOPPED');
  assert.equal(n.request('STATUS_QUERY', 'status').snapshot.faultCode, 'HOST_TIMEOUT');
  evidence.push(n.evidence());
});
test('simulated actuator fault stops immediately; recovery cannot resume old work', () => {
  const n = new VirtualNano('actuator-fault'); n.start('WAVE', 'fault'); n.advance(300);
  // Explicit test-only SRAM injection; not a protocol command or physical fault.
  n.cpu.data[address('ActuatorSimulation::faultLatched')] = 1;
  const injectedAt = n.now; n.advance(5);
  n.injectedFault = { kind: 'virtual SRAM faultLatched=true', virtualMs: injectedAt,
    stopLatencyMs: n.outputRecords.at(-1).virtualMs - injectedAt };
  assert.equal(n.state, 'FAULT'); assert.equal(n.intent, 'STOPPED');
  assert.ok(n.outputRecords.at(-1).virtualMs - injectedAt < 1);
  assert.equal(n.request('STATUS_QUERY', 'faultStatus').snapshot.faultCode, 'ACTUATOR_FAULT');
  assert.equal(n.request('SELECT', 'blocked', { experienceId: 'BUBBLE' }).code, 'INVALID_STATE');
  const count = n.outputRecords.length; n.advance(1000); noActionsAfter(n, count);
  ack(n, 'RECOVER', 'recover'); assert.equal(n.state, 'IDLE'); assert.equal(n.intent, 'STOPPED');
  const status = n.request('STATUS_QUERY', 'reset');
  assert.equal(status.snapshot.selectedExperienceId, null); assert.equal(status.snapshot.operationId, null);
  assert.equal(status.snapshot.faultCode, null);
  n.start('BUBBLE', 'op12345678901234', 'new'); n.waitFor(() => n.intent === 'INFLATING');
  // Send immediately after START, with a >64-byte request (the Nano RX buffer).
  ack(n, 'STOP', 'stop123456789012', { operationId: 'op12345678901234' }); n.waitFor(() => n.state === 'IDLE');
  evidence.push(n.evidence());
});
test('all original sketches, timelines and previous validation evidence preserved', () => {
  for (const [path, expected] of Object.entries(before)) assert.equal(sha(readFileSync(join(root, path))), expected, path);
});
const result = { result: checks.every(c => c.result === 'PASS') ? 'PASS' : 'FAIL', startedAtUtc, caseFilter: process.env.UNIFIED_CASE || null,
  method: 'Actual unified Arduino CLI HEX executed in AVR8js with virtual USART input; no physical COM or upload. Fault injection is explicitly virtual SRAM mutation.',
  usartModel: 'AVR8js 0.21.1 with explicit test-side pending-RXC preservation on UCSRB writes; stock full-duplex failure is documented and retained.',
  compileArgs, buildDirectory: build, compileLog, hexSha256: sha(hex),
  firmwareSha256: sha(readFileSync(join(sketch, 'nature_touch_unified.ino'))),
  actuatorHeaderSha256: sha(readFileSync(join(sketch, 'simulated-actuators.h'))),
  protectedFiles: before, completions, checks, evidence };
writeFileSync(join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ result: result.result, checks: checks.length,
  completions: completions.map(({ timing, ...summary }) => ({ ...summary,
    maxActionLatenessMs: Math.max(...timing.map(t => t.latenessMs)) })), output }, null, 2));
process.exitCode = result.result === 'PASS' ? 0 : 1;
