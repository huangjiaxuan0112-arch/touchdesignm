# Nature Touch — Phase 3B / Step 2: headless WIND execution

## Result and scope

**PASS for virtual WIND GPIO timing under the recorded AVR8js model.** The original
Arduino Nano HEX was actually executed; these are not generated waveforms or
source-only predictions. All 21 final assertions passed. A first-run startup
assumption failed and is preserved and explained below.

The test covers the original WIND sketch only. It does not validate physical RC
switch OFF behavior, pneumatic/actuator behavior, or silicon timing accuracy. No
physical USB/COM access, upload, or actuator control occurred. Original sketches,
audio assets and unified firmware were not modified. Unified firmware remains
simulation-only; its WIND timeline was read for comparison, not executed here.
WAVE and BUBBLE were not expanded or tested.

## Repository and build inspection

The active repository was at inspection commit `8e2df49` (`Complete Nature Touch
Phase 2B integration`). It contains the latest Step 1 report; an earlier local
copy did not. Existing untracked Phase 2/3 reports and WIND videos were left
alone. No Git commit or migration was performed.

| Component | Used |
|---|---|
| Original source | `卒研music/wind/sketch_oct21a/sketch_oct21a.ino` |
| Arduino CLI | Existing IDE-bundled CLI 1.5.1 |
| FQBN | `arduino:avr:nano:cpu=atmega328` |
| MCU / clock | ATmega328P / 16 MHz |
| Arduino AVR core | Existing 1.8.8 |
| Servo | Existing 1.3.0, explicit `Arduino15/libraries` search path |
| Node | 24.22.1 |
| Simulator | AVR8js 0.21.1, exact local dev dependency |
| Flash / static SRAM | 3424 bytes / 297 bytes |
| Simulated duration | 24.3000000625 s, 388800001 CPU cycles |
| Executed instructions | 299500178 |

The isolated [test project](../test/avr8js-wind/README.md) has its own package and
lockfile. Only AVR8js was installed; the desktop application's dependencies and
configuration were not changed. Arduino compilation outputs go to a unique
temporary directory. The exact directory and compile arguments are in the JSON.

Original sketch SHA-256:
`20771252af97129bd08c1fe6e8fd1983ca2345c0652d202614afd762013066f2`

Executed HEX text SHA-256:
`fc79c3f306248729900b3f68f243256a38799527308c5267b8e9ffeb29ca4830`

## Compatibility and method

Upstream [AVR8js](https://github.com/wokwi/avr8js) targets the ATmega328P. Its
[timer implementation](https://github.com/wokwi/avr8js/blob/main/src/peripherals/timer.ts)
provides the 16-bit Timer1 normal counting, prescalers and compare interrupts used
here, plus Timer0 for Arduino timekeeping. This is sufficient for this particular
compiled Servo path; it is not a claim that every AVR peripheral is fully modeled.

The installed Servo source selects Timer1 on ATmega328P, uses prescaler 8 and
`TIMER1_COMPA_vect`, and calls `digitalWrite` sequentially for the three channels.
D5/D6 are not being tested as Timer0 `analogWrite` hardware PWM. D7 does not need
hardware PWM capability because Servo toggles it from the Timer1 ISR.

The harness loads checksum-validated Intel HEX into 32 KiB flash, configures 2 KiB
SRAM, GPIO ports B/C/D, timers 0/1/2 and USART0, starts at application reset vector
0, then executes AVR instructions and clock events without skipping delays. Port D
listeners timestamp every D5/PD5, D6/PD6 and D7/PD7 edge using `cpu.cycles / 16` us.
Timestamp granularity is one modeled clock cycle (0.0625 us), not a guarantee of
equivalent physical accuracy.

Read-only instruction-address probes resolved from the ELF symbol map record
actual `inflate`/`deflate` function entries, their AVR register arguments, and early
Timer1 ISR entries. These probes do not patch program memory, change SRAM or drive
GPIO. UART text is captured within AVR8js only; its callback timestamps represent
UDR writes as the newline byte is queued, not completion on a physical wire.

## Captured pulse widths and repetition

Each pin produced **1213 complete pulses**. Statistics below exclude the first
100 ms for pulse width and additionally exclude 60 ms around phase boundaries for
steady repetition. Complete startup and transition data remain in the CSV files.

| Pin | Short width min–max (us) | Long width min–max (us) | Steady rise interval min–max (us) | Mean steady interval (us) |
|---|---:|---:|---:|---:|
| D5 | 543.4375–548.8125 | 2399.4375–2403.9375 | 20002.8125–20007.3125 | 20003.1173 |
| D6 | 543.4375–549.6250 | 2399.4375–2402.1250 | 19999.3125–20008.4375 | 20003.1168 |
| D7 | 543.4375–549.0000 | 2399.4375–2405.0625 | 19997.1250–20008.5000 | 20003.1181 |

Source-derived targets are 544 us for `write(0)` and 2400 us for `write(180)`.
The measurements include the compiled ISR, `digitalWrite`, Servo's 2 us trim,
Timer0/UART interrupt interaction and emulator scheduling. They should not be
rounded into a claim of exact 544/2400 us output.

| Executed phase | Legacy commands D5 / D6 / D7 | Measured pulse classes |
|---|---|---|
| Inflate | 180 / 180 / 0 | Long / long / short |
| Deflate | 0 / 0 / 180 | Short / short / long |

Across all intervals, including startup and phase transitions, D6 ranges from
18146.8125 to 22401.8125 us and D7 from 16290.1875 to 23716 us. These are recorded,
not discarded as nonexistent: earlier serialized channels change width and move
later channels' rise times. Thus a universal exact 20 ms rise interval would be an
incorrect assertion. Steady repetition remains about 20.003 ms.

## WIND timeline: actual execution and output changes

All values below are milliseconds from application reset, rounded to 3 decimals.
"Helper entry" is measured instruction execution. Pin times are the first rising
edge of a complete pulse with the new phase's width, rather than the exact moment
the Servo target variable is changed. I = inflate, D = deflate.

| Phase | Nominal start | Delay requested | Helper entry | D5 first rise | D6 first rise | D7 first rise |
|---|---:|---:|---:|---:|---:|---:|
| I initial fill | 0 | 5000 | 0.313 | 52.957 | 32.963 | 35.371 |
| D | 5000 | 1500 | 5000.621 | 5013.729 | 5014.282 | 5014.834 |
| I | 6500 | 1300 | 6500.772 | 6513.967 | 6516.376 | 6518.784 |
| D | 7800 | 1450 | 7800.925 | 7814.169 | 7814.722 | 7815.274 |
| I | 9250 | 1050 | 9251.084 | 9254.391 | 9256.800 | 9259.208 |
| D | 10300 | 1900 | 10301.237 | 10314.555 | 10315.108 | 10315.660 |
| I | 12200 | 1600 | 12201.389 | 12214.854 | 12217.263 | 12219.671 |
| D | 13800 | 1750 | 13801.545 | 13815.103 | 13815.656 | 13816.208 |
| I | 15550 | 1450 | 15551.705 | 15555.373 | 15557.781 | 15560.190 |
| D | 17000 | 1050 | 17001.857 | 17015.597 | 17016.149 | 17016.701 |
| I | 18050 | 950 | 18052.010 | 18055.764 | 18058.173 | 18060.581 |
| D final shrink | 19000 | 5000 | 19002.271 | 19015.912 | 19016.464 | 19017.016 |
| I next cycle | 24000 | 5000 | 24002.659 | 24016.693 | 24019.102 | 24021.510 |

The measured helper-entry loop interval is **24002.3456875 ms**. Nominal delays sum
to 24000 ms; compiled software/interrupt overhead adds about 2.346 ms in this run.
All 12 helper calls and the next loop's first call were observed with the expected
5000/1500/1300/1450/1050/1900/1600/1750/1450/1050/950/5000 ms arguments.
These match the original source and the read-only unified WIND array.

The first short/long output pulse appears on the next eligible channel slot.
After startup, measured command-to-first-pulse delays range from approximately
3.307 to 18.852 ms. In particular, final deflation is visibly present from about
19015.912 ms on D5 until 24016.693 ms, a measured pulse-class duration of
5000.781625 ms. Each pin's per-phase durations are in `transitions` in the JSON;
they need not exactly equal helper delays because phase boundaries are frame
quantized and channels are sequential, not simultaneous.

Virtual UART captured `INITIAL FILL`, `PLAY WIND AUDIO NOW`, `FINAL SHRINK`,
`NEXT WIND CYCLE`, then another `INITIAL FILL`. No audio was played or modeled.

## Startup finding and initial FAIL

The first run failed one of 16 original assertions: a naive condition required
every pin's first pulse to arrive within 50 ms of reset. D5 actually starts at
**52.956750 ms**. All pulse-width, sequence and steady-period assertions already
passed. The original failure is preserved in
[`initial-validation.json`](../test/avr8js-wind/results/initial-validation.json).

The added execution probes show Timer1 ISR entries at:

| ISR entry (ms) | Servo `Channel` before ISR |
|---:|---:|
| 32.9453125 | 0 |
| 35.3541250 | 1 |
| 35.9071875 | 2 |
| 52.9451250 | -1 |

The observed sequence agrees with this explanation from the installed Servo
source: `Channel` initially contains zero; the first ISR increments it to channel
1, so D6 starts before D5. Timer1's initial zero compare is reached following the
16-bit normal-counter wrap (65536 ticks at 0.5 us = 32.768 ms), after which the
refresh slot leads to D5's first pulse. This explanation is source/model analysis
supported by the measured ISR entries; it is not a separately measured physical
Nano boot trace. No 1500 us default-width startup pulses were observed.

The final harness checks startup separately with a 75 ms bound (initial wrap plus
20 ms refresh plus setup margin). It **tightens** later phase checks to 30 ms from
nominal and 0–25 ms after the executed helper entry. The first failing assumption
was changed in the test, not in the firmware. The startup delay remains reported
and is not hidden by dropping startup edges.

## Final PASS/FAIL criteria

| Check group | Result | Criteria |
|---|---|---|
| Executed helper sequence and delay arguments | PASS | 13 entries, including repeat |
| Executed loop interval | PASS | 24000 ±5 ms |
| Original and unified nominal WIND timeline | PASS | Same 12 states; 24000 ms sum |
| D5/D6/D7 widths | PASS | All pulses after 100 ms within ±12 us of 544 or 2400 us |
| D5/D6/D7 phase sequence | PASS | I/D alternation and next-cycle I |
| D5/D6/D7 startup | PASS | First pulse under 75 ms; actual times retained |
| D5/D6/D7 later phase timing | PASS | ±30 ms nominal; 0–25 ms from helper entry |
| D5/D6/D7 steady repetition | PASS | 20000 ±30 us outside boundary windows |
| Virtual UART progression | PASS | Four cue strings and next-cycle initial fill |
| Original sketch integrity | PASS | SHA-256 unchanged before/after execution |
| Initial universal 50 ms startup assumption | FAIL, historical | D5 first rise 52.956750 ms |

`results.json` contains all 21 individual final assertions. Thresholds characterize
this virtual timing test; none is a physical actuator safety specification.

## Evidence and rerun

- [Harness and rerun instructions](../test/avr8js-wind/README.md)
- [Machine-readable results](../test/avr8js-wind/results/results.json)
- [Every GPIO transition](../test/avr8js-wind/results/edges.csv)
- [Pulse widths and intervals](../test/avr8js-wind/results/pulses.csv)
- [Exact executed HEX](../test/avr8js-wind/results/wind.hex.txt)
- [ELF symbols](../test/avr8js-wind/results/symbols.txt)
- [Compile output](../test/avr8js-wind/results/compile.log)

```powershell
# From this repository's root
Set-Location .\test\avr8js-wind
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

The README documents installation overrides and `WIND_RESULTS` for retaining
separate rerun evidence. No GUI simulator or other npm package is required.

## Limits

The simulation demonstrated the specific Timer0/Timer1/Servo interrupt path needed
by WIND; no missing Servo timer feature blocked this run. It does not establish
that AVR8js is cycle-perfect against real ATmega328P hardware. In particular,
instruction-level GPIO timestamps, interrupt latency and initial timer behavior
remain emulator-model results until compared with an actual logic-analyzer trace.

The Nano bootloader, USB interface, oscillator tolerance, analog voltage/current,
brownouts, RC electronic switches, pumps, valves and air system are outside the
model. Application execution begins at reset vector 0 without bootloader delay.
`write(0)` produces a short pulse train here; **it is not proof of a physical OFF
state**. This run cannot validate `write(90)`, `detach()`, reset safety or unknown
switch latching behavior. No production firmware enablement follows from PASS.

## 中文结论

WIND 虚拟 GPIO 时序测试通过，最终 21 项断言全部 PASS。测试实际执行 Arduino CLI
编译产生的原始 HEX，共执行 299,500,178 条 AVR 指令，覆盖 24.30 秒虚拟时间，
不是按源码直接生成预期波形。D5、D6、D7 各捕获 1213 个完整脉冲；短脉冲约
543.44–549.63 us，长脉冲约 2399.44–2405.06 us，稳态重复间隔约 20.003 ms。

12 个充气/抽气阶段和下一轮开始均被观测到，实际 helper 入口测得一轮为
24002.346 ms，与 24000 ms 的延时总和相符，差异为模拟执行的软件开销。
启动并非三路同时输出：D6 首脉冲约 32.963 ms、D7 约 35.371 ms、D5 约
52.957 ms。首轮把所有首脉冲限制在 50 ms 内的测试曾 FAIL；原始失败记录已保留，
后续结合实测中断顺序将启动和稳态分别验证，没有修改固件来消除差异。

未连接物理串口、未上传固件、未控制执行器，也未修改原始草图或音频。未知 RC
电子开关的真实 OFF 行为仍未验证；虚拟 PWM 通过不等于物理硬件安全验证通过。
