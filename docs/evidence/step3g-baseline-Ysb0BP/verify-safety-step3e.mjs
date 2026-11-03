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
const invalid = spawnSync(cli, ['--config-file', config, 'compile', '--fqbn', fqbn, '--build-path', join(temporary, 'invalid'),
  '--build-property', 'compiler.cpp.extra_flags=-DNATURE_TOUCH_ACTUATOR_DRIVER=1', sketch], { encoding: 'utf8', timeout: 180000 });
writeFileSync(join(out, 'real-selection-rejected.log'), invalid.stdout + invalid.stderr);
assert.notEqual(invalid.status, 0);
assert.match(invalid.stderr, /Real actuator driver BLOCKED/);

const probe = join(temporary, 'blocked_probe'); mkdirSync(probe);
copyFileSync(join(sketch, 'real-actuators.h'), join(probe, 'real-actuators.h'));
writeFileSync(join(probe, 'blocked_probe.ino'), `#include "real-actuators.h"
volatile uint8_t probeResult = 0;
static_assert(RealActuators::VALVE_OFF.servoValue == 0 && !RealActuators::VALVE_OFF.verified, "D5 seller-documented OFF candidate must remain physically unverified");
static_assert(RealActuators::SUCTION_OFF.servoValue == 0 && !RealActuators::SUCTION_OFF.verified, "D6 seller-documented OFF candidate must remain physically unverified");
static_assert(RealActuators::INFLATION_OFF.servoValue == 0 && !RealActuators::INFLATION_OFF.verified, "D7 seller-documented OFF candidate must remain physically unverified");
static_assert(!RealActuators::PHYSICAL_OUTPUTS_PERMITTED, "Hard lock required");
static_assert(!RealActuators::D7_ACTIVATION_REVIEWED && !RealActuators::D5_D6_OUTPUTS_PERMITTED, "D7 activation and D5/D6 remain locked");
static_assert(RealActuators::D7_MAPPING_VERIFIED && RealActuators::D7_OFF_US == 1200 && RealActuators::D7_ON_US == 1800, "D7 uses measured microsecond values, never legacy angles");
static_assert(RealActuators::INFLATE.valve == 0 && RealActuators::INFLATE.suction == 0 && RealActuators::INFLATE.inflation == 180, "Documented pump labels must map inflation to D7 ON");
static_assert(RealActuators::DEFLATE.valve == 180 && RealActuators::DEFLATE.suction == 180 && RealActuators::DEFLATE.inflation == 0, "Documented pump labels must map deflation to D6 ON");
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
  'real selector fails compilation', 'seller-documented OFF candidates remain physically unverified and activation stays locked',
  'D7 mapping is verified 1200/1800 microseconds; legacy angle tuples are unused; D5/D6 remain locked',
  'blocked scaffold rejects all operations including fault-flag clearing', 'D5/D6/D7 never output or transition',
], method: 'Actual separately compiled blocked scaffold executed in AVR8js for 100 ms; Servo library present, no physical USB/COM.',
  virtualMs: cpu.cycles / 16000, outputModes, edges, compileLog: log }, null, 2) + '\n');
console.log('PASS: 4 driver safety checks; no GPIO output/edges');
