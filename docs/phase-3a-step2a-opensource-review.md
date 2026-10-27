# Nature Touch Phase 3A / Step 2A: Open-Source Firmware Review

## Scope and method

This is a read-only review of source, examples, hardware documentation, and the licenses available at the repository snapshots linked below. No library was installed; no Nature Touch code, wiring, firmware, or hardware was changed; no serial port was opened; and no actuator command was sent. The review does not certify the physical safety of any hardware.

The six upstream repositories were reviewed at fixed commits so that the cited implementation can be rechecked:

| Project | Reviewed snapshot | Relevant license |
|---|---|---|
| [Programmable-Air Code](https://github.com/Programmable-Air/Code/tree/7c68faa50ebe743aa154ee012f0df12db1af8366) | `7c68faa50ebe743aa154ee012f0df12db1af8366` | MIT, per [`LICENSE.md`](https://github.com/Programmable-Air/Code/blob/7c68faa50ebe743aa154ee012f0df12db1af8366/LICENSE.md) |
| [Programmable-Air PCB](https://github.com/Programmable-Air/PCB/tree/c271d4bf15ba188649e381c4ba6c5f9d07178b39) | `c271d4bf15ba188649e381c4ba6c5f9d07178b39` | MIT, per [`LICENSE`](https://github.com/Programmable-Air/PCB/blob/c271d4bf15ba188649e381c4ba6c5f9d07178b39/LICENSE) |
| [arduino-timer](https://github.com/contrem/arduino-timer/tree/2adf6b16ac2a2ab1571acd8c4b3d0699311e60e1) | `2adf6b16ac2a2ab1571acd8c4b3d0699311e60e1` | 3-Clause BSD |
| [OpenSourcePneumaticSystem](https://github.com/MillerLabFTW/OpenSourcePneumaticSystem/tree/8b55f98f27f7d02566b5cc4749f13a40ef3241b3) | `8b55f98f27f7d02566b5cc4749f13a40ef3241b3` | GPL-3.0, per repository `LICENSE` |
| [pneuduino](https://github.com/oujifei/pneuduino/tree/db4bf714d8fc85b1c3f59aad6928a6595c40812d) | `db4bf714d8fc85b1c3f59aad6928a6595c40812d` | The repository root has no license file. The included `library/PneuDuino/license.txt` is an Adafruit BSD license; it does not establish a license for all PneuDuino-authored code. |
| [Arduino Servo](https://github.com/arduino-libraries/Servo/tree/440b319ec11ea2664df8ce201c271c935de28a2d) | `440b319ec11ea2664df8ce201c271c935de28a2d` | LGPL-2.1-or-later, stated in the source and `LICENSE.txt` |

This assessment also uses the local [Phase 3A Step 1 control analysis](./phase-3a-step1-control-analysis.md), [Phase 2D protocol validation](./phase-2d-protocol-validation.md), [unified simulation firmware](../firmware/unified/nature_touch_unified/nature_touch_unified.ino), and [PROGMEM timelines](../firmware/unified/nature_touch_unified/experience-timelines.h) as the Nature Touch baseline.

## 1. Project comparison

| Project | Relevant implementation | Nature Touch fit | Classification |
|---|---|---|---|
| Programmable-Air Code and PCB | `initializePins`, `blow`, `vent`, `suck`, `closeAllValves`, `switchOffPumps`, plus board-specific schematics and lessons | Best practical reference for separating pump commands from valve-routing commands and for explicitly initializing outputs. It targets its own transistor-driven pump/solenoid PCB, pin map, supply, and plumbing—not the unknown RC-style switch modules in Nature Touch. Its lesson timing uses blocking pressure-reading delays; the code library does not provide a replacement for Nature Touch's scheduler. | **3. Reference only** |
| Programmable-Air PCB | Nano-based master/slave board, schematic and board files for its own pump, valve, and IO hardware | Useful for understanding why output-driver circuitry and power routing must be assessed as a complete system. Its Nano, board revision, valve drivers, and supply design are not evidence about the existing Nature Touch wiring. | **3. Reference only** |
| arduino-timer | Cooperative fixed-slot task scheduler; `in`, `at`, `every`, `tick`, and `cancel` | Supports bounded tasks and cancellation without dynamic allocation, but duplicates existing functionality. Default capacity is 16 tasks; reducing task count reduces static storage. No pneumatic behavior or safety mechanism is supplied. | **3. Reference only** |
| MillerLab Open Source Pneumatic System | Industruino/Indio DAC outputs, analog pressure inputs, Processing serial GUI, and persistent DAC writes | A different proportional-pressure instrument architecture using a 24 V Industruino system and pressure converters. It does not implement Nature Touch's pump/valve outputs or a compatible Nano driver. | **4. Not suitable for code reuse; reference only for pressure-feedback concepts** |
| PneuDuino | I2C master/extension-board API, valve state functions, sensor polling and pressure regulation | Offers useful state naming and feedback concepts, but requires its custom PneuDuino boards, I2C topology, PWM driver, and pressure sensors. The Wave example is tied to those valves; project-authored licensing is unclear. | **3. Reference only** |
| Arduino Servo | AVR timer-interrupt pulse generation; `attach`, `write`, `writeMicroseconds`, and `detach` | Explains what the legacy sketches ask a servo signal pin to do. It does not define the electrical behavior of the unknown RC-style electronic switches, nor does it supply an actuator-off command. | **3. Reference only** |

No code is recommended for direct copying into the current firmware. None of the reviewed projects establishes the correct signal polarity, no-signal behavior, reset state, or safe physical OFF state of Nature Touch's unidentified switch modules.

## 2. Pneumatic control patterns and source findings

### Programmable-Air

The library source declares project-specific pump pins 10 and 11 and a valve map selected by `BOARD_VER`; its board version 6 uses a different valve ordering from the legacy default. `initializePins()` configures all nine valve pins and both pump pins as outputs and writes them LOW. That is an initialization policy for the Programmable-Air board and its drivers only—not a transferable OFF polarity for Nature Touch.

The API keeps functions distinct:

- `blow(i)`, `vent(i)`, `ventQuick(i)`, and `suck(i)` select combinations of a board's three valve outputs.
- `switchOnPump()` / `switchOnPumps()` use `analogWrite()` to command pump outputs.
- `switchOffPump()` / `switchOffPumps()` write LOW to pump outputs.
- `closeAllValves()` writes LOW to the mapped valve outputs.

These are explicit software commands, but they are not one atomic system-wide stop: the caller must stop pumps and separately choose valve routing. No independent hardware cutoff or pressure-limit guarantee is established by these helpers.

The lessons illustrate the usage rather than adding a protocol or non-blocking scheduler:

- [`Lesson_1_Vent.ino`](https://github.com/Programmable-Air/Code/blob/7c68faa50ebe743aa154ee012f0df12db1af8366/examples/Lesson_1_Vent/Lesson_1_Vent.ino) describes the initial pump/valve state as off and calls `vent()`.
- [`Lesson_2_Blow.ino`](https://github.com/Programmable-Air/Code/blob/7c68faa50ebe743aa154ee012f0df12db1af8366/examples/Lesson_2_Blow/Lesson_2_Blow.ino) turns on pump 2 while a button is held; otherwise it switches off both pumps and vents.
- [`Lesson_3_Suck.ino`](https://github.com/Programmable-Air/Code/blob/7c68faa50ebe743aa154ee012f0df12db1af8366/examples/Lesson_3_Suck/Lesson_3_Suck.ino) similarly selects pump 1 and `suck()`, or stops pumps and vents.
- [`Lesson_4_TimingControl.ino`](https://github.com/Programmable-Air/Code/blob/7c68faa50ebe743aa154ee012f0df12db1af8366/examples/Lesson_4_TimingControl/Lesson_4_TimingControl.ino) runs a button-controlled sequence, but its pressure display helper blocks during each timed phase.
- [`Lesson_5_Serial_Input.ino`](https://github.com/Programmable-Air/Code/blob/7c68faa50ebe743aa154ee012f0df12db1af8366/examples/Lesson_5_Serial_Input/Lesson_5_Serial_Input.ino) reads a `String` using `Serial.readString()` and then changes pump/valve commands. It has no disconnect watchdog or protocol-v2 request/response semantics; it is not a suitable serial reliability pattern.
- [`Lesson_7_External_Pump.ino`](https://github.com/Programmable-Air/Code/blob/7c68faa50ebe743aa154ee012f0df12db1af8366/examples/Lesson_7_External_Pump/Lesson_7_External_Pump.ino) drives the board's `load` output for an external pump; its comments specify a separate 12 V connection. This is especially hardware-specific.

Although `switchOffPumps()` and `closeAllValves()` exist, the examples do not combine them into a verified emergency stop that accounts for pressure, loads, and valve safe state. The API also does not prevent all conflicting states by construction; caller sequencing matters.

### PneuDuino

The PneuDuino library implements a different board stack. `PneuDuino::begin()` initializes its LED/PWM driver and I2C bus; `update()` scans and polls extension nodes and sends changed valve states. `in(address, side)` and `out(address, side)` update requested valve-side bits. The ValveOnOff README defines `in` as connecting output to supply and `out` as connecting output to exhaust. These are pneumatic routing meanings, not universally safe electrical states.

The API also exposes `inflate`, `deflate`, `hold`, `setPressure`, and `readPressure`. `checkNodes()` periodically compares pressure with the set point and changes among inflate/hold/deflate states. This is closed-loop behavior for the PneuDuino pressure sensor and valve boards, not a general independent overpressure safety circuit. Its `Wave.ino` computes per-valve on/off times and explicitly calls `out()` to reset valves at cycle boundaries, but repeatedly makes state requests from `loop()` and relies on `p.update()` and the custom hardware to apply them.

The code includes `Adafruit_PWMServoDriver` and `Adafruit_ADS1015`, uses Wire/I2C, and carries arrays for multiple node, valve, and pressure states. It is not a drop-in implementation for three servo-style input modules, and its SRAM and runtime costs have not been measured on the Nano for this project. The upstream README itself describes the toolkit as work in progress. Do not reuse the PneuDuino-authored source until its licensing status is clarified; the nested Adafruit BSD notice should not be read as a blanket license for the repository.

### MillerLab

The repository README specifies an Industruino IND.I/O and typically 24 V pneumatic setup, including an IP converter / proportional pressure regulator. `PneumaticFirmware.ino` uses `Indio.analogWrite()` and `Indio.analogRead()` rather than the Nature Touch D5/D6/D7 signal path. Its firmware processes serial input and continuously emits measurement/control strings, but the reviewed implementation has no Protocol v2 `STOP` or host-disconnect-safe shutdown path. The source comments say the DAC writes use a flag to restore the values after power cycling. This is a material, system-specific persistence behavior, not a safe-off pattern to import. The project is GPL-3.0; reuse or adaptation would also need a deliberate license-compatibility decision.

### Arduino Servo semantics

For AVR, `Servo::write()` maps a degree value to pulse width and stores that value for the timer-driven output. With the library defaults, endpoints correspond approximately to 544 and 2400 microseconds; `write(90)` is a middle position, not “off”. The exact servo-signal-to-switch/load interpretation belongs to the receiver module, not Servo.

`Servo::detach()` marks the channel inactive and stops its timer pulse generation when no other channel uses the timer. The AVR implementation does not define that an attached RC switch turns off, that a detached pin becomes a safe logic level, or what happens inside an external module after pulses stop. Neither `write(0)`, `write(90)`, `write(180)`, nor `detach()` is an established Nature Touch OFF action.

## 3. Timing, state management, and reliability comparison

The existing unified firmware already uses a non-blocking `millis()` deadline scheduler over fixed action tables in `PROGMEM`. `processScheduler()` advances at most the due timeline action, preserves the existing protocol state machine, and permits serial processing while a simulated operation is active. STOP cancels further scheduled timeline events and emits the existing STOPPED event. These behaviors have already been validated in simulation-protocol tests and during Phase 2D physical Nano protocol testing; neither test exercised pneumatic outputs.

`arduino-timer` is also cooperative and statically allocated. Its full example demonstrates one-task cancellation and loop-driven `tick()`, and the library explicitly documents the fixed task limit and absence of dynamic allocation. Its task structures and handler slots consume RAM; the default is 16 slots. From the AVR field types in the source, that default task array is approximately 256 bytes (16 slots × 16 bytes, before any other application storage); this is a source-based estimate, not a Nature Touch compile measurement. A small explicit task count could bound that cost, but introducing the library would add a dependency and another scheduling abstraction without improving the current single-timeline scheduler. **Keep the Nature Touch scheduler unchanged.**

Neither the reviewed examples nor library source establish all of the following for unknown Nature Touch electronics: safe output state before firmware setup, safe state during reset/brownout, a physical power cut after serial loss, safe behavior when the host disconnects mid-operation, verified mutual exclusion of actuators, or pressure limits. A firmware state transition or serial STOP is not an independent hardware protection.

## 4. Hardware and Nano compatibility

| Consideration | Assessment |
|---|---|
| Nano / ATmega328P | The unified firmware already targets and has previously compiled for the classic Nano. The timer library is header-only and fixed-capacity, but no reason exists to add it. Servo supports AVR timer-based pulses, but using it does not validate compatibility with the actual RC modules. PneuDuino's Arduino/Wire dependencies do not make its custom boards and complete resource use interchangeable with this system. |
| Output driver | Programmable-Air uses its own pin map and pump/valve driver circuitry. PneuDuino uses custom I2C extension boards and a PWM driver. MillerLab uses Industruino analog outputs and pressure converters. None matches the undocumented switch module just because it has an Arduino-compatible controller. |
| USB-only power | The user has reported USB as the power source for the existing system. The Programmable-Air and MillerLab examples use their own hardware and power architecture; they do not prove the Nature Touch loads are within USB, Nano, switch-module, cable, or connector limits. USB connection is not actuator isolation in the reported setup. |
| Additional sensors | The reviewed pressure-regulation examples depend on pressure sensors and project-specific calibration. Nature Touch's current validated scheduler has no verified pressure sensor or independent limit switch; do not imply closed-loop protection exists. |
| SRAM / flash | No alternative control library was compiled against the Nature Touch sketch for this review. The PneuDuino header alone declares six 13-element `int` state arrays plus a 12-element `int` LED map (at least 180 bytes for those arrays on AVR, before object/library storage); `arduino-timer`'s default 16-task array is approximately 256 bytes on AVR. These are source-based estimates, not build results. The previous Nano build reported 9,270 B Flash and 1,294 B global SRAM, with 754 B remaining. Those figures are the existing simulation firmware baseline, not a measurement for any proposed physical-output implementation. |

## 5. Existing firmware versus open-source implementations

Nature Touch's [three legacy sketches](../卒研music/) attach Servo channels to D5, D6, and D7 and issue the `inflate()` / `deflate()` pulse-position commands documented in the [Step 1 analysis](./phase-3a-step1-control-analysis.md). They begin cycling automatically and have no serial STOP, pressure feedback, stop-all routine, or verified OFF state.

The unified sketch intentionally has no Servo include, `attach`, GPIO mode setup, or GPIO writes. Its D5/D6/D7 values are diagnostic event fields with `hardwareOutputsEnabled:false`; they are not electrical commands. Its [WIND, WAVE, and BUBBLE sequences](../firmware/unified/nature_touch_unified/experience-timelines.h) remain in `PROGMEM`. The Phase 2D report records exact action counts and final timeline offsets matching for all three simulated flows.

The reviewed projects do not justify replacing Protocol v2, altering those timelines, or adding a new scheduler. Their main value is architectural vocabulary: keep valve routing and pump state explicit, initialize outputs deliberately, and make any future stop routine enumerate every controlled output. The actual pin levels and transition behavior must first be established for the Nature Touch hardware.

## 6. Reuse decisions by source

### Recommended patterns (conceptual only)

1. **Programmable-Air `initializePins()` pattern:** initialize every output before any operational state transition. Adapt only after the actual RC-switch signal and safe level are measured; do not copy its `LOW` assignments.
2. **Programmable-Air separation of pump and valve APIs:** future hardware control should represent each output role explicitly rather than mixing pump control and valve routing in an opaque sequence.
3. **Programmable-Air explicit shutdown helpers:** define and review a complete stop policy that accounts for every output. The existing functions `switchOffPumps()` and `closeAllValves()` are not themselves a proven Nature Touch stop policy.
4. **PneuDuino feedback concept:** use pressure feedback only if appropriate sensors and an independently defined pressure limit become part of the reviewed hardware. Software regulation alone is not a pressure safety device.

### Keep unchanged

- Protocol v2 message schemas, request/operation handling, and serial framing.
- Existing non-blocking timeline scheduler.
- All WIND, WAVE, and BUBBLE timing values and sequences.
- Simulation-only output behavior and the disabled state of D5/D6/D7.
- The USB-only design preference, pending power-path and load-rating verification.

Do not add `arduino-timer`, Servo output calls, PneuDuino modules, or another project's output polarity in Step 2A. No implementation is authorized by this review.

## 7. Minimal integration proposal and remaining safety requirements

The smallest safe next development step is **not to enable actuators**. First identify the installed switch modules and establish their input truth table without an actuator load:

1. Record module markings, board revision, connector/power pins, the Nano-to-module signal wiring, and the USB-to-load power path with all actuator power disconnected. Because USB reportedly powers the whole system, unplugging USB is required for de-energized inspection; plugging USB back in is not an isolation measure.
2. Determine from manufacturer documentation or qualified bench measurement the signal range, pulse/no-pulse behavior, reset/brownout behavior, load-side switching topology, and the module's actual inactive state. Do not infer this from prior successful operation or from Servo positions.
3. Have a qualified operator verify the output with modules powered only as necessary and a suitable dummy load or electrical measurement arrangement, not a pump, valve, or pneumatic load. Keep the existing actuator power path physically isolated during signal-state verification.
4. Separately document supply voltage/current limits, per-load startup and stall current, common-ground/reference requirements, module ratings, pressure limits, and a physically independent power cutoff. The user-reported USB-only success does not replace these checks.
5. Only after those facts are reviewed should a separately approved implementation proposal define the measured safe initialization level and an all-output stop policy. Review it before any physical actuation. Do not proceed to Phase 3A Step 2B without explicit approval.

**Blocking safety issues:** the switch model and electrical OFF/no-signal/reset behavior are unknown; USB is also reported to supply the actuator system; and there is no verified independent pressure or actuator power cutoff. Until resolved, no firmware pattern in these projects makes it safe to connect or activate the pumps or solenoid.

## 8. Source index

Links below point to the exact reviewed commits:

- Programmable-Air [`src/programmable_air.cpp`](https://github.com/Programmable-Air/Code/blob/7c68faa50ebe743aa154ee012f0df12db1af8366/src/programmable_air.cpp), [`src/programmable_air.h`](https://github.com/Programmable-Air/Code/blob/7c68faa50ebe743aa154ee012f0df12db1af8366/src/programmable_air.h), and [examples](https://github.com/Programmable-Air/Code/tree/7c68faa50ebe743aa154ee012f0df12db1af8366/examples).
- Programmable-Air PCB [README](https://github.com/Programmable-Air/PCB/blob/c271d4bf15ba188649e381c4ba6c5f9d07178b39/README.md), [`programmable-air-v0.5/schematic.pdf`](https://github.com/Programmable-Air/PCB/blob/c271d4bf15ba188649e381c4ba6c5f9d07178b39/programmable-air-v0.5/schematic.pdf), and [board files](https://github.com/Programmable-Air/PCB/tree/c271d4bf15ba188649e381c4ba6c5f9d07178b39/programmable-air-v0.5).
- arduino-timer [`src/arduino-timer.h`](https://github.com/contrem/arduino-timer/blob/2adf6b16ac2a2ab1571acd8c4b3d0699311e60e1/src/arduino-timer.h), [full example](https://github.com/contrem/arduino-timer/blob/2adf6b16ac2a2ab1571acd8c4b3d0699311e60e1/examples/full/full.ino), and [README](https://github.com/contrem/arduino-timer/blob/2adf6b16ac2a2ab1571acd8c4b3d0699311e60e1/README.md).
- MillerLab [`PneumaticFirmware.ino`](https://github.com/MillerLabFTW/OpenSourcePneumaticSystem/blob/8b55f98f27f7d02566b5cc4749f13a40ef3241b3/PneumaticFirmware/PneumaticFirmware.ino), [README](https://github.com/MillerLabFTW/OpenSourcePneumaticSystem/blob/8b55f98f27f7d02566b5cc4749f13a40ef3241b3/README.md), and [`LICENSE`](https://github.com/MillerLabFTW/OpenSourcePneumaticSystem/blob/8b55f98f27f7d02566b5cc4749f13a40ef3241b3/LICENSE).
- PneuDuino [`PneuDuino.cpp`](https://github.com/oujifei/pneuduino/blob/db4bf714d8fc85b1c3f59aad6928a6595c40812d/library/PneuDuino/PneuDuino.cpp), [`PneuDuino.h`](https://github.com/oujifei/pneuduino/blob/db4bf714d8fc85b1c3f59aad6928a6595c40812d/library/PneuDuino/PneuDuino.h), [ValveOnOff](https://github.com/oujifei/pneuduino/tree/db4bf714d8fc85b1c3f59aad6928a6595c40812d/examples/ValveOnOff), [Wave](https://github.com/oujifei/pneuduino/tree/db4bf714d8fc85b1c3f59aad6928a6595c40812d/examples/Wave), and [root README](https://github.com/oujifei/pneuduino/blob/db4bf714d8fc85b1c3f59aad6928a6595c40812d/README.md).
- Arduino Servo [`src/avr/Servo.cpp`](https://github.com/arduino-libraries/Servo/blob/440b319ec11ea2664df8ce201c271c935de28a2d/src/avr/Servo.cpp), [`src/Servo.h`](https://github.com/arduino-libraries/Servo/blob/440b319ec11ea2664df8ce201c271c935de28a2d/src/Servo.h), and [`LICENSE.txt`](https://github.com/arduino-libraries/Servo/blob/440b319ec11ea2664df8ce201c271c935de28a2d/LICENSE.txt).

## 中文总结

1. **最佳参考：** Programmable-Air Code。它把泵控制、阀路选择、初始化和关闭操作分开，并配有对应电路图；但只能借鉴设计思路，不能把其 `LOW` 状态或引脚映射套用到 Nature Touch。
2. **可借鉴的具体模式：** `initializePins()` 的“先明确初始化全部输出”思路；`switchOffPumps()`、`closeAllValves()` 所体现的“停止时逐项覆盖所有输出”；必要时参考 PneuDuino 的压力反馈概念。所有具体输出电平都必须等实际模块测量后再定义。
3. **应保持不变：** Protocol v2、非阻塞调度器、WIND/WAVE/BUBBLE 时间线、当前仿真输出禁用状态，以及 USB-only 方案（等待电气验证）。不需要引入定时库或重写架构。
4. **仍需实测：** RC 开关型号、脉冲范围、无信号/复位/掉电行为、可靠 OFF 电平、USB 至执行器的供电路径、负载电流/额定值、压力边界和独立断电措施。
5. **最小安全下一步：** 先断开 USB 并检查模块标识与供电/接线；随后在执行器电源保持隔离的条件下，用合适的 dummy load 或测量设备确认模块输入真值表和失效行为。未完成安全评审并获批准前，不实施 Step 2B，也不连接或驱动气动负载。
