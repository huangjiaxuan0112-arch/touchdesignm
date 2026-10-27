# Nature Touch Phase 3A / Step 1: Legacy Hardware Control Analysis

## Scope and evidence

This is a read-only source analysis. The original sketches were located under `卒研music/`; no code was modified, no serial port was opened, no firmware was uploaded, and no actuator command was sent. The physical setup descriptions below are user-reported, not independently measured. The Phase 2D results verified the unified firmware's simulated USB protocol only; they did not test these legacy sketches or establish electrical safety.

No `AGENTS.md` was found in the repository. Sources inspected:

- [Original WIND sketch](../卒研music/wind/sketch_oct21a/sketch_oct21a.ino)
- [Original WAVE sketch](../卒研music/ocean%20waves/sketch_oct21b/sketch_oct21b.ino)
- [Original BUBBLE sketch](../卒研music/bubbles/sketch_sep30a/sketch_oct21a/sketch_oct21a.ino)
- [Unified simulation firmware](../firmware/unified/nature_touch_unified/nature_touch_unified.ino)
- [Unified timeline data](../firmware/unified/nature_touch_unified/experience-timelines.h)
- [Previous hardware/source analysis](./hardware-analysis.md)
- [Phase 2D physical protocol report](./phase-2d-protocol-validation.md)

## 1. Legacy Control Mapping Table

All three sketches include `Servo.h`, declare `servo_5`, `servo_6`, and `servo_7`, and attach them to pins 5, 6, and 7 in `setup()`.

| Phase / helper | D5 (`servo_5`, user identifies valve) | D6 (`servo_6`, user identifies suction pump) | D7 (`servo_7`, user identifies inflation pump) |
|---|---:|---:|---:|
| `inflate(ms)` in all three sketches | `Servo.write(180)` | `Servo.write(180)` | `Servo.write(0)` |
| `deflate(ms)` in all three sketches | `Servo.write(0)` | `Servo.write(0)` | `Servo.write(180)` |

These are Servo-library position commands, not verified digital OFF/ON levels. The source does not identify pulse widths at the switch inputs, module thresholds, resulting load state, or whether any of the three positions is physically safe.

## 2. Existing Inflation and Deflation Logic

The three `inflate(unsigned long ms)` functions have the same ordered writes: D5 to 180, D6 to 180, D7 to 0, followed by blocking `delay(ms)`.

The three `deflate(unsigned long ms)` functions have the same ordered writes: D5 to 0, D6 to 0, D7 to 180, followed by blocking `delay(ms)`.

There are no intervening per-channel decisions, sensor readings, pressure feedback, or interlocks in either helper. Each call changes all three requested positions and then blocks for its requested duration. The labels “inflate” and “deflate” describe the program's intent; they do not prove the physical result of the unknown electronic switches.

## 3. Missing OFF / Shutdown Behavior

### Startup and setup

Each original `setup()` starts serial at 9600 baud, then calls `attach(5)`, `attach(6)`, and `attach(7)`. It does not first command a verified safe state and contains no explicit `Servo.write()` before attachment. The resulting pulse behavior at startup/reset depends on the Servo library and switch-input behavior; the source alone cannot establish that it is OFF.

The first `loop()` begins immediately after setup and performs an inflation/fill action. There is no operator confirmation or command gate before it.

### Between actions and cycle boundaries

Each helper leaves the last commanded Servo positions in effect while `delay()` runs. The next helper changes the positions; no neutralization or output-disable step occurs between actions.

At the end of each cycle, the sketch performs its final `deflate()` delay, prints the `NEXT ... CYCLE` marker, and returns to `loop()`. The next cycle starts automatically. There is no all-actuators-off command between cycles.

### Stop and serial disconnection

None of the original sketches reads serial input (`Serial.available()` / `Serial.read()`), provides a STOP command, or handles USB disconnection as a stop request. A host disconnect therefore cannot request a controlled stop through these sketches. Their control flow continues through blocking delays and repeats; exact effects of host-side disconnect on UART buffering are transport-dependent and do not provide a safety mechanism.

There is no `detach()`, explicit stop-all helper, watchdog shutdown routine, or documented reset/power-loss safe state. In particular, no `Servo.write(0)`, `Servo.write(90)`, `Servo.write(180)`, or detach behavior can be treated as OFF based on these sources.

## 4. Differences Between Original and Unified Firmware

| Behavior | Original sketches | Unified firmware |
|---|---|---|
| Output mechanism | Servo objects attach to D5/D6/D7 and receive `write()` commands | No Servo include, attach, GPIO configuration, or GPIO writes; sketch explicitly describes itself as simulation-only |
| Recorded action values | The values in the legacy mapping table are sent to Servo objects | Timeline entries are read from `PROGMEM` and emitted as diagnostic JSON fields `D5`, `D6`, and `D7`, marked `hardwareOutputsEnabled:false` |
| Start/stop | Starts automatically after reset; no protocol or stop input | Protocol-v2 state machine supports SELECT/START/STOP and finite simulated completion |
| Timing implementation | Blocking helper calls with `delay()` | Non-blocking deadline scheduler; action events represent the calibrated schedule |
| Cycle behavior | Repeats continuously with no off interval | One selected operation completes once; another operation requires a new command |
| Serial | 9600 baud, one-way human-readable cue lines | 9600 baud, newline-delimited Protocol v2 JSON plus diagnostic timeline events |

The unified timeline data preserves the ordered action durations and `inflate`/`deflate` flags from the original sequences:

| Mode | Original sequence and total | Unified sequence / total | Source comparison |
|---|---|---|---|
| WIND | Initial inflate 5,000 ms; deflate/inflate pairs 1,500/1,300; 1,450/1,050; 1,900/1,600; 1,750/1,450; 1,050/950 ms; final deflate 5,000 ms. Total 24,000 ms. | Same ordered 12 actions in `WIND_ACTIONS`; 24,000 ms. | Values and ordering match. |
| WAVE | Initial inflate 5,000 ms; three deflate/inflate pairs of 2,000/2,500 ms; transition 1,000/500 ms; final deflate 5,000 ms. Total 25,000 ms. | Same ordered 10 actions in `WAVE_ACTIONS`; 25,000 ms. | Values and ordering match. |
| BUBBLE | Initial inflate 4,420 + 580 ms; pop intervals before the 20,000 ms audio endpoint split into integer 45% deflate / 55% inflate; final deflate 3,000 ms. Total 27,420 ms. | Same ordered 31 actions in `BUBBLE_ACTIONS`; 27,420 ms. | Values and ordering match. |

The current timeline header is stored in `PROGMEM`, and the Phase 2D report records all actions and final timeline offsets matching on the connected Nano's simulated protocol. That validates schedule/event data, not physical tactile output or equivalence of the old switch actuation.

**Potential behavior changes that matter for calibration:**

1. The original actually commands Servo outputs; the unified firmware does not. Its D5/D6/D7 fields are logs, not hardware signals.
2. The original begins its first fill as soon as setup completes and runs indefinitely. Unified firmware remains idle until commanded and executes one finite simulated run.
3. Original helper calls synchronously delay between position writes. The unified scheduler emits events using `millis()` deadlines while continuing to process serial; serial transmission and scheduling introduce different software timing characteristics from a direct blocking loop.
4. Both styles have no explicit verified neutral/off state. A future conversion that simply replays the diagnostic D5/D6/D7 values as outputs would restore the legacy position commands but would not establish safe startup, stop, disconnect, or power-loss behavior.
5. USB-port opening/reset can restart an original sketch into its automatic first action. Unified firmware resets to its simulation idle state; this difference is material to any future reconnect/startup design.

## 5. Confirmed Facts vs Unknowns

### Confirmed from inspected source or user report

- The three original sketches use the exact same `inflate()` and `deflate()` write sequences listed above.
- All three attach Servo objects to D5, D6, and D7; all use 9600 baud and blocking delays.
- The original sketches have no serial command input, no explicit STOP, and no stop-all/off helper.
- Original loops repeat automatically after their final marker.
- Unified firmware does not include Servo, attach pins, configure GPIO, or make GPIO writes. Its pin values are diagnostic serial data.
- The Phase 2D report documents successful simulated protocol tests, not actuator testing.
- The user reports that USB is the only supply in the previously working physical setup and that USB also powers the existing system. Therefore, USB connection must **not** be treated as isolation of actuator power.
- The user identifies D5 as solenoid valve, D6 as suction pump, D7 as inflation pump, connected through small RC-style switch modules.

### Unknown; must not be inferred

- Exact make/model/revision and input specification of each switch module; whether all three modules are identical.
- Whether a module recognizes hobby-servo PWM pulse widths, a specific pulse period, pulse-loss behavior, or another control convention.
- Pulse widths generated by the installed Servo library for the exact `write()` values and library configuration, and module thresholds/tolerances.
- Which signal or power polarity/state means OFF, including on no signal, invalid signal, boot/reset, USB connect/disconnect, and board brownout.
- Whether module inputs have pull-ups/pull-downs, isolation, default bias, or are high impedance during MCU reset.
- USB 5 V distribution and current limits; whether/how the actuator supply is switched or boosted; actual pump/valve voltage and startup/stall current; shared grounds and return paths.
- RC switch load ratings, protection, thermal limits, duty-cycle limits, switching transients, and suitability for DC motors or an inductive solenoid.
- The physical pressure limit, relief path, tubing/bag ratings, flow behavior, and consequences of simultaneous or stuck outputs.
- Whether previously successful USB-powered operation used the same exact module wiring, firmware/library version, laptop/USB source, and continuous duty conditions.

The reported prior successful operation is useful history but does not prove a safe OFF state, safe failure behavior, or continuous-operation rating.

## 6. Minimal Hardware Verification Plan

This is a proposed future plan, not an instruction to energize the current actuator setup. The current task made no physical changes or measurements.

1. **Keep the present setup unpowered.** Because USB reportedly powers the whole system, unplugging other adapters is not sufficient isolation. Do not connect USB to an assembly with pumps/valve able to energize until the actuator supply path is positively separated from the actuators.
2. **Document without energizing:** photograph each switch module's front/back markings and terminal labels; record the exact wire-to-terminal map, module count, load/device labels, and how USB 5 V/GND reaches each module/load. Do not infer input or output pins from wire colors alone.
3. **Identify specifications:** use the exact module markings/vendor information to obtain input pulse/logic requirements, OFF/no-signal default, power-up/reset behavior, polarity, isolation, load type/current/inductive rating, and thermal/duty-cycle limits. If no reliable specification can be identified, treat the safe state and rating as unknown.
4. **Determine the power boundary before control tests:** with loads disconnected and the system de-energized, trace whether the USB 5 V rail supplies the modules and/or the actuator outputs. Have a qualified person verify the intended way to keep the Nano powered while the actuator circuits remain physically unpowered. USB alone is not that verification.
5. **Only after the boundary and module inputs are identified:** use a dummy load appropriate to the documented switch output, with actuators removed and a suitably current-limited isolated test supply. Measure module output current/voltage while testing input conditions that can occur at startup/reset, the documented OFF command, loss of signal, and power-up/power-down. Do not probe mains or unknown high-energy circuits.
6. **Keep actual pumps and valve disconnected during characterization.** Do not use the legacy sketches as an OFF-state test: they automatically command the first action and then loop. Do not use `write(0)`, `write(90)`, `write(180)`, `detach()`, USB unplug, or host disconnect as a presumed safe state.
7. **Record measured evidence and stop on ambiguity.** If the module has no documented fail-safe input state, if a dummy-load output cannot be shown inactive under reset/no-signal conditions, or if USB cannot be separated from actuator energy, do not advance to output-enabled firmware or pneumatic operation.

The minimum information needed to identify a reliable OFF state is: module part number/specification (or measured input/output behavior), accepted pulse/logic range and OFF criteria, power-loss/no-signal/reset behavior, actual USB-to-load power topology, and verified output/load ratings. Commercial model identification is strongly preferred; without it, characterization requires a qualified, isolated dummy-load test and still does not establish a certified safety rating.

## 7. Recommendation for Phase 3A Step 2

Make Step 2 a **power-topology and switch-input identification review**, not firmware integration or an actuator run:

1. Obtain clear photos/markings and a de-energized wiring/power map from Nano USB through each RC-style module to each load.
2. Identify the exact switch module and obtain its input, no-signal/reset, output, current, and duty-cycle specifications.
3. Establish and independently verify a way to keep the Nano/USB interface available while all actuator energy and loads are physically isolated. Do not assume USB-only means actuator-off.
4. Define a documented OFF behavior for normal stop, firmware reset, USB loss, and MCU power-up; validate only with the actuators disconnected and suitable dummy loads after the preceding information is available.
5. Keep the legacy sketches unchanged and do not enable outputs in unified firmware until the OFF state, power boundary, ratings, pressure limits, and independent physical cutoff have been reviewed and explicitly approved.

**Blocking safety issues:** The USB cable is reported to supply the actuator system; switch modules and their OFF/no-signal/reset behavior are unidentified; load ratings and power topology are unverified; no explicit OFF/stop-all behavior exists in the legacy sketches. Until those points are resolved, do not connect USB to the actuator-powered assembly, run the legacy sketches, enable D5/D6/D7, or proceed to pneumatic actuation.
