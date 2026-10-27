# Nature Touch Phase 3A / Step 2B: Existing Hardware Integration Review

## Scope and evidence

This document is an analysis-only integration specification. No firmware or wiring was changed, no serial port was opened, no outputs were enabled, and no actuator was operated.

Evidence sources:

- [Existing hardware and media analysis](./hardware-analysis.md)
- [Phase 3A Step 1 legacy-control analysis](./phase-3a-step1-control-analysis.md)
- [Phase 3A Step 2A open-source review](./phase-3a-step2a-opensource-review.md)
- Original [WIND](../卒研music/wind/sketch_oct21a/sketch_oct21a.ino), [WAVE](../卒研music/ocean%20waves/sketch_oct21b/sketch_oct21b.ino), and [BUBBLE](../卒研music/bubbles/sketch_sep30a/sketch_oct21a.ino) sketches
- [Unified simulation firmware](../firmware/unified/nature_touch_unified/nature_touch_unified.ino) and [experience timelines](../firmware/unified/nature_touch_unified/experience-timelines.h)

The pin-to-device mappings, module type description, and USB-powered operating history below are user-reported and captured in the existing hardware analysis. They have not been independently checked by tracing this unit's wiring or measuring it. The repository has an infographic describing intended tactile patterns, but no usable photograph or schematic of the Nano, shield, switch modules, load wiring, or power distribution. The infographic is not electrical evidence.

## 1. Confirmed wiring and control mapping

The original sketches attach `Servo` objects to D5, D6, and D7. The existing hardware analysis records the user's physical identification of these channels as follows:

| Nano pin | Reported device association | Source-level signal command in legacy sketches |
|---|---|---|
| D5 | Solenoid air valve | `inflate()`: `Servo.write(180)`; `deflate()`: `Servo.write(0)` |
| D6 | Suction pump, recorded as SC-3704PM-A DC 6 V micro air pump | `inflate()`: `Servo.write(180)`; `deflate()`: `Servo.write(0)` |
| D7 | Inflation pump, recorded as SC-3704PM-A DC 6 V micro air pump | `inflate()`: `Servo.write(0)`; `deflate()`: `Servo.write(180)` |

All three sketches use the same `inflate()` and `deflate()` writes. The user-reported hardware has a small three-wire-input/two-wire-output RC-style switch module on each channel. Exact module model, input pinout, actual signal connections, supply wiring, and load-side wiring are not established. Servo angles are pulse-position commands; they are not GPIO HIGH/LOW levels.

### Inferred control truth table — every actuator state is UNVERIFIED

The mode names show the intent of each helper, but do not prove which pump or valve is actually energized. The table distinguishes the exact command from possible interpretations:

| Helper / intent | Pin and attached device | Legacy command | If (and only if) `write(180)` means switch ON | If (and only if) `write(0)` means switch ON |
|---|---|---:|---|---|
| `inflate()` | D5, solenoid valve | 180 | Valve switch may be ON; valve's pneumatic state remains unknown | Valve switch may be OFF |
| `inflate()` | D6, suction pump | 180 | Suction pump may be ON — counterintuitive for a fill phase | Suction pump may be OFF |
| `inflate()` | D7, inflation pump | 0 | Inflation pump may be OFF | Inflation pump may be ON — consistent with the device label |
| `deflate()` | D5, solenoid valve | 0 | Valve switch may be OFF | Valve switch may be ON; valve's pneumatic state remains unknown |
| `deflate()` | D6, suction pump | 0 | Suction pump may be OFF | Suction pump may be ON — consistent with the device label |
| `deflate()` | D7, inflation pump | 180 | Inflation pump may be ON — counterintuitive for a deflate phase | Inflation pump may be OFF |

The pump labels make “0 is ON” a plausible interpretation of the pump channels, while “180 is ON” would invert the apparent pump roles. This is only an inference from names and command patterns. The modules may use other pulse windows, may have independent polarity/configuration, or may not behave as simple on/off switches. The D5 solenoid's ON state also does not tell us whether the pneumatic path is open, closed, or safe; that depends on the valve's mechanics and plumbing.

**No ON/OFF assignment in this truth table is verified.** Do not use any listed value as a safe command or use the legacy mode names as a substitute for electrical measurement.

## 2. USB power topology and uncertainties

### Connection diagram

Legend: `──>` denotes an association reported by the user and/or encoded in the legacy sketch, but not independently continuity-tested on this unit. `- - ?>` is an unknown power or reference path.

```text
Windows laptop
    │
    └── USB cable ──> Arduino Nano / expansion shield
                         │
                         ├── D5 signal ──> RC-style switch module ──> solenoid valve
                         ├── D6 signal ──> RC-style switch module ──> suction pump
                         └── D7 signal ──> RC-style switch module ──> inflation pump

Unverified electrical supply/reference paths:

USB VBUS / Nano power  - - ?>  switch-module logic supply
USB-derived or other rail - ?> switch-module switched-load supply
Nano ground          - - ?>  module input reference / load return
Load output pair     - - ?>  each actuator's other supply/return conductor

No separate power adapter is reported in the existing configuration, but the
exact route from USB power to each module and actuator is unknown.
```

The user confirms the current single-USB configuration has previously operated and that the laptop's USB supplies system power as well as serial communication. That history does **not** show whether actuator current passes through the Nano or shield, whether the modules switch USB-derived power or another board rail, whether any conversion/current limiting is present, or whether the reported pumps' nominal voltage is compatible with the actual rail. Do not infer a voltage, current rating, common ground, galvanic isolation, or load-side polarity from the connector appearance or successful past operation.

Before any powered test, trace and record both sides of each module: signal/reference/power at the three-wire input and switched supply/return at the two-wire output. The signal ground, module logic supply, actuator supply, Nano ground, and USB return must be recorded separately rather than assumed common.

## 3. Required OFF-state and stop verification

The current unified firmware has no Servo library, pin configuration, `attach`, `pinMode`, `digitalWrite`, or actuator control path. It is simulation-only. Its STOP cancels scheduled simulation events; it is not evidence that a future hardware driver can stop a pump, change a valve, remove pressure, or interrupt power.

Before defining `stopAll()`, establish all of the following from the actual modules and system:

- The module's accepted pulse widths, frequency/timing range, input voltage limits, and behavior for each relevant signal command.
- The electrical and load-side meaning of “off,” including whether the output is open, energized, latched, or otherwise active when the signal is absent.
- Behavior during Nano startup, reset, brownout, bootloader delay, MCU pin high-impedance state, and USB cable removal/reconnection.
- Whether a module retains its last state, defaults to an active state, or drops out when its logic supply or input signal disappears.
- Whether the module can safely switch the pump/solenoid's voltage, continuous current, startup/stall current, and inductive transients; and whether protection is present.
- The solenoid valve's normal/mechanical state and the effect of loss of power, plus the pneumatic consequences of every valve state.
- The actuator power route, available current, return paths, and an independent physical cutoff.
- The allowed pressure range and independent pressure-relief/limit method for the airbag, valve, tubing, fittings, and human-contact use.

`Servo.write(0)`, `Servo.write(90)`, `Servo.write(180)`, `detach()`, a floating input, or digital `LOW` cannot be designated OFF until those properties are identified and tested. A software `STOPPED` event can at most indicate that firmware completed its defined command procedure; without output/state feedback, it cannot certify that an actuator is physically de-energized.

### Stop requirements by situation

| Situation | Required future behavior | Preconditions before implementation |
|---|---|---|
| Normal STOP | Stop issuing future timeline actions; cancel pending output transitions; command the measured stop state for every channel; prevent a later event from restarting the operation. Only report completion according to the agreed Protocol v2 semantics. | Verified state for each module/load, complete stop sequence, stop-command timing, and defined fault response if the command cannot be confirmed. |
| Inflation ↔ suction transition | Use break-before-make: stop the currently active pump using its verified control, allow only a measured/electrically justified transition interval if required, establish the verified valve route, then enable the other pump. Never rely on adjacent timeline events being mutually safe by assumption. | Pump identity and direction verified; module turn-off delay and residual pneumatic behavior measured; interlock rules and any necessary valve sequence reviewed. |
| Mode switching | Do not apply a new mode's first action while any previous operation/output may still be active. Require the previous operation to complete or to pass through the verified stop path before accepting the next hardware sequence. Preserve the existing Protocol v2 state machine/schema. | A hardware-aware operation lifecycle and a tested all-output stop transition. |
| Arduino startup/reset | Keep actuation inhibited until output hardware, input references, and a known safe state are established. Do not auto-start on boot. Account for the interval before `setup()` configures pins. | Verified reset/bootloader behavior and a hardware default state that cannot energize loads during MCU high impedance; otherwise require an independent enable/cutoff interlock. |
| USB disconnection | Treat serial loss and power loss as distinct cases. If Nano remains powered, detect loss of host control and enter the defined local stop policy; if USB powers the whole system, determine what the modules and loads do as the rail collapses. Never auto-resume after reconnect/reset. | Verified power topology and no-signal/reset behavior, a bounded loss-of-control policy, and a physical power cutoff independent of the USB/serial link. |
| Lost control signal | The module and driver must reach a characterized inactive state, or a separately validated hardware enable/cutoff must remove actuator energy. A watchdog alone is not sufficient if it cannot force the electrical load off. | Module failsafe truth table under signal loss, tested under dummy load, and independent shutdown means. |

## 4. Minimal inspection and measurement plan

The steps below preserve the existing Nano and USB-only design if its limits are verified. No commercial purchase link or specific product is required.

### Checks from existing files (no hardware operation)

1. Preserve the three original sketches as behavioral references; do not upload them for diagnosis. Record their matching write patterns and timeline durations.
2. Keep the unified firmware simulation-only. Its action events and `hardwareOutputsEnabled:false` describe software behavior only.
3. Use the existing hardware analysis for the reported device mapping and recorded pump model/nominal voltage; treat module specifications and wiring as unknown until inspected.
4. Record the repository evidence gap: only the tactile-pattern infographic is available as an image; no electrical schematic or hardware wiring photograph was found.

### Physical checks requiring a qualified person and measurement

1. **De-energized inventory:** Unplug the USB cable and ensure every possible source is disconnected before continuity/resistance checks. Photograph the actual Nano/shield, module labels, wire colors/terminal labels, actuator connectors, and all supply branches. Record module manufacturer/part markings and board revision. Do not treat plugging USB back in as actuator isolation.
2. **Trace the topology:** With power off, trace each Nano pin to the corresponding module input and each two-wire output to the reported load. Trace supply and return conductors separately from signal wiring. Note any board traces, jumpers, regulators, protection parts, and shared grounds. Do not infer these from wire color.
3. **Identify specifications:** Locate component markings/datasheets where possible. Record module signal limits and failsafe behavior, supply ratings, pump startup/stall requirements, solenoid coil characteristics, and wiring/connector ratings. Unknown or unreadable specifications remain unresolved rather than being guessed.
4. **Characterize the module without actuators:** Keep pumps and solenoid physically disconnected from the module outputs. A qualified person can power only the necessary control/module circuit from an appropriate current-limited lab setup and use a suitably rated electrical dummy load and measurement equipment. Test the input conditions relevant to the legacy commands plus no signal, module power-up/down, and control reset/loss. Record input pulse parameters, output voltage/current/state, and transition delays. Do not connect the Nano to an unidentified input until voltage/reference compatibility is established.
5. **Verify shutdown:** Demonstrate with the dummy load that each defined inactive command and signal-loss/reset condition removes the relevant output energy. If it does not, identify what independent hardware enable/cutoff is needed. A meter reading at an unloaded output alone may not establish that the module can turn off a real load.
6. **Power budget and protections:** Measure the existing USB-powered system's supply branches and current under a controlled, non-actuating setup; verify Nano/shield, USB cable/host, modules, connectors, wiring, and load requirements. Confirm whether power conversion exists and whether the USB port is being asked to supply actuator current. Establish an accessible independent actuator-power cutoff and a pressure limiter/relief strategy based on verified component limits.
7. **Review evidence before proceeding:** Save a wiring diagram, measurements, instrument/setup details, and unresolved items. Have a qualified reviewer check the results before any test with real actuators or pneumatic pressure.

No pumps, solenoid, or connected pneumatic load should be used in these characterization steps. If a safe dummy-load arrangement or module input specification cannot be established, stop and resolve that with a qualified electronics person before proceeding.

## 5. Future integration architecture (proposal only)

Keep the Protocol v2 parser, schemas, request cache, operation history, non-blocking scheduler, and all timeline values unchanged. The scheduler should continue to emit semantic action intent; a separately gated hardware adapter may later translate that intent after the safety preconditions are complete.

Proposed interface responsibilities (not implemented; no signal values specified):

```text
initializeOutputs()
    Keep actuation inhibited during MCU startup.
    Initialize each output only using the verified electrical-safe policy.
    Report success/failure to the integration layer; never assume a library default is safe.

inflate()
    Apply only the reviewed inflation sequence for the verified D5/D6/D7 hardware.
    Enforce the mutually exclusive pump rule and required valve ordering.

deflate()
    Apply only the reviewed deflation sequence for the verified D5/D6/D7 hardware.
    Enforce the mutually exclusive pump rule and required valve ordering.

stopAll()
    Cancel pending output actions; stop all pump channels; place the valve in its
    verified state; assert a verified hardware disable/cutoff if available.
    Prevent auto-resume. Surface a fault if the stop procedure cannot be established.
```

These are intent-level responsibilities, not safe implementation instructions. Do not bind them directly to the existing `inflate` boolean or diagnostic D5/D6/D7 values until the real hardware truth table is verified. Preserve the existing timeline schedule and protocol; only the mapping layer is a possible future change.

`initializeOutputs()` must not be written using guessed `pinMode`, Servo attach/write, or `LOW` values. If the hardware cannot be kept inactive before firmware initialization, a suitable hardware default/enable interlock must be designed and verified before integrating outputs.

## 6. Exact prerequisites before physical actuator testing

All items below are blocking. No physical actuator test is authorized by this analysis.

- [ ] Physical wiring and supply topology has been traced and documented, including Nano/shield, all three modules, loads, signal references, power rails, and returns.
- [ ] Each module is identified, or its input/output behavior is fully characterized by a qualified person if identification is impossible.
- [ ] Input compatibility, pulse thresholds, output topology, continuous/startup current capability, inductive protection, reset behavior, power-loss behavior, and no-signal behavior are known.
- [ ] The actual inactive/off state for each of the three channels has been demonstrated using a suitable dummy load; no Servo value or detach assumption is used as evidence.
- [ ] Transition timing and a break-before-make policy have been validated without pneumatic actuators.
- [ ] Startup, reset, USB disconnect, host disconnect, reconnect, and lost-signal cases have a defined non-resuming stop policy; high-impedance boot behavior cannot unexpectedly energize a load.
- [ ] USB and board power budgets, cable/connector limits, module/load ratings, and pump/solenoid current requirements are documented and compatible. USB-only power is retained only if measured margins support it.
- [ ] An accessible actuator power cutoff independent of software/USB is installed or otherwise verified for any future live test.
- [ ] The pneumatic circuit, maximum permissible pressure, regulator/relief method, tubing/fitting ratings, and safe depressurization procedure are independently reviewed.
- [ ] A future hardware firmware change is separately approved, reviewed, and tested with outputs disabled and dummy loads before any actuator is connected. No upload is to happen automatically.

Until these prerequisites are satisfied, keep the current unified firmware in simulation-only mode and do not proceed to Phase 3A Step 3.

## 中文总结

- **已确认但未独立测量：** 用户报告 D5 对应电磁阀、D6 对应吸气泵、D7 对应充气泵；三个旧草图的 `inflate()` 都写入 180/180/0，`deflate()` 都写入 0/0/180。仓库现有图像只有触觉模式信息图，没有实际接线照片或电路图。
- **推断但未验证：** 若 0 才是模块激活命令，两个泵的推测方向与“充气/排气”命名较吻合；若 180 激活则泵的推测方向反过来。阀门状态还取决于阀的机械结构和气路，因此两种解释都不能作为事实。
- **USB 供电：** 单 USB 曾运行成功是用户报告，不足以说明泵电流经过何处、各模块如何供电、Nano 与负载是否共地，或系统是否在额定范围内。必须追线和测量。
- **最小安全路径：** 先断开 USB 做无电检查并记录模块标识和供电路径；再由合格人员在执行器断开的条件下，以合适的限流供电、dummy load 和测量设备验证输入真值表、断信号/复位行为及真实 OFF 状态。
- **阻塞项：** 模块 OFF/失效状态、电源路径、负载额定、独立断电及压力保护尚未验证。当前仿真固件、Protocol v2 和 WIND/WAVE/BUBBLE 时间线应保持不变；本报告没有实现硬件控制，也不授权进入 Step 3。
