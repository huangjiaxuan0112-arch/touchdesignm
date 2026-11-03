// Compile and execute the blocked scaffold only; never imports serialport/uploads.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(process.env.DRIVER_SAFETY_RESULTS || mkdtempSync(join(root, 'docs/evidence/driver-safety-')));
mkdirSync(out, { recursive: true });
const cli = join(homedir(), 'AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe');
const fqbn = 'arduino:avr:nano:cpu=atmega328';
const sketch = join(root, 'firmware/unified/nature_touch_unified');
const temporary = mkdtempSync(join(tmpdir(), 'nature-touch-driver-safety-'));
const config = join(temporary, 'arduino-cli.yaml');
writeFileSync(config, `directories:\n  data: ${JSON.stringify(join(homedir(), 'AppData/Local/Arduino15'))}\n  user: ${JSON.stringify(temporary)}\n  downloads: ${JSON.stringify(join(temporary, 'downloads'))}\nbuild_cache:\n  path: ${JSON.stringify(join(temporary, 'cache'))}\n`);
const invalid = spawnSync(cli, ['--config-file', config, 'compile', '--fqbn', fqbn,
  '--libraries', join(homedir(), 'AppData/Local/Arduino15/libraries'), '--build-path', join(temporary, 'invalid'),
  '--build-property', 'compiler.cpp.extra_flags=-DNATURE_TOUCH_ACTUATOR_DRIVER=1', sketch], { encoding: 'utf8', timeout: 180000 });
writeFileSync(join(out, 'real-selection-rejected.log'), invalid.stdout + invalid.stderr);
assert.notEqual(invalid.status, 0);
assert.match(invalid.stderr, /Real actuator driver BLOCKED/);

const probe = join(temporary, 'blocked_probe'); mkdirSync(probe);
copyFileSync(join(sketch, 'real-actuators.h'), join(probe, 'real-actuators.h'));
writeFileSync(join(probe, 'blocked_probe.ino'), `#include "real-actuators.h"
volatile uint8_t probeResult = 0;
static_assert(!RealActuators::PHYSICAL_OUTPUTS_PERMITTED, "Hard lock required");
static_assert(!RealActuators::CONFIGURATION_VERIFIED, "Real build must remain blocked by incomplete review");
static_assert(!RealActuators::D7_ACTIVATION_REVIEWED && !RealActuators::D5_D6_OUTPUTS_PERMITTED, "D7 activation and D5/D6 remain locked");
static_assert(RealActuators::D5_MAPPING_VERIFIED && !RealActuators::D6_MAPPING_VERIFIED && RealActuators::D7_MAPPING_VERIFIED, "The new D6 theoretical mapping must remain unverified");
static_assert(RealActuators::D5_OFF_US == 1200 && RealActuators::D5_ON_US == 1800 &&
  RealActuators::D6_OFF_US == 1200 && RealActuators::D6_ON_US == 1800 &&
  RealActuators::D7_OFF_US == 1200 && RealActuators::D7_ON_US == 1800, "Requested theoretical channel mapping required");
static_assert(RealActuators::INFLATE.valveUs == 1800 && RealActuators::INFLATE.suctionUs == 1200 && RealActuators::INFLATE.inflationUs == 1800, "Correct inflation mapping required");
static_assert(RealActuators::DEFLATE.valveUs == 1200 && RealActuators::DEFLATE.suctionUs == 1800 && RealActuators::DEFLATE.inflationUs == 1200, "Correct deflation mapping required");
static_assert(!RealActuators::STOP_VALVE_VERIFIED && RealActuators::STOP_VALVE_US == 1200, "STOP valve selected OFF but still unverified and blocked");
static_assert(RealActuators::PUMP_OFF_SETTLE_MS == 500 && RealActuators::VALVE_SETTLE_MS == 300 &&
  !RealActuators::PUMP_OFF_SETTLE_VERIFIED && !RealActuators::VALVE_SETTLE_VERIFIED,
  "Requested settling assumptions must remain unverified");
void setup() {
  RealActuators::initializeOutputs();
  bool blocked = !RealActuators::inflate() && !RealActuators::deflate();
  RealActuators::stopAll();
  RealActuators::service(millis() + 100000UL);
  blocked = blocked && !RealActuators::inflate() && RealActuators::faultLatched;
  // Clearing a fault flag alone must never unlock initialization/activation.
  RealActuators::faultLatched = false;
  blocked = blocked && !RealActuators::deflate();
  probeResult = blocked ? 0x5a : 0xff;
}
void loop() {}
`);
const build = join(temporary, 'probe-build');
const libraries = join(homedir(), 'AppData/Local/Arduino15/libraries');
const log = execFileSync(cli, ['--config-file', config, 'compile', '--fqbn', fqbn, '--libraries', libraries, '--build-path', build, probe], { encoding: 'utf8', timeout: 180000 });
writeFileSync(join(out, 'blocked-probe-compile.log'), log);
const gcc = join(homedir(), 'AppData/Local/Arduino15/packages/arduino/tools/avr-gcc');
const nm = join(gcc, readdirSync(gcc).sort().at(-1), 'bin/avr-nm.exe');
const symbols = execFileSync(nm, ['--demangle', join(build, 'blocked_probe.ino.elf')], { encoding: 'utf8' });
const resultAddress = parseInt(symbols.match(/^([\da-f]+)\s+\w\s+probeResult$/m)[1], 16) - 0x800000;
const flash = new Uint8Array(32768).fill(255);
const hex = readFileSync(join(build, 'blocked_probe.ino.hex'), 'utf8');
let base = 0;
for (const line of hex.trim().split(/\r?\n/)) {
  const bytes = [...Buffer.from(line.slice(1), 'hex')];
  assert.equal(bytes.reduce((a, b) => a + b, 0) & 255, 0);
  if (bytes[3] === 0) flash.set(bytes.slice(4, 4 + bytes[0]), base + bytes[1] * 256 + bytes[2]);
  if (bytes[3] === 4) base = (bytes[4] * 256 + bytes[5]) * 65536;
}
const require = createRequire(join(root, 'test/avr8js-wind/package.json'));
const { CPU, avrInstruction, AVRIOPort, portBConfig, portCConfig, portDConfig,
  AVRTimer, timer0Config, timer1Config, timer2Config } = require('avr8js');
const cpu = new CPU(new Uint16Array(flash.buffer), 0x800);
new AVRIOPort(cpu, portBConfig); new AVRIOPort(cpu, portCConfig);
const port = new AVRIOPort(cpu, portDConfig);
new AVRTimer(cpu, timer0Config); new AVRTimer(cpu, timer1Config); new AVRTimer(cpu, timer2Config);
const edges = [], outputModes = [];
port.addListener((value, old) => { if ((value ^ old) & 0xe0) edges.push({ cycle: cpu.cycles, value }); });
const originalDDR = cpu.writeHooks[portDConfig.DDR];
cpu.writeHooks[portDConfig.DDR] = (value, old, mask) => {
  if (value & 0xe0) outputModes.push({ cycle: cpu.cycles, value });
  return originalDDR?.(value, old, mask);
};
while (cpu.cycles < 1600000) { avrInstruction(cpu); cpu.tick(); }
assert.equal(cpu.data[resultAddress], 0x5a);
assert.deepEqual(outputModes, []); assert.deepEqual(edges, []);
writeFileSync(join(out, 'results.json'), JSON.stringify({ result: 'PASS', checks: [
  'real selector fails compilation', 'STOP valve, settling times and protection reviews remain unverified and blocked',
  'three-channel measured electrical mappings used without copying legacy combinations; physical locks remain closed',
  'blocked scaffold rejects all operations including fault-flag clearing', 'D5/D6/D7 never output or transition',
], method: 'Actual separately compiled blocked scaffold executed in AVR8js for 100 ms; Servo library present, no physical USB/COM.',
  virtualMs: cpu.cycles / 16000, outputModes, edges, compileLog: log }, null, 2) + '\n');
console.log('PASS: 5 driver safety checks; no GPIO output/edges');
