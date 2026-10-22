# Nature Touch: Existing Firmware and Media Analysis

## Scope and evidence

This analysis is based on the three original `.ino` files and media/reference files currently under `卒研music/`. The sketches and media were inspected in place and were not modified. Findings about source code and file metadata are verified; conclusions about physical wiring, drivers, pneumatic behavior, or the sound content are not verified without hardware inspection or listening tests.

## Firmware inventory

| Mode indicated by folder | Original sketch | Main behavior | Serial output |
| --- | --- | --- | --- |
| Wind | [`sketch_oct21a.ino`](../卒研music/wind/sketch_oct21a/sketch_oct21a.ino) | Five paired contraction/return waves followed by a continuous 5-second contraction; repeats in `loop()` | `INITIAL FILL`, `PLAY WIND AUDIO NOW`, `FINAL SHRINK`, `NEXT WIND CYCLE` |
| Ocean waves | [`sketch_oct21b.ino`](../卒研music/ocean%20waves/sketch_oct21b/sketch_oct21b.ino) | Three repeated 2-second contraction / 2.5-second return waves, a 1.5-second transition, then a 5-second contraction; repeats | `INITIAL FILL`, `PLAY WAVE AUDIO NOW`, `FINAL SHRINK`, `NEXT WAVE CYCLE` |
| Bubbles | [`sketch_oct21a.ino`](../卒研music/bubbles/sketch_sep30a/sketch_oct21a/sketch_oct21a.ino) | Initial fill, then event-timed cycles split 45% contraction / 55% return through 20 seconds, then a 3-second contraction; repeats | `PLAY AUDIO NOW`, `BUBBLE START`, `FINAL SHRINK`, `NEXT ROUND` |

Each sketch includes `Servo.h`, declares three `Servo` objects, and independently defines `inflate()` and `deflate()` with the same output values. The sketches are separate programs, not a shared mode-selectable firmware. None contains an operator-selectable mode, start/stop command, cancellation path, fault state, or finite one-shot lifecycle.

## Sketch comparison

The three programs share the same pin attachments, 9600-baud serial setup, and output helper behavior. Their differences are the timing sequence and the progress markers printed to serial:

- **Wind:** 5 seconds initial fill; 14 seconds of five contraction/return sections; 5 seconds final contraction. The comments and constants label the sound as 19 seconds. `WIND_LENGTH` is declared but not used to control execution.
- **Wave:** 5 seconds initial fill; three 4.5-second waves (13.5 seconds); a 1.5-second transition; then 5 seconds final contraction. The main pattern therefore spans 20 seconds, including the final contraction. `WAVE_OUT` and `WAVE_IN` are used; there is no audio-length constant.
- **Bubbles:** 4.42 seconds fill, prints the audio cue, fills another 0.58 seconds, then prints `BUBBLE START`. The event pattern spans audio time 0.58 to 20 seconds, with each interval divided into 45% contraction followed by 55% return; then it contracts for 3 seconds. `PRE_FILL` is declared but unused; the fill is instead hard-coded as 4420 and 580 ms. The array has 28 timestamps, but the loop breaks at the first timestamp greater than or equal to 20 seconds, so the 14 timestamps from 20.59 through 33.04 seconds do not run.

All timing is implemented with blocking `delay()` calls. The loop cannot process input or cancellation during a delay; in fact, no serial input is read at any time. Timing totals below are derived from source constants and calls, not measured actuator motion:

| Sketch | Before audio marker | Main pattern after audio marker | Final contraction | Approx. loop period |
| --- | ---: | ---: | ---: | ---: |
| Wind | 5.00 s | 14.00 s | 5.00 s | 24.00 s |
| Ocean waves | 5.00 s | 15.00 s | 5.00 s | 25.00 s |
| Bubbles | 4.42 s | 20.00 s after the `PLAY AUDIO NOW` marker: 0.58 s additional fill, then 19.42 s event pattern through audio time 20 s | 3.00 s | 27.42 s |

For bubbles, `BUBBLE START` occurs 0.58 seconds after the `PLAY AUDIO NOW` marker. The event timestamps interpreted as audio offsets are 0.58, 2.04, 3.53, 5.51, 7.40, 9.40, 11.23, 13.05, 13.55, 15.92, 16.68, 17.52, 18.08, and 18.62 seconds. Each interval from one active timestamp to the next (or to 20 seconds) is wholly consumed by the 45%/55% pair. Integer arithmetic truncates the contraction portion to whole milliseconds; the return portion receives the remainder.

## Pin mapping in source

The sketches attach Servo-library objects to these Arduino digital pin numbers. The user has since physically confirmed the device associations shown below. That confirms which module/device is associated with each channel; it does **not** verify module input semantics, trigger polarity, thresholds, electrical ratings, or what either Servo endpoint means electrically.

| Arduino pin in sketch | Object | `inflate()` write | `deflate()` write | Physical connection |
| --- | --- | ---: | ---: | --- |
| D5 | `servo_5` | 180 | 0 | Solenoid air valve |
| D6 | `servo_6` | 180 | 0 | SC-3704PM-A DC 6 V micro air pump |
| D7 | `servo_7` | 0 | 180 | SC-3704PM-A DC 6 V micro air pump |

All three channels use the same type of small transparent electronic control module with a three-wire input and two-wire output, per the user's physical inspection. The modules appear consistent with RC PWM electronic switches, but exact model, trigger thresholds, input compatibility, output/current ratings, isolation, polarity, and power-loss behavior are not confirmed. The pump and valve associations are not evidence that the module performs a particular ON/OFF action for either `Servo.write()` endpoint.

Both helpers command D5 and D6 identically, and D7 oppositely. They do not address the three outputs independently. There are no named pin constants, `pinMode()`, `digitalWrite()`, or `analogWrite()` calls. Each sketch calls `attach(5)`, `attach(6)`, and `attach(7)` in `setup()`.

## Existing control logic and actuator assumptions

`inflate(ms)` writes `servo_5=180`, `servo_6=180`, `servo_7=0`, then blocks for `ms`. `deflate(ms)` writes `servo_5=0`, `servo_6=0`, `servo_7=180`, then blocks. The source calls these helpers “inflate” and “deflate,” but it does not define electrical actuator outputs, pump speed, valve state, pressure, or physical movement.

The verified code-level behavior is Servo-library position commands. It does **not** directly switch DC pump or solenoid power using a documented motor driver interface. The project brief lists two DC pumps and one solenoid valve, but there is no verified mapping from D5/D6/D7 to those devices. Do not interpret `Servo.write(0)` or `Servo.write(180)` as OFF, safe, open, closed, or a known pressure state. The exact Servo-library attach/reset behavior and any intermediate driver behavior must also be checked against the actual board and connected circuitry before energizing loads.

The writes are sequential in one blocking control path. There is no concurrency between channels, feedback input, pressure measurement, interlock, watchdog, or per-channel fault handling in these sketches. Repetition is unconditional: after the tail marker, `loop()` immediately begins the next cycle.

## Serial communication capability

All three sketches call `Serial.begin(9600)`. They emit human-readable ASCII status/cue strings using `Serial.println()`, which terminates each line. No sketch calls `Serial.available()`, `Serial.read()`, or another receive/parser API. There are no command names, request IDs, acknowledgements, protocol version, device identity, ready handshake, or timeout behavior.

Thus, the current firmware can provide one-way serial log/cue output at a configured baud rate; it does not support USB-serial control commands. The printed cue strings could be observed by a host, but they are not a robust synchronization contract: there is no request correlation, state query, error response, or pause/cancel. Host USB bridge, reset-on-open behavior, COM port, and physical USB wiring are not established by the sketches.

## Audio and reference assets

Windows file metadata reports these MP3 durations and bitrates. The names/folders indicate likely mode associations; the audio was not listened to, so actual sound content and cue alignment remain unverified.

| Asset | Size | Metadata duration | Bitrate | Likely association and evidence |
| --- | ---: | ---: | ---: | --- |
| [`东风声.mp3`](../卒研music/wind/东风声.mp3) | 609,024 bytes | 19 s | 256 kbps | Wind, from the `wind` folder and filename; matches the wind sketch's 19-second post-prefill sequence |
| [`海浪声.mp3`](../卒研music/ocean%20waves/海浪声.mp3) | 647,424 bytes | 20 s | 256 kbps | Ocean/wave, from the `ocean waves` folder and filename; matches the wave sketch's 15-second pattern plus 5-second final contraction |
| [`voicebosch-bubbles-171716.mp3`](../卒研music/bubbles/voicebosch-bubbles-171716.mp3) | 1,100,068 bytes | 34 s | 256 kbps | Bubbles, from the `bubbles` folder and filename; duration does **not** match the sketch's 20-second event window plus 3-second final contraction |

The repository also contains [`自然音与柔和形变信息图.png`](../卒研music/自然音与柔和形变信息图.png). Its Japanese heading describes natural sounds paired with gentle shape changes and compares three tactile patterns: waves as slow/large/smooth, wind as flowing/irregular, and bubbles as fine/discontinuous. It notes a baseline inflation of about five seconds and a fill-to-contraction ratio around 1:1.5, but does not define measurement conditions. These are design intentions in the graphic, not proof of physical behavior. The bubble sketch's interval split is 45% contraction / 55% return, which does not by itself establish the graphic's ratio. No separate wiring schematic, driver datasheet, or textual requirements document was found in the inventoried resources.

The bubble mismatch is significant: the audio file lasts 34 seconds, while the sketch only models events until 20 seconds and then performs a 3-second contraction. If playback is started at the printed cue and repeated on every firmware cycle, the nominal 27.42-second loop period is shorter than the MP3 duration. Confirm whether the file is intended to be trimmed, stopped, played only in part, or otherwise synchronized before integrating media.

## Verified facts versus unknowns

**Verified from source/assets:** three independent sketches; `Servo.h`; D5/D6/D7 attachments; identical paired/opposed writes; `Serial.begin(9600)`; transmit-only status markers; blocking delays and automatic repeating loops; audio file names, byte sizes, Windows-reported duration and bitrate; one Japanese infographic with conceptual pattern descriptions.

**Confirmed by user physical inspection:** D5 maps to the solenoid air valve; D6 and D7 map to SC-3704PM-A DC 6 V micro air pumps; each channel uses the same class of transparent three-wire-in/two-wire-out control module.

**Not established:** exact Nano variant/USB bridge; control-module manufacturer/model and circuit; PWM pulse-width/frequency thresholds; signal polarity and input voltage compatibility; output voltage/current rating and whether loads are switched high- or low-side; channel isolation; transient/flyback protection; module behavior during reset, invalid/no signal, USB loss, or power loss; supply/current capacity; valve normal state and rated coil characteristics; pump startup/stall current; pneumatic layout, pressure range, regulator/relief protection, tubing ratings, feedback, emergency cutoff, and verified safe state. The channel association does not make any Servo value a confirmed ON/OFF command. The supplied assets do not establish that the audio was auditioned against tactile output or measured for synchronization.

## Safety considerations

- Do not upload or run these sketches with pumps, valves, or other loads connected until the board, drivers, wiring, startup levels, and physical cutoff are identified and verified.
- Treat the `Servo` calls as signal commands only. Do not infer that an endpoint value de-energizes an actuator or safely releases pressure.
- Obtain a schematic and driver/actuator datasheets; map Nano pins to driver inputs and loads by inspection and measurement. Verify boot/reset behavior with loads disconnected.
- Establish an accessible independent actuator-power cutoff, pressure limits, regulator/relief method, rated tubing/fittings, and depressurization procedure before human-contact use.
- The firmware is blocking and has no command cancellation or communication-loss handling. A host disconnect cannot stop a sequence through the current firmware; it also cannot serve as a physical safety cutoff.
- Preserve unmodified originals. Any future integrated or diagnostic firmware should be a separate copy/file, and timing must be compared against these baselines.

## Minimum information before implementing serial communication

1. Confirm exact Arduino board/variant, USB-serial interface/driver, operating system COM-port enumeration, reset-on-port-open behavior, and reliable baud rate. The sketches currently use 9600 baud.
2. Confirm that Serial output is available over the intended USB path, and identify whether any other device/library uses the UART. Existing `println` strings are telemetry only and are not commands.
3. Decide protocol framing, command/response vocabulary, protocol version, request correlation, state/error responses, line-size bounds, timeout policy, and reconnect behavior. Make explicit that no actuator command is included in the initial serial test.
4. Define how legacy text markers coexist with a protocol (or are replaced in a future copy) so a host parser cannot confuse logs with acknowledgements.
5. Keep actuators disconnected or actuator power physically isolated during first serial tests. Record a test procedure for reset, unplug, malformed input, and reconnect. Do not claim safe shutdown until physical outputs and cutoff are independently verified.

## Recommended Phase 1B approach

Start with USB serial transport only, with actuator power disconnected. Use a separate diagnostic sketch or isolated firmware copy; do not alter these originals. First confirm port selection, reset behavior, 9600-baud receive/transmit, and repeatable connect/unplug/reconnect. Then implement the smallest bounded, newline-delimited handshake/status exchange with explicit request IDs and protocol version. Do not add `PREPARE`, `START`, `CANCEL`, pin writes, Servo commands, or pump/valve behavior in this transport-only step. Exercise malformed/oversized lines and timeouts and record results. Only after this is stable, and after hardware mapping/safe-state review, should actuator behavior or existing patterns be integrated in a later phase.