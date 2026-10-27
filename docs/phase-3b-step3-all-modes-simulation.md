# Nature Touch — Phase 3B / Step 3: all original modes in AVR8js

## Actual result

**PASS: WIND, WAVE and BUBBLE**, after compiling and executing each original sketch
in the existing AVR8js harness. Every reported pulse is derived from virtual GPIO
edges produced by AVR instruction execution, not generated from an expected
timeline. The capture includes one complete loop and the start of the next loop
for each mode; it does not claim two complete loops were executed.

| Mode | Assertions | Actual virtual time (s) | Nominal loop (ms) | Measured helper-entry loop (ms) | Difference (ms) |
|---|---:|---:|---:|---:|---:|
| WIND | 28 PASS | 24.3000000625 | 24000 | 24002.3456875 | +2.3456875 |
| WAVE | 26 PASS | 25.3000001250 | 25000 | 25002.0507500 | +2.0507500 |
| BUBBLE | 26 PASS | 27.7200000625 | 27420 | 27425.8932500 | +5.8932500 |

All **80 assertions passed**. The aggregate runner also verified that all 13
protected files retain their recorded SHA-256 hashes. These include all three
original sketches, both unified production firmware files, the Step 2 report and
all seven historical WIND evidence files. No firmware, audio or wiring was changed.
No physical COM access, upload, actuator integration or actuator control occurred.

## Minimal reuse and evidence preservation

The [Step 2 report](phase-3b-step2-avr8js-results.md) and existing
[`test/avr8js-wind`](../test/avr8js-wind/README.md) harness were inspected first.
The existing CPU setup, Intel HEX loader, timers, GPIO listener, virtual UART,
ELF instruction-address probes and Servo pulse analysis were reused. No simulator
was replaced, and no dependency was installed or added for Step 3. AVR8js remains
the single local dev dependency, pinned to 0.21.1.

Changes are confined to the isolated test project and this report:

- `modes.mjs` selects the original sketch, nominal capture duration and UART cues,
  and derives independent source-level expectations for comparison.
- `simulate.mjs` accepts a mode, derives build artifact filenames from the original
  sketch name and compares execution against both existing timeline definitions.
- `run-all.mjs` runs all three modes, continues to collect results if a mode fails,
  and verifies preservation against `preservation-baseline.json`.
- Existing `npm test` still runs WIND. New commands run WAVE, BUBBLE or all modes.

Historical `test/avr8js-wind/results/` and the Step 2 report remain byte-for-byte
unchanged. New results are stored in `results-step3/wind/`, `wave/` and `bubble/`.
WIND retains all 21 original assertion categories and tolerances, including its
original exact nominal sequence. Additional regression checks prove that its
recompiled HEX hash, CPU cycles, instruction count, complete `edges.csv` and
complete `pulses.csv` exactly match Step 2. The historical initial 50 ms startup
assumption failure remains preserved; it was not replaced by a new PASS file.

## Build and execution method

The existing Arduino CLI 1.5.1, AVR core 1.8.8 and Servo 1.3.0 were used with
`arduino:avr:nano:cpu=atmega328`. Builds use the original source directories and
unique temporary output directories. Each mode's JSON records exact compile
arguments, build directory, source SHA-256 and executed HEX SHA-256.

| Mode | Compiled flash bytes | Static SRAM bytes | Executed instructions | CPU cycles |
|---|---:|---:|---:|---:|
| WIND | 3424 | 297 | 299500178 | 388800001 |
| WAVE | 3400 | 297 | 311825184 | 404800002 |
| BUBBLE | 3570 | 399 | 349703592 | 443520001 |

Each simulation uses 32 KiB flash, 2 KiB SRAM, a 16 MHz clock, ports B/C/D, timers
0/1/2 and virtual USART0. The harness repeatedly calls `avrInstruction(cpu)` and
`cpu.tick()` without skipping delays. Timer1's Servo ISR writes PD5/PD6/PD7
(Arduino D5/D6/D7). These are Servo pulse trains, not static HIGH/LOW states or
Timer0 `analogWrite` PWM. Timestamp resolution is one modeled clock cycle, 0.0625 us.

ELF symbols resolve the compiled `inflate(unsigned long)` and
`deflate(unsigned long)` function entries. Read-only PC probes record actual entry
cycles and the requested delay in AVR registers r22–r25. The expected action lists
are used after execution for assertions; they never drive simulated pins or
advance the virtual clock. Nominal total plus 300 ms only determines capture length.

Actual calls are compared, in order and with exact delay arguments, with:

1. The original source-derived actions, including BUBBLE's integer interval splits.
2. `firmware/unified/nature_touch_unified/experience-timelines.h`.
3. `desktop/shared/experience-definitions.ts`, read using the existing Node 24
   runtime's native TypeScript support.

Unified production firmware is read only for comparison and remains
simulation-only; it is neither modified nor compiled/executed by this test.

## Measured pulse statistics

Widths exclude the first 100 ms. Steady repetition additionally excludes a 60 ms
window around nominal action boundaries; startup and boundary edges remain in
the raw CSVs. Values below are actual virtual measurements in microseconds.

| Mode | Pin | Complete pulses | Short width min–max | Long width min–max | Steady rise interval min–max | Mean steady interval |
|---|---|---:|---:|---:|---:|---:|
| WIND | D5 | 1213 | 543.4375–548.8125 | 2399.4375–2403.9375 | 20002.8125–20007.3125 | 20003.1173 |
| WIND | D6 | 1213 | 543.4375–549.6250 | 2399.4375–2402.1250 | 19999.3125–20008.4375 | 20003.1168 |
| WIND | D7 | 1213 | 543.4375–549.0000 | 2399.4375–2405.0625 | 19997.1250–20008.5000 | 20003.1181 |
| WAVE | D5 | 1263 | 543.4375–549.3750 | 2399.4375–2404.8125 | 20002.8125–20009.0625 | 20003.1299 |
| WAVE | D6 | 1263 | 543.4375–549.6250 | 2399.4375–2405.6250 | 19998.3750–20010.3125 | 20003.1306 |
| WAVE | D7 | 1263 | 543.4375–549.1875 | 2399.4375–2405.3125 | 19997.1250–20010.1875 | 20003.1303 |
| BUBBLE | D5 | 1384 | 543.4375–549.8750 | 2399.4375–2405.5625 | 20002.8125–20006.8125 | 20003.0894 |
| BUBBLE | D6 | 1384 | 543.4375–548.6250 | 2399.4375–2404.4375 | 19997.1250–20008.8750 | 20003.0848 |
| BUBBLE | D7 | 1384 | 543.4375–547.9375 | 2399.4375–2404.3750 | 19996.8750–20009.1250 | 20003.0845 |

In every mode, inflation produces long/long/short on D5/D6/D7 and deflation produces
short/short/long. Source-derived Servo targets are 2400 us and 544 us; measured
values include the library's trim, compiled GPIO overhead and interrupt scheduling.
Every post-startup pulse falls within the inherited ±12 us width tolerance.

Raw captures contain 7279 WIND, 7579 WAVE and 8305 BUBBLE edges. Each capture
ends during one additional high pulse, whose falling edge is outside the capture
window. That rise remains in `edges.csv`; it is correctly not counted as a
complete pulse in `pulses.csv`. CSV pulse counts were checked against both JSON
statistics and captured falling-edge counts.

Rise intervals at boundaries are not universally 20 ms, because Servo channels
are serialized and earlier channels' widths move later channels' rise times.
For WAVE, all-interval ranges including startup are D6 18146.9375–22401.8125 us
and D7 16291.0625–23715.625 us. For BUBBLE, they are D6
18146.4375–22402.0000 us and D7 16290.5000–23720.3125 us. These intervals are
retained, not replaced by nominal values. Steady repetition is about 20.003 ms.

## Phase timing and startup

The following ranges exclude the first startup state and include the next loop's
first pulse. Nominal error uses boot-relative summed delays. Command latency is
measured from the actual helper instruction entry to the first pulse of its new
width class. Both are distinct from a physical actuator movement time.

| Mode | Pin | Nominal-to-pulse error range (ms) | Executed-command-to-pulse range (ms) |
|---|---|---:|---:|
| WIND | D5 | +4.391–+16.693 | 3.307–14.035 |
| WIND | D6 | +6.800–+19.102 | 5.716–16.443 |
| WIND | D7 | +9.208–+21.510 | 8.124–18.852 |
| WAVE | D5 | +13.729–+16.865 | 13.108–14.501 |
| WAVE | D6 | +14.282–+19.274 | 13.661–16.910 |
| WAVE | D7 | +14.834–+21.682 | 14.213–19.318 |
| BUBBLE | D5 | +4.109–+24.445 | 2.088–19.527 |
| BUBBLE | D6 | +4.788–+26.854 | 2.641–21.935 |
| BUBBLE | D7 | +5.340–+25.559 | 0.628–22.063 |

| Mode | First D5 pulse (ms) | First D6 pulse (ms) | First D7 pulse (ms) | Other-width startup pulses |
|---|---:|---:|---:|---:|
| WIND | 52.9567500 | 32.9633750 | 35.3713125 | 0 |
| WAVE | 52.9567500 | 32.9633750 | 35.3713125 | 0 |
| BUBBLE | 53.0141250 | 33.0205625 | 35.4286875 | 0 |

All startup first pulses match the expected initial inflation width class and
arrive before the inherited 75 ms bound. No 1500 us startup pulses were observed.
The D6/D7-before-D5 startup order agrees with the Step 2 Timer1/Servo channel-index
finding. Early ISR entry records are separately retained for all modes. This is
emulator behavior and source-supported analysis, not a physical Nano reset trace.

Measured extra time per completed action, from consecutive helper entries minus
the requested delay, was WIND 0.151750–0.387625 ms, WAVE 0.151750–0.392000 ms,
and BUBBLE 0.1529375–0.302625 ms. Accumulated execution overhead explains why the
loop measurements exceed the nominal targets.

## WAVE: all executed actions

All times are milliseconds from virtual application reset, rounded to 3 decimals.
"Interval" measures one helper entry to the next. "D5 rise" is the first captured
complete pulse of the new class. D6/D7 transitions and all unrounded numbers are
in the machine-readable results.

| Action | Executed helper | Delay argument | Nominal start | Helper entry | Interval | D5 rise |
|---|---|---:|---:|---:|---:|---:|
| 0 | inflate | 5000 | 0 | 0.313 | 5000.307 | 52.957 |
| 1 | deflate | 2000 | 5000 | 5000.621 | 2000.155 | 5013.729 |
| 2 | inflate | 2500 | 7000 | 7000.776 | 2500.155 | 7014.045 |
| 3 | deflate | 2000 | 9500 | 9500.931 | 2000.157 | 9514.440 |
| 4 | inflate | 2500 | 11500 | 11501.087 | 2500.154 | 11514.754 |
| 5 | deflate | 2000 | 14000 | 14001.241 | 2000.160 | 14015.147 |
| 6 | inflate | 2500 | 16000 | 16001.402 | 2500.155 | 16015.457 |
| 7 | deflate | 1000 | 18500 | 18501.557 | 1000.152 | 18515.849 |
| 8 | inflate | 500 | 19500 | 19501.708 | 500.264 | 19516.004 |
| 9 | deflate | 5000 | 20000 | 20001.972 | 5000.392 | 20016.083 |
| 10, next loop | inflate | 5000 | 25000 | 25002.364 | — | 25016.865 |

There are 10 actions per complete WAVE loop, 11 captured helper entries including
repeat, and 11 captured pulse-class states per pin including repeat. All match
the existing definitions. The three 2000/2500 ms wave pairs and final 1000/500 ms
transition are retained exactly.

## BUBBLE: irregular sequence retained without resampling

All 31 original actions execute in order. This consists of two initial inflation
calls, 14 irregular deflate/inflate pairs and the final 3000 ms deflation. The
original code stops processing pop entries at its 20000 ms music cutoff; later
entries in the original array are correctly not executed. Integer arithmetic
preserves `floor(interval × 45 / 100)` deflation and the remaining inflation time.

The first two calls are intentionally **not merged**: action 0 is inflate(4420),
then action 1 is inflate(580). Their combined 5000 ms has no pulse-class change at
the boundary. The instruction probe captures both actions, and every pin has
matching real captured pulses within action 1. Its missing *new* class transition
is not a dropped event. A fabricated extra transition would fail the sequence
count check.

| Action | Executed helper | Delay argument | Nominal start | Helper entry | Interval | D5 rise / continuation |
|---|---|---:|---:|---:|---:|---:|
| 0 | inflate | 4420 | 0 | 0.265 | 4420.274 | 53.014 |
| 1 | inflate | 580 | 4420 | 4420.540 | 580.303 | Continuous; no new class edge |
| 2 | deflate | 657 | 5000 | 5000.842 | 657.154 | 5013.785 |
| 3 | inflate | 803 | 5657 | 5657.996 | 803.197 | 5673.886 |
| 4 | deflate | 670 | 6460 | 6461.194 | 670.158 | 6474.009 |
| 5 | inflate | 820 | 7130 | 7131.352 | 820.198 | 7134.109 |
| 6 | deflate | 891 | 7950 | 7951.550 | 891.162 | 7954.235 |
| 7 | inflate | 1089 | 8841 | 8842.712 | 1089.199 | 8854.372 |
| 8 | deflate | 850 | 9930 | 9931.911 | 850.160 | 9934.540 |
| 9 | inflate | 1040 | 10780 | 10782.071 | 1040.200 | 10794.674 |
| 10 | deflate | 900 | 11820 | 11822.271 | 900.160 | 11834.838 |
| 11 | inflate | 1100 | 12720 | 12722.431 | 1100.198 | 12734.977 |
| 12 | deflate | 823 | 13820 | 13822.629 | 823.153 | 13835.146 |
| 13 | inflate | 1007 | 14643 | 14645.782 | 1007.195 | 14655.271 |
| 14 | deflate | 819 | 15650 | 15652.977 | 819.160 | 15655.426 |
| 15 | inflate | 1001 | 16469 | 16472.136 | 1001.203 | 16475.552 |
| 16 | deflate | 225 | 17470 | 17473.340 | 225.156 | 17475.706 |
| 17 | inflate | 275 | 17695 | 17698.496 | 275.198 | 17715.742 |
| 18 | deflate | 1066 | 17970 | 17973.695 | 1066.153 | 17975.782 |
| 19 | inflate | 1304 | 19036 | 19039.848 | 1304.205 | 19055.951 |
| 20 | deflate | 342 | 20340 | 20344.053 | 342.156 | 20356.154 |
| 21 | inflate | 418 | 20682 | 20686.208 | 418.198 | 20696.206 |
| 22 | deflate | 378 | 21100 | 21104.406 | 378.154 | 21116.271 |
| 23 | inflate | 462 | 21478 | 21482.561 | 462.204 | 21496.330 |
| 24 | deflate | 252 | 21940 | 21944.764 | 252.154 | 21956.400 |
| 25 | inflate | 308 | 22192 | 22196.918 | 308.219 | 22216.445 |
| 26 | deflate | 243 | 22500 | 22505.137 | 243.155 | 22516.494 |
| 27 | inflate | 297 | 22743 | 22748.292 | 297.204 | 22756.531 |
| 28 | deflate | 621 | 23040 | 23045.496 | 621.154 | 23056.578 |
| 29 | inflate | 759 | 23661 | 23666.650 | 759.263 | 23676.675 |
| 30 | deflate | 3000 | 24420 | 24425.912 | 3000.246 | 24436.793 |
| 31, next loop | inflate | 4420 | 27420 | 27426.159 | — | 27437.255 |

Thus BUBBLE captures 32 helper entries including the next loop, and 31 distinct
pulse-class states per pin including the next loop. No action was dropped or
invented. Even the shortest 225 ms action has at least eight matching complete
pulses per pin after the analysis settling window. The nominal 27420 ms total,
rather than a rounded 28000 ms, agrees with the exact existing legacy timeline.

## Assertions and tolerances

| Requirement | Actual result | Validation |
|---|---|---|
| Original HEX execution | PASS, all modes | Real AVR instructions, timers and interrupts |
| Action count, order and delay arguments | PASS, all modes | Exact trace vs original source, unified and desktop definitions |
| Per-action elapsed time | PASS, all modes | Every completed helper interval within -0.1 to +1 ms of requested delay |
| Pulse widths | PASS, all pins/modes | Every pulse after 100 ms within ±12 us of 544 or 2400 us |
| Actual waveform in every action | PASS, all pins/modes | Nonempty matching captured pulses after 75 ms settling; includes BUBBLE continuation |
| Startup pulses | PASS, all pins/modes | First expected-class pulse before 75 ms; actual startup retained |
| Pulse-class sequence and repeat | PASS, all pins/modes | Exact ordered states and counts, next-loop inflation included |
| Phase timing after startup | PASS, all pins/modes | Within ±30 ms nominal; 0–25 ms after executed helper entry |
| Steady repetition | PASS, all pins/modes | 20000 ±30 us outside declared boundary windows |
| Loop completion/restart | PASS, all modes | Exact next-cycle helper observed; WIND/WAVE ±5 ms, BUBBLE ±15.5 ms |
| Virtual UART cues | PASS, all modes | Expected cue text present; WIND/WAVE initial cue repeats |
| Original sketch integrity | PASS, all modes | Unchanged SHA-256 across execution |
| Historical evidence and production firmware integrity | PASS | All 13 preservation entries match |
| Original WIND regression | PASS | All 21 previous checks retained; exact HEX/edge/pulse regression |

BUBBLE's loop tolerance was set before execution to 0.5 ms per original action
(31 × 0.5 = 15.5 ms) to accommodate accumulated helper and integer-arithmetic
overhead. Its measured +5.893 ms would exceed WIND's old +5 ms bound, but every
individual BUBBLE action has only +0.153 to +0.303 ms overhead, and all GPIO phase
checks pass without widening the inherited 30/25 ms tolerances. The nominal
duration has not been substituted for the measured duration.

## Observed issues and limits

- Startup pulses do not appear simultaneously or immediately. D5 starts around
  53 ms, after D6 and D7, consistent with the existing Step 2 finding. This is
  reported rather than hidden by excluding startup from the evidence.
- BUBBLE's consecutive initial inflation calls cannot be validated solely by
  counting changes in pulse widths. PC/argument tracing preserves this action
  boundary independently of the continuous waveform.
- BUBBLE's next `PLAY AUDIO NOW` cue would occur 4420 ms into the second loop and
  is outside this capture. Restart is proved by the actual next-loop helper and
  GPIO, not by inventing another cue. Its captured `NEXT ROUND` newline reaches the
  virtual UART after the next helper has begun because output is buffered.
- Node emits `MODULE_TYPELESS_PACKAGE_JSON` when reading the existing desktop
  TypeScript definitions. This is a module-detection warning and did not fail any
  test. Production package configuration was not changed to suppress it.
- No unsupported AVR8js Servo feature blocked these runs. Results still describe
  the AVR8js model, not proof of cycle-perfect ATmega328P hardware, oscillator
  accuracy, bootloader delay, analog electrical behavior or actuator behavior.

Simulated short/long Servo pulses do **not** establish the unknown RC electronic
switches' physical OFF state. Pump/valve operation, pressure safety and behavior
under reset or communication loss remain outside these virtual waveform tests.

## Separate evidence and reproducible commands

| Evidence | Location |
|---|---|
| Aggregate PASS and preservation hashes | [all-modes.json](../test/avr8js-wind/results-step3/all-modes.json) |
| WIND results | [wind/results.json](../test/avr8js-wind/results-step3/wind/results.json) |
| WAVE results | [wave/results.json](../test/avr8js-wind/results-step3/wave/results.json) |
| BUBBLE results | [bubble/results.json](../test/avr8js-wind/results-step3/bubble/results.json) |
| Preserved Step 2 WIND evidence | [historical results.json](../test/avr8js-wind/results/results.json) |
| Runner and tool overrides | [README](../test/avr8js-wind/README.md) |

Each mode directory also contains `edges.csv`, `pulses.csv`, `<mode>.hex.txt`,
`symbols.txt` and `compile.log`. JSON includes raw helper calls, every expected
action, per-action measurements, per-pin transition timings, sample counts,
startup ISR traces, virtual UART cues, thresholds and individual PASS/FAIL checks.

From the repository root, using the existing Node 24 and Arduino tools:

```powershell
Set-Location .\test\avr8js-wind
# Only needed when the isolated dependency folder is absent:
npm ci --ignore-scripts --no-audit --no-fund

npm run test:all
# Or run a single mode:
npm run test:wind
npm run test:wave
npm run test:bubble
```

`npm test` remains the WIND command. Set `AVR_RESULTS_ROOT` to a fresh directory
to retain separate rerun captures; historical Step 2 evidence is never the default
output. The aggregate command exits nonzero for any mode failure or preservation
failure. No upload, serial monitor or physical port enumeration command is used.

## Recommended next implementation step

Keep the next step simulation-only: compare the unified nonblocking controller's
emitted action/marker trace and stop/reset behavior against these legacy execution
records, including BUBBLE's two separate initial inflation actions and irregular
integer durations. Validate scheduling and interruption behavior before considering
any hardware enablement. These results do not authorize or automatically begin
real actuator integration.

## 中文结论

WIND、WAVE、BUBBLE 三种原始草图均已完成真实编译 HEX 的 AVR8js 执行，合计
80 项断言全部 PASS。实测一轮分别为 24002.346、25002.051、27425.893 ms；
这些是虚拟 CPU 的测量值，24000／25000／27420 ms 仅作为名义比较目标。

三路短脉冲约 543.44–549.88 us，长脉冲约 2399.44–2405.63 us，稳态重复间隔约
20.003 ms。WAVE 每路捕获 1263 个完整脉冲，BUBBLE 每路 1384 个。BUBBLE 的
31 个不规则动作全部保留，包括 4420 ms 与 580 ms 两次连续充气；没有补造波形边沿。

WIND 既有证据及原始固件保持不变，复跑波形与 Step 2 完全一致。未连接串口、
上传固件或启用执行器。建议下一步只验证统一控制器的仿真调度、停止及重置行为；
本次虚拟 PWM 结果不能证明 RC 开关的物理 OFF 行为。
