// Pure offline driver regression. Only a fake Servo implementation is linked.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sketch = join(here, '../../firmware/unified/nature_touch_unified')
const require = createRequire(new URL('../avr8js-wind/package.json', import.meta.url))
const { CPU, avrInstruction } = require('avr8js')
const gccRoot = join(homedir(), 'AppData/Local/Arduino15/packages/arduino/tools/avr-gcc')
const tools = process.env.AVR_NM ? dirname(process.env.AVR_NM) : join(gccRoot, readdirSync(gccRoot).sort().at(-1), 'bin')
const executable = name => join(tools, name + (process.platform === 'win32' ? '.exe' : ''))
const temp = mkdtempSync(join(tmpdir(), 'nature-touch-virtual-actuators-'))

writeFileSync(join(temp, 'Arduino.h'), `#pragma once
#include <stdint.h>
extern uint32_t fixtureMillis;
inline uint32_t millis() { return fixtureMillis; }
`)
writeFileSync(join(temp, 'Servo.h'), `#pragma once
#include <stdint.h>
extern uint16_t fixturePulses[8];
constexpr uint8_t INVALID_SERVO = 255;
class Servo {
  uint8_t pin = INVALID_SERVO;
  uint16_t pulse = 0;
 public:
  uint8_t attach(uint8_t output) {
    pin = output;
    fixturePulses[pin] = pulse;
    return pin;
  }
  void writeMicroseconds(uint16_t value) {
    pulse = value;
    if (pin != INVALID_SERVO) fixturePulses[pin] = pulse;
  }
};
`)
const elf = join(temp, 'actuator-windows.elf')
execFileSync(executable('avr-g++'), [
  '-mmcu=atmega328p', '-std=gnu++11', '-Os', '-I', temp, '-I', sketch,
  join(here, 'actuator-windows.cpp'), '-o', elf,
], { timeout: 30000 })
const binary = join(temp, 'actuator-windows.bin')
execFileSync(executable('avr-objcopy'), ['-O', 'binary', '-R', '.eeprom', elf, binary], { timeout: 30000 })
const symbols = execFileSync(executable('avr-nm'), [elf], { encoding: 'utf8', timeout: 30000 })
const resultSymbol = symbols.match(/^([a-f0-9]+)\s+\w\s+fixtureResult\r?$/m)
assert.ok(resultSymbol)
const resultAddress = Number.parseInt(resultSymbol[1], 16) - 0x800000
const flash = new Uint8Array(32768).fill(255)
flash.set(readFileSync(binary))
const cpu = new CPU(new Uint16Array(flash.buffer), 0x800)
const checks = [
  'WIND timing, pump exclusivity and final OFF',
  'WAVE timing, no pump ON in the 500ms segment, and final OFF',
  'BUBBLE timing, pump exclusivity and final OFF',
  'STOP cancels pending pump-off wait',
  'STOP cancels pending valve wait',
  'FAULT cancels pending pump-off wait',
  'FAULT cancels pending valve wait',
]
while (!cpu.data[resultAddress] && cpu.cycles < 50000000) {
  avrInstruction(cpu)
  cpu.tick()
}
const result = cpu.data[resultAddress]
assert.equal(result, 255, result === 0 ? 'Virtual driver fixture timed out' : checks[result - 1])
console.log(JSON.stringify({ result: 'PASS', checks, physicalIO: false }, null, 2))
