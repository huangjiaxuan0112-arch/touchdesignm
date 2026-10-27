// Executes the unmodified compiled sketch. No host serial APIs or actuator model.
import { CPU, avrInstruction, AVRTimer, timer0Config, timer1Config, timer2Config,
  AVRIOPort, portBConfig, portCConfig, portDConfig, AVRUSART, usart0Config } from 'avr8js';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modes, sourceActions } from './modes.mjs';
import { EXPERIENCE_DEFINITIONS } from '../../desktop/shared/experience-definitions.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const mode = (process.argv[2] || 'WIND').toUpperCase();
const config = modes[mode];
if (!config) throw Error(`Unknown mode: ${mode}. Use WIND, WAVE or BUBBLE.`);
const sketch = join(root, config.sketch);
const sketchName = basename(sketch);
const source = readFileSync(sketch);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const sourceHash = hash(source);
const cli = process.env.ARDUINO_CLI || join(homedir(), 'AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe');
const libraries = process.env.ARDUINO_LIBRARIES || join(homedir(), 'AppData/Local/Arduino15/libraries');
const build = mkdtempSync(join(tmpdir(), `nature-touch-${mode.toLowerCase()}-avr8js-`));
const output = resolve(process.env.AVR_RESULTS_ROOT || join(here, 'results-step3'), mode.toLowerCase());
mkdirSync(output, { recursive: true });
const startedAtUtc = new Date().toISOString();
// A failed compile must not leave a previous PASS looking like the current run.
writeFileSync(join(output, 'results.json'), JSON.stringify({ result: 'INCOMPLETE', startedAtUtc }) + '\n');
const fqbn = 'arduino:avr:nano:cpu=atmega328';
const compileArgs = ['compile', '--fqbn', fqbn, '--libraries', libraries, '--build-path', build, dirname(sketch)];
const cliVersion = execFileSync(cli, ['version'], { encoding: 'utf8' }).trim();
let compileLog;
try {
  compileLog = execFileSync(cli, compileArgs, { encoding: 'utf8', timeout: 180000, maxBuffer: 8e6 });
} catch (error) {
  writeFileSync(join(output, 'compile.log'), `${error.stdout || ''}\n${error.stderr || ''}`);
  throw error;
}
writeFileSync(join(output, 'compile.log'), compileLog);
console.log(compileLog);
const hex = readFileSync(join(build, `${sketchName}.hex`), 'utf8');
// ELF symbols provide read-only PC probes into the *executed* helper/ISR code.
const gccRoot = join(homedir(), 'AppData/Local/Arduino15/packages/arduino/tools/avr-gcc');
const nm = process.env.AVR_NM || join(gccRoot, readdirSync(gccRoot).sort().at(-1), 'bin/avr-nm.exe');
const symbols = execFileSync(nm, ['--demangle', '--numeric-sort', join(build, `${sketchName}.elf`)], { encoding: 'utf8' });
writeFileSync(join(output, 'symbols.txt'), symbols);
function symbol(name) {
  const row = symbols.split(/\r?\n/).find(line => line.trim().endsWith(` ${name}`));
  if (!row) throw Error(`ELF symbol missing: ${name}`);
  return parseInt(row.trim().split(/\s+/)[0], 16);
}
const inflatePC = symbol('inflate(unsigned long)') / 2;
const deflatePC = symbol('deflate(unsigned long)') / 2;
const timer1PC = symbol('__vector_11') / 2;
const channelAddress = symbol('Channel') - 0x800000;

// Intel HEX loader: validate checksums, addresses, EOF and flash bounds.
function loadHex(text) {
  const flash = new Uint8Array(32768).fill(0xff);
  let base = 0, eof = false, loaded = 0;
  for (const line of text.trim().split(/\r?\n/)) {
    if (eof || !/^:(?:[0-9a-f]{2})+$/i.test(line)) throw Error('Invalid HEX record');
    const bytes = [...Buffer.from(line.slice(1), 'hex')];
    const [size, hi, lo, type] = bytes;
    if (bytes.length !== size + 5 || (bytes.reduce((a, b) => a + b, 0) & 255)) throw Error('HEX checksum/length');
    const data = bytes.slice(4, 4 + size);
    const address = base + (hi << 8) + lo;
    if (type === 0) {
      if (address + size > flash.length) throw Error('HEX exceeds ATmega328P flash');
      flash.set(data, address); loaded += size;
    } else if (type === 1) eof = true;
    else if (type === 2) base = ((data[0] << 8) | data[1]) * 16;
    else if (type === 4) base = ((data[0] << 8) | data[1]) * 65536;
    else if (type !== 3 && type !== 5) throw Error(`Unsupported HEX record ${type}`);
  }
  if (!eof || !loaded) throw Error('Missing HEX program/EOF');
  return { flash: new Uint16Array(flash.buffer), loaded };
}
const image = loadHex(hex);
const hz = 16000000;
const cpu = new CPU(image.flash, 0x800);
new AVRIOPort(cpu, portBConfig);
new AVRIOPort(cpu, portCConfig);
const portD = new AVRIOPort(cpu, portDConfig);
new AVRTimer(cpu, timer0Config); // Arduino millis/micros/delay
new AVRTimer(cpu, timer1Config); // Servo ISR, normal mode, prescaler 8
new AVRTimer(cpu, timer2Config);
const uart = new AVRUSART(cpu, usart0Config, hz); // virtual UART only; no host serial
const serial = [];
let line = '';
uart.onByteTransmit = (byte) => {
  if (byte === 10) { serial.push({ cycle: cpu.cycles, timeMs: cpu.cycles / 16000, text: line.trim() }); line = ''; }
  else line += String.fromCharCode(byte);
};
const edges = [];
const pulses = { D5: [], D6: [], D7: [] };
const starts = {};
portD.addListener((value, old) => {
  for (const pin of [5, 6, 7]) {
    const mask = 1 << pin;
    if (!((value ^ old) & mask)) continue;
    const name = `D${pin}`, cycle = cpu.cycles, high = Boolean(value & mask);
    edges.push({ pin: name, cycle, high });
    if (high) starts[name] = cycle;
    else if (starts[name] !== undefined) {
      pulses[name].push({ riseCycle: starts[name], fallCycle: cycle, widthUs: (cycle - starts[name]) / 16 });
      delete starts[name];
    }
  }
});
const virtualSecondsTarget = config.nominalMs / 1000 + 0.3;
console.log(`${mode}: executing ${virtualSecondsTarget.toFixed(2)} virtual seconds at 16 MHz (no skipped delay loops)...`);
let instructions = 0;
const commands = [], firstTimer1Interrupts = [];
const started = Date.now();
while (cpu.cycles < hz * virtualSecondsTarget) {
  if (cpu.pc === inflatePC || cpu.pc === deflatePC) {
    commands.push({ phase: commands.length, command: cpu.pc === inflatePC ? 'inflate' : 'deflate',
      timeMs: cpu.cycles / 16000, cycle: cpu.cycles,
      requestedDelayMs: cpu.dataView.getUint32(22, true) });
  }
  if (cpu.pc === timer1PC && firstTimer1Interrupts.length < 10) {
    firstTimer1Interrupts.push({ cycle: cpu.cycles, timeMs: cpu.cycles / 16000,
      channelBeforeISR: cpu.data[channelAddress] << 24 >> 24 });
  }
  avrInstruction(cpu);
  cpu.tick();
  instructions++;
}
const wallSeconds = (Date.now() - started) / 1000;
const checks = [];
const check = (name, pass, detail) => checks.push({ name, result: pass ? 'PASS' : 'FAIL', detail });
const unifiedPath = join(root, 'firmware/unified/nature_touch_unified/experience-timelines.h');
const unified = readFileSync(unifiedPath, 'utf8');
const array = unified.match(new RegExp(`${mode}_ACTIONS\\[\\].*?\\{([\\s\\S]*?)\\};`));
if (!array) throw Error(`Missing ${mode} timeline`);
const actions = [...array[1].matchAll(/\{\s*(\d+),\s*([01])\s*\}/g)].map(m => [Number(m[1]), Number(m[2])]);
const durations = actions.map(a => a[0]);
const actionCount = actions.length;
const expectedCommands = [...actions, actions[0]];
const loopToleranceMs = mode === 'BUBBLE' ? actionCount * 0.5 : 5;
const offsets = [0];
for (const duration of durations) offsets.push(offsets.at(-1) + duration);
check('executed helper commands and delays', commands.length === expectedCommands.length && commands.every((c, i) =>
  c.command === (expectedCommands[i][1] ? 'inflate' : 'deflate') && c.requestedDelayMs === expectedCommands[i][0]),
  'ELF-resolved function-entry PC and AVR r22-r25 argument capture; no source-level timeline drives the CPU.');
const measuredLoopMs = commands[actionCount]?.timeMs - commands[0]?.timeMs;
check(`executed ${config.nominalMs / 1000}-second loop`, Number.isFinite(measuredLoopMs) && Math.abs(measuredLoopMs - config.nominalMs) < loopToleranceMs,
  `Measured helper-entry loop interval ${measuredLoopMs} ms (±${loopToleranceMs} ms tolerance).`);
const originalWindDurations = [5000, 1500, 1300, 1450, 1050, 1900, 1600, 1750, 1450, 1050, 950, 5000];
check(`unified ${mode} nominal timeline`, offsets.at(-1) === config.nominalMs && (mode !== 'WIND' ||
  JSON.stringify(actions) === JSON.stringify(originalWindDurations.map((d, i) => [d, +(i % 2 === 0)]))),
  'Read-only comparison; unified firmware is not executed or modified.');
const calls = sourceActions(source.toString(), mode);
check('legacy helper sequence', JSON.stringify(calls) === JSON.stringify(actions), `Original source matches all ${actionCount} expected ${mode} actions, including same-direction calls.`);
const desktopActions = EXPERIENCE_DEFINITIONS[mode].timeline.filter(e => e.kind === 'ACTION').map(e => [e.durationMs, +(e.action === 'INFLATE')]);
check('existing desktop timeline', JSON.stringify(actions) === JSON.stringify(desktopActions) && EXPERIENCE_DEFINITIONS[mode].totalDurationMs === config.nominalMs,
  'Compare with existing desktop/shared/experience-definitions.ts as well as unified header. Neither drives the CPU.');
const actionObservations = commands.map((c, i) => ({ ...c, expectedMs: offsets[i], errorMs: c.timeMs - offsets[i],
  observedDurationMs: commands[i + 1] ? commands[i + 1].timeMs - c.timeMs : null,
  durationErrorMs: commands[i + 1] ? commands[i + 1].timeMs - c.timeMs - c.requestedDelayMs : null,
  continuesPreviousDirection: i > 0 && c.command === commands[i - 1].command }));
check('each executed action duration', commands.length === expectedCommands.length && actionObservations.slice(0, actionCount).every(c =>
  c.durationErrorMs >= -0.1 && c.durationErrorMs <= 1), 'Every action, including BUBBLE consecutive inflation: measured helper interval versus requested delay (-0.1 to +1 ms).');
// A repeated same-direction helper call is an action, but not a GPIO class change.
const expectedChanges = expectedCommands.map((a, i) => ({ actionIndex: i, inflate: a[1] }))
  .filter((a, i) => i === 0 || a.inflate !== expectedCommands[i - 1][1]);
const stats = (values) => values.length ? { count: values.length, min: Math.min(...values), max: Math.max(...values), mean: values.reduce((a, b) => a + b, 0) / values.length } : { count: 0 };
const summaries = {};
const transitions = {};
for (const pin of Object.keys(pulses)) {
  const list = pulses[pin];
  const classify = p => Math.abs(p.widthUs - 544) <= 12 ? 'short' : Math.abs(p.widthUs - 2400) <= 12 ? 'long' : 'other';
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    p.kind = classify(p);
    p.riseMs = p.riseCycle / 16000;
    p.periodUs = i ? (p.riseCycle - list[i - 1].riseCycle) / 16 : null;
  }
  const steady = list.filter(p => p.riseMs > 100);
  check(`${pin} pulse widths`, steady.length > 1000 && steady.every(p => p.kind !== 'other'), 'Every pulse after startup must be 544 or 2400 us within ±12 us; tolerates ISR/digitalWrite latency.');
  const changes = list.filter((p, i) => p.kind !== 'other' && (i === 0 || p.kind !== list[i - 1].kind));
  transitions[pin] = changes.map((p, i) => {
    const actionIndex = expectedChanges[i]?.actionIndex;
    return { phase: i, actionIndex, expectedMs: offsets[actionIndex], observedRiseMs: p.riseMs, widthUs: p.widthUs, kind: p.kind, errorMs: p.riseMs - offsets[actionIndex],
      commandMs: commands[actionIndex]?.timeMs, commandToPulseMs: p.riseMs - (commands[actionIndex]?.timeMs ?? NaN),
      observedDurationMs: changes[i + 1] ? changes[i + 1].riseMs - p.riseMs : null };
  });
  const expectedKind = inflate => (pin === 'D7' ? !inflate : Boolean(inflate)) ? 'long' : 'short';
  check(`${pin} full sequence and repeat`, changes.length === expectedChanges.length && changes.every((p, i) => p.kind === expectedKind(expectedChanges[i].inflate)),
    `${expectedChanges.length} actual pulse-class states including next cycle; same-direction calls retained in actionObservations, not invented as edges.`);
  check(`${pin} startup observed separately`, changes.length > 0 && changes[0].riseMs < 75,
    'Startup bound 75 ms: Timer1 zero-compare first wrap (32.768 ms) plus refresh (20 ms) and setup margin. Startup is not a steady frame. See initial-validation.json for the rejected 50 ms assumption.');
  check(`${pin} phase timing`, changes.length === expectedChanges.length && transitions[pin].slice(1).every(t => {
    return Math.abs(t.errorMs) <= 30 && t.commandToPulseMs >= 0 && t.commandToPulseMs < 25;
  }), 'After startup: first pulse within 30 ms of nominal boot-relative offset and 0–25 ms after actual executed helper entry (frame plus serialized channel offsets).');
  const perAction = commands.slice(0, actionCount).map((c, i) => {
    const samples = list.filter(p => p.riseMs >= c.timeMs + 75 && p.riseMs < commands[i + 1]?.timeMs);
    return { actionIndex: i, sampleCount: samples.length, expectedKind: expectedKind(expectedCommands[i][1]),
      allMatch: samples.length > 0 && samples.every(p => p.kind === expectedKind(expectedCommands[i][1])) };
  });
  check(`${pin} every action has actual waveform`, perAction.length === actionCount && perAction.every(a => a.allMatch),
    'Each action has matching captured pulses after a 75 ms settling window, including repeated same-direction BUBBLE inflation. No synthetic transition added.');
  const stablePeriods = list.filter(p => p.periodUs !== null && p.riseMs > 100 && offsets.every(t => Math.abs(p.riseMs - t) > 60)).map(p => p.periodUs);
  check(`${pin} steady repetition`, stablePeriods.length > 900 && stablePeriods.every(t => Math.abs(t - 20000) <= 30), 'Away from phase changes: 20000 us ±30 us. Serialized channel offsets can change intervals at transitions.');
  summaries[pin] = {
    pulseCount: list.length,
    shortWidthUs: stats(steady.filter(p => p.kind === 'short').map(p => p.widthUs)),
    longWidthUs: stats(steady.filter(p => p.kind === 'long').map(p => p.widthUs)),
    steadyPeriodUs: stats(stablePeriods),
    allPeriodUs: stats(list.filter(p => p.periodUs !== null).map(p => p.periodUs)),
    firstPulses: list.slice(0, 4),
    startupOtherPulses: list.filter(p => p.riseMs <= 100 && p.kind === 'other'),
    perAction,
  };
}
check('virtual UART continued across loop boundary', config.cues.every(text => serial.some(s => s.text === text)) &&
  (!config.repeatCue || serial.filter(s => s.text === config.repeatCue).length >= 2),
  'Virtual USART output, not a physical serial connection. BUBBLE next-loop execution is proved by helper PC/GPIO; its next PLAY cue is later than capture.');
check('original sketch unchanged', hash(readFileSync(sketch)) === sourceHash, sourceHash);
const edgeCsv = 'pin,cycle,time_us,level\n' + edges.map(e => `${e.pin},${e.cycle},${e.cycle / 16},${+e.high}`).join('\n') + '\n';
const pulseCsv = 'pin,rise_cycle,fall_cycle,rise_ms,width_us,period_us,kind\n' + Object.entries(pulses).flatMap(([pin, list]) => list.map(p => `${pin},${p.riseCycle},${p.fallCycle},${p.riseMs},${p.widthUs},${p.periodUs ?? ''},${p.kind}`)).join('\n') + '\n';
if (mode === 'WIND') {
  const old = JSON.parse(readFileSync(join(here, 'results/results.json')));
  check('all original 21 WIND checks retained', old.checks.length === 21 && old.checks.every(c => checks.some(n => n.name === c.name && n.result === c.result)),
    'All Step 2 assertion categories and their passing results remain, with the same timing tolerances.');
  check('WIND Step 2 waveform regression', old.hexSha256 === hash(hex) && old.virtualCycles === cpu.cycles && old.instructions === instructions &&
    hash(readFileSync(join(here, 'results/edges.csv'))) === hash(edgeCsv) && hash(readFileSync(join(here, 'results/pulses.csv'))) === hash(pulseCsv),
    'Recompiled HEX hash, cycles, instruction count, every GPIO edge and every complete pulse must exactly match preserved Step 2 evidence.');
}
const avrPackage = JSON.parse(readFileSync(join(here, 'node_modules/avr8js/package.json')));
const result = {
  result: checks.every(c => c.result === 'PASS') ? 'PASS' : 'FAIL',
  measurementMethod: 'Actual AVR instruction execution of Arduino CLI-produced HEX; GPIO listeners timestamp CPU cycles. No scripted waveform or delay fast-forward.',
  startedAtUtc, fqbn, frequencyHz: hz, cliVersion, avr8jsVersion: avrPackage.version, nodeVersion: process.version,
  mode, nominalMs: config.nominalMs, measuredLoopMs, actions, actionObservations,
  sourceRelativePath: config.sketch, sourceSha256: sourceHash,
  hexSha256: hash(hex), loadedFlashBytes: image.loaded, buildDirectory: build,
  compileArgs, virtualCycles: cpu.cycles, instructions, virtualSeconds: cpu.cycles / hz, wallSeconds,
  thresholds: { pulseUs: 12, steadyPeriodUs: 30, startupMs: 75, phaseMs: 30, commandToPulseMs: 25, loopMs: loopToleranceMs, actionDurationMs: [-0.1, 1] },
  commands, firstTimer1Interrupts, summaries, transitions, serial, checks,
  finalRegisters: { TCCR0A: cpu.data[0x44], TCCR0B: cpu.data[0x45], TIMSK0: cpu.data[0x6e],
    TCCR1A: cpu.data[0x80], TCCR1B: cpu.data[0x81], TIMSK1: cpu.data[0x6f], DDRD: cpu.data[0x2a] },
};
writeFileSync(join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
writeFileSync(join(output, 'edges.csv'), edgeCsv);
writeFileSync(join(output, 'pulses.csv'), pulseCsv);
writeFileSync(join(output, `${mode.toLowerCase()}.hex.txt`), hex); // retain exact executed image despite global *.hex ignore
for (const c of checks) console.log(`${c.result}: ${c.name}`);
console.log(JSON.stringify({ result: result.result, virtualSeconds: result.virtualSeconds, instructions, wallSeconds, output }, null, 2));
process.exitCode = result.result === 'PASS' ? 0 : 1;
