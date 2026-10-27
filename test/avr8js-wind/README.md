# Original WIND / WAVE / BUBBLE: headless AVR8js execution

This isolated Node project reuses the Step 2 CPU, peripherals, HEX loader and GPIO
capture to execute each **unmodified original sketch** at 16 MHz. It does not open
COM ports, upload firmware, or simulate loads. Unified production firmware is read
for timeline comparison only and remains simulation-only. No dependency was added
for Step 3.

## Rerun on this Windows machine

From the repository root:

```powershell
Set-Location .\test\avr8js-wind
npm ci --ignore-scripts --no-audit --no-fund
npm test
# Individual modes and all three modes:
npm run test:wave
npm run test:bubble
npm run test:all
```

Use the existing Node 24 runtime: Step 3 also reads the existing desktop TypeScript
timeline using Node's native type stripping. Only `avr8js` is installed, pinned by
`package-lock.json`; there are no other packages or install scripts. The existing
Arduino CLI, Arduino AVR core 1.8.8, Servo 1.3.0, and AVR compiler are prerequisites.
No Arduino packages are downloaded by the test. On this machine the npm executable
is `C:\Program Files\nodejs\npm.cmd` if it is not on PATH.

Defaults locate Arduino CLI inside `%LOCALAPPDATA%\Programs\Arduino IDE` and
libraries/tools inside `%USERPROFILE%\AppData\Local\Arduino15`. To use another
existing installation, set environment variables before `npm test`:

```powershell
$env:ARDUINO_CLI = 'C:\path\to\arduino-cli.exe'
$env:ARDUINO_LIBRARIES = 'C:\path\to\libraries'
$env:AVR_NM = 'C:\path\to\avr-nm.exe'
# Optional: choose another root for fresh per-mode evidence.
$env:AVR_RESULTS_ROOT = 'C:\path\to\new-results'
npm run test:all
```

The exact compile invocation is recorded as executable plus `compileArgs` in
`results-step3/<mode>/results.json`: `compile --fqbn arduino:avr:nano:cpu=atmega328 --libraries
<existing libraries> --build-path <new temporary directory> <original sketch dir>`.
The test never calls `upload`, `monitor`, `board list`, or a serial transport.
HEX/ELF and intermediate build files remain in a unique Windows temporary folder.

## Evidence and exit codes

Step 2's entire `results/` directory and its report are preserved byte-for-byte.
New runs write to `results-step3/wind/`, `results-step3/wave/` and
`results-step3/bubble/`, never the historical `results/` directory. Filenames below
are relative to each mode's directory:

- `results.json`: PASS/FAIL, provenance, checks, pulse statistics, phase
  transitions, actual helper entry times/arguments, first Timer1 ISRs, virtual UART.
- `edges.csv`: every D5/D6/D7 edge in CPU cycles and microseconds.
- `pulses.csv`: complete pulses, widths, rise-to-rise periods and classes.
- `<mode>.hex.txt`: exact executed Intel HEX, retained as text because the
  repository ignores `*.hex` build products.
- `symbols.txt`, `compile.log`: compiled symbol map and build result.

`results-step3/all-modes.json` aggregates exit codes and checks SHA-256 preservation
against `preservation-baseline.json` for all original sketches, unified firmware,
the Step 2 report and every historical WIND evidence file. WIND also retains all
21 original assertion categories and compares its recompiled HEX, cycles,
instruction count and complete edge/pulse CSVs exactly against Step 2. The original
`results/initial-validation.json` startup failure remains historical evidence.

Exit 0 means all assertions pass. Exit 1 means a failed assertion or execution/build
error. `results.json` starts as INCOMPLETE before compiling so an error does not
leave a previous PASS as the current summary. After an incomplete run, the other
evidence files may still belong to the previous successful run.

## Measurement design

32 KiB flash, 2 KiB SRAM, ports B/C/D, timers 0/1/2 and virtual USART0 are configured.
The instruction loop calls `avrInstruction(cpu)` then `cpu.tick()`; it never
fast-forwards delays or drives pins using an expected timeline. GPIO listeners
capture actual output changes produced by the compiled code. ELF symbols locate
`inflate`, `deflate` and Timer1 ISR instruction addresses. These read-only probes
record execution and the 32-bit delay argument in AVR registers r22–r25.

The expected timeline is used **only after execution**, for assertions. Each
mode's nominal total plus 300 ms sets capture duration (24.30/25.30/27.72 s); it
never generates output. Both the existing unified arrays and desktop definitions
are compared with the actual helper trace and the original source-derived action
sequence. Unified firmware is neither compiled nor executed.

Every helper entry is retained, even BUBBLE's consecutive 4420 ms and 580 ms
inflations. These calls must not be merged or invented as GPIO transitions. Only
the expected list of *pulse-class changes* omits repeated identical directions;
all original actions remain in `actions`, `commands`, `actionObservations` and each
pin's `perAction` evidence. BUBBLE retains integer 45%/55% splitting of all original
intervals before its 20000 ms music cutoff. No resampling occurs.

Pulse tolerance: ±12 us around 544/2400 us; every pulse after 100 ms is checked.
Steady rise-to-rise period tolerance: ±30 us around 20000 us, excluding startup and
60 ms around nominal phase boundaries because Servo channels are serialized.
Phase changes after startup: within 30 ms of nominal boot-relative time and
0–25 ms after the actual helper entry. WIND/WAVE loop intervals must be nominal ±5
ms. BUBBLE allows 0.5 ms per original helper action (31 × 0.5 = 15.5 ms accumulated
budget), because it executes more writes and integer arithmetic. In addition,
**every** completed action's measured helper-entry interval must differ from its
requested delay by -0.1 to +1 ms, and every pin must have matching actual pulses
inside every action after a 75 ms settling window. Startup/phase-boundary edges
are retained even where excluded from steady-period statistics.
Startup is reported separately, with a 75 ms bound motivated by the initial
16-bit Timer1 wrap (32.768 ms) plus 20 ms refresh and setup margin.

See [the results report](../../docs/phase-3b-step2-avr8js-results.md) for measured
values, startup analysis, exact scope of PASS, and physical limitations.
See [the all-modes report](../../docs/phase-3b-step3-all-modes-simulation.md) for
WAVE/BUBBLE results, all action timings, observed issues and next steps.

Node may emit `MODULE_TYPELESS_PACKAGE_JSON` when it reads the existing desktop
TypeScript definitions. This is a module-detection warning; no production package
configuration is changed to suppress it.
