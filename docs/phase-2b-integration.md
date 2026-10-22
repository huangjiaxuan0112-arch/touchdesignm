# Phase 2B: Unified Nano Firmware Integration

## Scope and safety boundary

Phase 2B adds a one-shot, non-blocking protocol-v2 firmware build and a separate Electron control panel for the Arduino Nano. This build is **simulation-only**. It has no Servo library, does not configure D5/D6/D7, and contains no pin-write or actuator-output command. Timeline entries report the original source values as diagnostic data; they are not sent to physical pins.

Keep pumps, valve, driver modules, and actuator power disconnected for upload and all serial tests. This software is not evidence of electrical safety and must not be used for tactile operation. The original mode sketches and the Phase 1B diagnostic sketch are unchanged.

| Item | Phase 2B behavior |
| --- | --- |
| Firmware sketch | `firmware/unified/nature_touch_unified/nature_touch_unified.ino` |
| Baud / framing | 9600 baud; newline-terminated ASCII JSON objects, except retained literal Phase 1B `PING` and `STATUS` lines |
| Protocol | Version 2: `IDENTIFY`, `SELECT`, `START`, `STOP`, `STATUS_QUERY`, `RECOVER` |
| Supported modes | WIND, WAVE, BUBBLE |
| Outputs | Disabled; D5/D6/D7 values appear only as source-reference diagnostics |
| Restart behavior | One-shot only; reset boots IDLE with no selection and never resumes |
| Arduino memory | Fixed line/field/request buffers; timeline arrays are stored in program memory |

Request and operation IDs are limited to 1-16 ASCII letters, digits, `_`, or `-`. Keep IDs unique. The Nano keeps a four-entry request-acknowledgement cache and a four-entry recent operation-ID history to bound RAM. Same-ID/same-command requests replay their acknowledgement without replaying the asynchronous event; changing a cached request payload returns `REQUEST_ID_REUSED`.

The classic Nano (`arduino:avr:nano:cpu=atmega328`, AVR core 1.8.8) build was verified with 9,270 bytes of flash and 1,294 bytes of global SRAM, leaving 754 bytes for local variables and stack. Moving fixed serial output strings to flash reduced global SRAM from 2,272 bytes to 1,294 bytes; flash usage increased from 8,940 to 9,270 bytes. The remaining SRAM is not a runtime stack-usage measurement.

## Upload with Arduino IDE

1. Physically disconnect pump, valve, driver, and actuator power. Connect the Nano to the PC by USB only.
2. Open `firmware/unified/nature_touch_unified/nature_touch_unified.ino`. Keep `experience-timelines.h` beside the sketch.
3. Select the actual Nano target under **Tools > Board** and the processor/bootloader that matches the physical board. Do not guess a processor setting to work around an upload failure.
4. Select the identified USB serial port and upload. Confirm the IDE reports success. Close Serial Monitor/Plotter before using the desktop app; a serial port is normally exclusive to one process.
5. Do not connect actuator loads or power. The firmware identity is `nature-touch-unified-simulation` and it reports `hardwareOutputsEnabled:false`.

The firmware has not been uploaded to a physical Nano as part of this software validation. Confirm the board variant, processor, port, and upload result on the actual hardware before proceeding.

## Electron development interface

From `desktop/`, run `npm.cmd install` if dependencies are not installed, then `npm.cmd run dev`. Select the operator-identified serial port and baud rate in **USB serial diagnostics** or **Arduino Nano firmware (simulation only)**.

- **Experience simulation (software only)** remains the local `MockExperienceController`; it makes no serial connection.
- **Arduino Nano firmware (simulation only)** opens the serial port, sends `IDENTIFY` protocol 2, then queries `STATUS` before enabling its experience controls. A different firmware identity, protocol, or output-enabled declaration is rejected.
- Opening a Nano serial port can toggle DTR and reset the board. The firmware controller waits 2.5 seconds for the Nano bootloader/application startup, sends its newline-terminated JSON IDENTIFY frame at 9600 baud, and allows 5 seconds for the handshake response. General command/status responses use a 1.5-second timeout. Serial writes are queued and wait for both write and drain completion.
- If the board answers with Phase 1B text such as `ERROR:UNKNOWN_COMMAND`, the app reports incompatible firmware and instructs the operator to upload this Phase 2B simulation sketch. Do not use the Phase 1B diagnostic sketch for experience control.
- SerialPort `error`, write, drain, close, and pending-request failures are handled at the connection boundary. A serial communication failure closes the session, rejects pending commands, faults the host state, and requires an explicit reconnect and fresh identify/status exchange. The app never retries START or automatically resumes a mode.
- The Phase 1B diagnostics and the real-firmware controller cannot own the same COM port simultaneously. Connecting either path closes the other path first. A running operation interrupted by an explicit disconnect becomes faulted/unknown; disconnect is not treated as a successful STOP.
- During a Nano run, Electron sends a `STATUS_QUERY` heartbeat once per second. A missing command/status response or serial close faults the host session, disables further commands, and requires a fresh identify/status exchange. No `START` is automatically retried.

## Serial protocol test cases

Send one JSON object per line. `requestId` is required for every command. `START` and `STOP` also require a unique matching `operationId`.

| Test | Request | Expected result |
| --- | --- | --- |
| Identify protocol | `{"type":"IDENTIFY","protocol":2,"requestId":"r1"}` | Correlated ACK with protocol 2, firmware/device identity, current state, capabilities, and `hardwareOutputsEnabled:false` |
| Unsupported version | `{"type":"IDENTIFY","protocol":1,"requestId":"r2"}` | NACK `UNSUPPORTED_PROTOCOL`; state unchanged |
| Reject start without selection | `{"type":"START","operationId":"o1","requestId":"r3"}` | NACK `NO_EXPERIENCE_SELECTED` |
| Select a mode | `{"type":"SELECT","experienceId":"WIND","requestId":"r4"}` | ACK in `IDLE` |
| Start | `{"type":"START","operationId":"o1","requestId":"r5"}` | ACK in `RUNNING`, followed by marker/action diagnostic events |
| Query state | `{"type":"STATUS_QUERY","requestId":"r6"}` | Correlated ACK and `STATUS` snapshot; status includes state, selection, operation, elapsed/duration, and fault code |
| Stop active operation | `{"type":"STOP","operationId":"o1","requestId":"r7"}` | ACK in `STOPPING`, then correlated `STOPPED`; no later timeline actions are scheduled |
| Stop wrong operation | `{"type":"STOP","operationId":"wrong","requestId":"r8"}` | NACK `OPERATION_MISMATCH` |
| Select unknown mode | `{"type":"SELECT","experienceId":"UNKNOWN","requestId":"r9"}` | NACK `UNKNOWN_EXPERIENCE` |
| Invalid state | Repeat START while already RUNNING, or SELECT while RUNNING | NACK `INVALID_STATE`; current operation remains unchanged |
| Duplicate request | Resend the same request ID and identical command/payload | Original cached ACK; no second operation or event replay |
| Reused request ID | Reuse a cached request ID with a different command/payload | NACK `REQUEST_ID_REUSED` |
| Legacy diagnostic | `PING` and `STATUS` | `PONG` and `STATUS:DIAGNOSTIC_READY`, respectively |
| Malformed / oversized line | Send invalid JSON or a line over the fixed input limit | `ERROR`; parser discards through newline and continues |
| Reset / reconnect | Reset the Nano or reconnect the desktop app | IDLE/no selection after reset; host performs IDENTIFY/STATUS only and never sends START automatically |
| Communication timeout | Suppress status/ACK or disconnect USB during a run | Host reports `COMMUNICATION_FAILURE`/`CONNECTION_LOST`; stop is unconfirmed and no command is retried |

## Phase 2B reliability validation and Phase 2C handoff

The automated protocol/cache tests use a mock firmware responder; they do not execute the Nano's C++ parser or substitute for a USB-connected board test. Electron framing, pending-request correlation, event handling, disconnect behavior, and reconnection are exercised through the mock serial transport. The AVR build separately validates compilation and memory usage.

For the next hardware-connected pass:

1. Leave pumps, valves, driver boards, and actuator power disconnected. Connect only the Nano by USB. Close Arduino Serial Monitor and any other program that could own the port.
2. In the Electron application, refresh the discovered serial ports, select the port reported for the connected Nano (do not assume COM5), choose 9600 baud, and connect. Confirm the app reports the Nature Touch simulation firmware, protocol 2, output-disabled, and IDLE status.
3. In the Electron controller, select WIND, start once, and verify the operation ID and scheduled diagnostic events. Stop it and verify the correlated STOPPED result. Confirm UI actions are disabled after disconnect; reconnect explicitly and verify the app performs IDENTIFY/STATUS only and does not restart the operation.
4. Close the application connection before opening Serial Monitor. Set 9600 baud and newline line-ending, then send `{"type":"IDENTIFY","protocol":2,"requestId":"r1"}` twice. Both replies should be the same cached ACK. Send `{"type":"SELECT","experienceId":"WIND","requestId":"r1"}`; expect NACK `REQUEST_ID_REUSED`.
5. Send `{"type":"SELECT","experienceId":"UNKNOWN","requestId":"r2"}` and `{"type":"IDENTIFY","protocol":1,"requestId":"r3"}`; expect `UNKNOWN_EXPERIENCE` and `UNSUPPORTED_PROTOCOL`, respectively. Send `{bad` and expect `ERROR` with `INVALID_SCHEMA`.
6. Send a line containing 160 ASCII `x` characters followed by newline. Expect `ERROR` with `LINE_TOO_LONG`; then send a valid IDENTIFY request with a new request ID to confirm parsing resumes on the next line.
7. Close Serial Monitor before reconnecting the Electron application. Verify port discovery and the handshake again. Never test with actuator loads connected.

The Nano does not rely on detecting USB removal. If USB disappears while a pattern is running, the scheduler may continue its output-free simulation until completion; the host heartbeat and serial close handling mark the host session faulted. Neither the host nor firmware claims that an unplug caused a verified stop.

## Event logs and source timelines

Each scheduled ACTION emits one `EVENT` line with its operation/mode, source offset, action, duration, original D5/D6/D7 values, and `hardwareOutputsEnabled:false`. `MARKER` lines preserve the source milestone labels; `COMPLETED` is emitted once at the end. A STOP cancels all remaining action deadlines.

Example log excerpt:

```text
{"type":"ACK","command":"START","accepted":true,"requestId":"r5","state":"RUNNING","operationId":"o1"}
{"type":"EVENT","name":"MARKER","operationId":"o1","experienceId":"WIND","atMs":0,"text":"INITIAL FILL"}
{"type":"EVENT","name":"ACTUATOR_EVENT","operationId":"o1","experienceId":"WIND","atMs":0,"action":"INFLATE","durationMs":5000,"D5":180,"D6":180,"D7":0,"hardwareOutputsEnabled":false}
{"type":"EVENT","name":"MARKER","operationId":"o1","experienceId":"WIND","atMs":5000,"text":"PLAY WIND AUDIO NOW"}
{"type":"EVENT","name":"ACTUATOR_EVENT","operationId":"o1","experienceId":"WIND","atMs":5000,"action":"DEFLATE","durationMs":1500,"D5":0,"D6":0,"D7":180,"hardwareOutputsEnabled":false}
```

`EXPERIENCE_DEFINITIONS` and automated tests compare every firmware action duration/order and source value against the original-derived timelines. Cycle totals remain WIND 24,000 ms, WAVE 25,000 ms, and BUBBLE 27,420 ms. BUBBLE remains source-derived at 27.42 seconds even though the planned audio edit is approximately 23 seconds; do not retime its firmware pattern to fit. Phase 3 must resolve the audio synchronization/edit discrepancy while preserving the firmware timeline.

## Validation performed and limits

The automated timeline test compares all three firmware tables to the Phase 2A definitions and checks that the sketch has no Servo include, GPIO configuration/write calls, or blocking `delay()`. Electron tests cover protocol identification, request correlation, START/STOP/completion, invalid states, diagnostic events, host timeouts/heartbeat, reset, and reconnect without automatic resume. Phase 1B mock serial diagnostics remain in the test suite.

Arduino CLI/IDE compiler availability, Nano compilation/upload, actual USB serial exchange, unplug behavior, board reset behavior, and electrical behavior remain unverified. Mock-transport tests do not establish hardware compatibility or physical safety.

## Remaining Phase 2C requirements

- Identify the exact Nano, USB bridge, bootloader, control modules, actuator ratings, wiring, polarity, reset/no-signal behavior, and power topology.
- Verify driver logic and safe power-up/reset behavior with actuator loads disconnected; determine whether and how outputs could be safely controlled. The Phase 2B firmware has no output-enable command and must stay output-disabled.
- Establish and test independent actuator power cutoff, pressure limits/relief, tubing/fitting ratings, and depressurization procedures.
- Review physical STOP, reset, host failure, USB loss, and power-cycle outcomes under supervised test conditions with loads/power disconnected until approved.
- Obtain hardware safety review and explicit approval before any firmware capable of physical output, actuator energization, or human-contact testing.
