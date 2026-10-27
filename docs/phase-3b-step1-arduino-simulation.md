# Nature Touch Phase 3B / Step 1: Arduino Simulation

## Result summary

**Partial completion.** The original WIND sketch compiled successfully for the classic Arduino Nano target (ATmega328P) using the already-installed Arduino CLI, AVR core, and Servo library. No physical board, COM port, actuator, or firmware upload was used.

An actual MCU waveform simulation and capture could not be performed in this environment:

- SimulIDE was not found on PATH or in the checked common application install folders.
- `avr8js` and `simavr` are not installed or available on PATH.
- No simulator or library was installed because installation requires informing the user first.
- The original sketch was compiled to a temporary build directory only. Its generated HEX/ELF was not loaded into a simulator.

Therefore, the pulse values below are **expected from the installed Servo library source and compile**, not measured or captured simulated waveforms. The requirement to observe and validate simulated D5/D6/D7 pulses remains incomplete.

## Simulator selected and capability

**Preferred simulator: SimulIDE**, as requested.

The [official SimulIDE page](https://simulide.com/p/) and [official source repository](https://github.com/Arcachofo/SimulIDE-dev) describe support for AVR/Arduino microcontrollers, an Arduino code editor/compiler/debugger, and an oscilloscope and logic analyzer. This indicates the intended workflow can support loading/running an Arduino image and monitoring MCU pins.

However, SimulIDE is not installed here, so its availability, compatibility with this exact ATmega328P/Nano image, and fidelity for the Servo timer-interrupt output were not tested. No claim is made that the specific build has been successfully loaded or simulated.

| Check | Result |
|---|---|
| SimulIDE installed | **No; not found in checked locations or PATH** |
| SimulIDE official AVR/Arduino and instruments claims | **Documented by upstream; not locally verified** |
| Headless `avr8js` installed | **No** |
| `simavr` installed | **No** |
| Physical serial/COM access | **Not used** |
| Firmware upload | **Not performed** |

## Build performed

The exact original [WIND sketch](../卒研music/wind/sketch_oct21a/sketch_oct21a.ino) was compiled with the installed Arduino CLI and AVR platform:

```text
arduino-cli 1.5.1
FQBN: arduino:avr:nano:cpu=atmega328
Platform: arduino:avr 1.8.8
Compiler target: -mmcu=atmega328p
Servo library: 1.3.0 (existing local installation)
```

The first compile attempt did not locate the locally installed Servo library. The successful retry explicitly pointed Arduino CLI at the existing `Arduino15/libraries` directory; it did not download or install anything.

Compile result:

```text
Sketch uses 3424 bytes (11%) of program storage space. Maximum is 30720 bytes.
Global variables use 297 bytes (14%) of dynamic memory, leaving 1751 bytes for local variables. Maximum is 2048 bytes.
```

The build output directory was under the Windows temporary directory. No project source or production firmware was changed.

## Expected Servo signals from source (not waveform observations)

The existing local AVR Servo library defines default `MIN_PULSE_WIDTH=544 us`, `MAX_PULSE_WIDTH=2400 us`, and `REFRESH_INTERVAL=20000 us`. On AVR, `Servo::write()` maps the degree input from 0–180 to the configured pulse-width range; the timer ISR generates the pulses. Accordingly, the steady-state expected signals are:

| Legacy command | D5 | D6 | D7 |
|---|---:|---:|---:|
| `inflate()` | `write(180)` → **2400 us high pulse** | `write(180)` → **2400 us** | `write(0)` → **544 us** |
| `deflate()` | `write(0)` → **544 us** | `write(0)` → **544 us** | `write(180)` → **2400 us** |

The expected frame repetition is approximately 20 ms with these three active channels, based on the library's refresh interval. The pins are pulse trains, not static digital HIGH/LOW states. The table describes Servo library output intent, not the actual simulated pin waveform and not the behavior of any electronic switch or actuator.

There may also be an initial signal transient: the Servo object constructor initializes its channel pulse value to the library's default 1500 us before the sketch's first helper overwrites it. Since the sketch attaches channels in `setup()` and writes the first `inflate()` values later in `loop()`, the exact number and timing of any default-width pulses must be measured in a simulator.

## WIND sequence and timing comparison

The original sketch calls `delay()` after each helper writes the three Servo target values. That makes each target set persist for the following delay interval. The checked-in unified [WIND timeline](../firmware/unified/nature_touch_unified/experience-timelines.h) contains the same ordered 12 states and durations.

| Start offset | Helper / intended phase | Duration | D5 / D6 / D7 Servo values |
|---:|---|---:|---|
| 0 ms | `inflate()` — initial fill | 5000 ms | 180 / 180 / 0 |
| 5000 ms | `deflate()` | 1500 ms | 0 / 0 / 180 |
| 6500 ms | `inflate()` | 1300 ms | 180 / 180 / 0 |
| 7800 ms | `deflate()` | 1450 ms | 0 / 0 / 180 |
| 9250 ms | `inflate()` | 1050 ms | 180 / 180 / 0 |
| 10300 ms | `deflate()` | 1900 ms | 0 / 0 / 180 |
| 12200 ms | `inflate()` | 1600 ms | 180 / 180 / 0 |
| 13800 ms | `deflate()` | 1750 ms | 0 / 0 / 180 |
| 15550 ms | `inflate()` | 1450 ms | 180 / 180 / 0 |
| 17000 ms | `deflate()` | 1050 ms | 0 / 0 / 180 |
| 18050 ms | `inflate()` | 950 ms | 180 / 180 / 0 |
| 19000 ms | `deflate()` — final shrink | 5000 ms | 0 / 0 / 180 |
| 24000 ms | End of one loop; next loop begins | — | Sketch repeats automatically |

The cumulative delay duration is 24,000 ms and matches the unified WIND timeline. This is a source-level comparison; no virtual waveform or simulator timing was captured. The legacy sketch also performs serial cue printing between some phases, so physical elapsed time includes serial execution overhead; the table represents nominal helper-delay offsets.

## Procedure if SimulIDE is made available

No installation or simulator setup was performed. After SimulIDE is installed or provided by the user, a virtual-only test can use this procedure:

1. Keep all physical Nano, COM ports, modules, pumps, and valve disconnected.
2. Open SimulIDE and select/configure an AVR ATmega328P (Nano-compatible) MCU model.
3. Use the existing Arduino toolchain to compile the WIND sketch for `arduino:avr:nano:cpu=atmega328`, then load the generated HEX/ELF into the virtual MCU using the supported SimulIDE flow.
4. Attach virtual oscilloscope or logic-analyzer channels to MCU pins D5, D6, and D7, with a common virtual ground. Configure scope time resolution to distinguish roughly 0.5–2.4 ms pulses repeated around a 20 ms frame.
5. Capture at least one initial-fill interval, each state transition, and the final-deflate interval. Record measured pulse high times, frame periods, and transition times.
6. Compare measurements against the Servo source expectations and WIND delay schedule above. Do not model the switch modules as active/inactive loads unless their behavior is separately specified; a pin waveform alone cannot validate that.

The Arduino CLI can produce the image, but it does not execute MCU instructions or simulate pin waveforms. This environment has no installed SimulIDE GUI or headless AVR simulator to complete steps 2–6.

## Recommended alternative: headless AVR8js test

If installing or providing SimulIDE is not practical, a programmatic test can use `avr8js` to execute the compiled ATmega328P image and sample GPIO state changes. A reliable test harness would need to:

- parse/load the compiled ELF (or compatible image plus required memory metadata),
- emulate ATmega328P timers and interrupts sufficiently for Arduino core and Servo library,
- advance simulated time through the 24-second WIND loop,
- timestamp transitions on D5/D6/D7,
- assert expected pulse widths, frame repetition, state transitions, and nominal phase durations.

`avr8js` was not installed or run in this task, and no dependency was added. A simplistic register-level script or logical model of the helper calls would not count as running the compiled firmware and must not be reported as a waveform simulation. Installing the simulator dependency requires user approval.

## Limitations and safety

- **Compilation is verified; waveform simulation is not.**
- Expected pulse widths are source-derived from the locally installed Servo 1.3.0 AVR implementation, not observed with an oscilloscope or simulated instrument.
- No real or simulated electronic-switch behavior was tested.
- No inference about `Servo.write(0)`, `write(90)`, `write(180)`, or `detach()` is an OFF-state guarantee.
- A simulated logic waveform cannot establish electrical compatibility, load current, reset behavior of the physical module, pressure safety, or real actuator behavior.
- No physical serial port, physical Arduino, or actuator was used.

## 中文结论

- 已完成：使用现有 Arduino CLI、AVR 核心及本地 Servo 库，把原始 WIND 草图成功编译为经典 Nano / ATmega328P 目标。Flash 为 3,424 字节，静态 SRAM 为 297 字节。没有上传、连接串口或修改工程固件。
- 未完成：环境中没有 SimulIDE、avr8js 或 simavr，因此没有加载固件、运行虚拟 MCU 或捕获 D5/D6/D7 波形。文中的 544 us、2400 us 和约 20 ms 是从 Servo 库源码推导的预期值，不是模拟器观测结果。
- 模拟器能力：SimulIDE 官方资料声称支持 Arduino/AVR、编译调试以及示波器/逻辑分析仪；但本环境无法验证具体 Nano 固件与 Servo 中断脉冲的兼容性。
- 建议：最小下一步是由用户提供/安装 SimulIDE 后按文档步骤进行隔离的虚拟捕获；若需自动化，先获准安装 `avr8js` 并建立真正执行编译固件、采样 AVR GPIO/定时器输出的测试。不能把源码推导或逻辑模拟称作实际波形验证。
- 安全：全部工作为虚拟/本地构建；未使用任何物理 COM 端口或执行器。虚拟波形也不能证明真实 RC 开关的安全 OFF 状态。
