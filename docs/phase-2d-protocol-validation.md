# Nature Touch Phase 2D: Physical Nano Protocol Validation

## Result

**PASS — physical USB protocol flows verified** on 2026-10-27 (Windows, JST) using the existing Electron `ArduinoFirmwareService` and native SerialPort transport. The live USB-to-serial device was identified from current port discovery and operator unplug/replug confirmation as a WCH CH340 on **COM6 at 9600 baud**.

The operator confirmed before testing that external actuator power was physically isolated, no pneumatic hardware could be energized, and serial monitor software was closed. Source inspection verified the unified sketch is simulation-only: it does not include Servo, configure GPIO, or call `pinMode`, `digitalWrite`, `analogWrite`, or `attach`. D5/D6/D7 values are only printed in diagnostic `ACTUATOR_EVENT` messages with `hardwareOutputsEnabled:false`. The firmware was not uploaded or changed.

No pneumatic actuation was attempted. The host sent SELECT/START/STOP protocol requests to exercise the simulation state machine; no hardware output path exists in the inspected source. This source review and the firmware identity are not proof that external wiring or power is safe.

## Port and connection

At test time, native serial discovery found COM3/COM4 as Bluetooth ports and one connected CH340 USB serial port:

| Port | Identification | Result |
|---|---|---|
| COM3, COM4 | Bluetooth (`BTHENUM`) | Not the Nano |
| COM6 | WCH CH340, VID `1A86`, PID `7523`, current USB device; operator confirmed by unplug/replug | Used at 9600 baud |
| COM5 | Historical CH340 assignment, not the current discovered device | Not opened |

The initial connection identified `nature-touch-unified-simulation`, protocol 2, and `hardwareOutputsEnabled:false`. The initial status was IDLE with no selected experience or operation.

## Per-mode physical results

Each mode was tested over the real USB serial connection using the existing service:

1. SELECT returned ACK in IDLE.
2. Repeating the same request ID and payload replayed the same ACK.
3. Reusing that request ID for a different experience returned NACK `REQUEST_ID_REUSED`; the selected mode remained unchanged.
4. START returned ACK in RUNNING. Repeating the same START request replayed the ACK and did not add a second initial action event.
5. STOP returned ACK in STOPPING followed by STOPPED. STATUS_QUERY then reported IDLE, the selected mode, and no active operation. No later `ACTUATOR_EVENT` for the stopped operation arrived.
6. Reusing the stopped operation ID with a new request ID returned NACK `OPERATION_ID_REUSED`.
7. A new operation was allowed to run to natural COMPLETED. Its complete action-event count, first offset, and final action end matched the checked-in timeline.

| Mode | STOP flow | Actions after STOPPED | Natural completion events | Timeline final offset | Expected duration | Measured wall time to COMPLETED |
|---|---|---:|---:|---:|---:|---:|
| WIND | PASS; STOPPING → IDLE | 0 | 12 / 12 | 24,000 ms | 24,000 ms | 24,365 ms |
| WAVE | PASS; STOPPING → IDLE | 0 | 10 / 10 | 25,000 ms | 25,000 ms | 25,369 ms |
| BUBBLE | PASS; STOPPING → IDLE | 0 | 31 / 31 | 27,420 ms | 27,420 ms | 27,783 ms |

The approximately 0.3–0.4 second wall-time overhead is the observed physical serial/scheduler time around the source timeline. The final `atMs + durationMs` values exactly matched each expected mode duration.

Example protocol frames observed/validated for the WIND stop test:

```json
{"type":"ACK","command":"SELECT","accepted":true,"requestId":"sw11","state":"IDLE"}
{"type":"ACK","command":"START","accepted":true,"requestId":"tw11","state":"RUNNING","operationId":"ow11"}
{"type":"ACK","command":"STOP","accepted":true,"requestId":"xw11","state":"STOPPING","operationId":"ow11"}
{"type":"EVENT","name":"STOPPED","operationId":"ow11"}
```

After STOP, the correlated status snapshot reported `state:"IDLE"`, `selectedExperienceId:"WIND"`, and `operationId:null`. Repeated SELECT/START requests replayed their cached ACKs. Changed payload under the cached SELECT request ID returned `REQUEST_ID_REUSED`; a new START request using the stopped operation ID returned `OPERATION_ID_REUSED`.

Mode switching was additionally verified in a single USB session: SELECT WIND → SELECT WAVE → SELECT BUBBLE. Each returned ACK and a following STATUS_QUERY reported IDLE with the newly selected mode.

## Invalid requests and reconnect

The following raw protocol requests were sent while connected and idle. Each was rejected without starting an operation:

| Request case | Actual response |
|---|---|
| Unknown command (`NOT_A_COMMAND`) | NACK `INVALID_COMMAND` |
| Missing SELECT `experienceId` | NACK `INVALID_SCHEMA` |
| Unknown experience (`UNKNOWN`) | NACK `UNKNOWN_EXPERIENCE` |
| Invalid START operation ID containing a space | NACK `INVALID_OPERATION_ID` |
| IDENTIFY protocol 1 | NACK `UNSUPPORTED_PROTOCOL` |
| Malformed JSON (`{not-json`) | ERROR `INVALID_SCHEMA` |

A separate disconnect test started a WIND simulation, then explicitly disconnected while it was RUNNING. The host marked the interrupted state FAULT because stop could not be confirmed. On explicit reconnect the host sent only `IDENTIFY` and `STATUS_QUERY`; it sent no START. The board reported IDLE after the serial-port reopen/reset. Status after rejection tests was also IDLE with no active operation and `hardwareOutputsEnabled:false`.

## Problems and test-run notes

- The first COM5 open during Phase 2C had returned `Access denied`; it was not used for this phase. Current discovery and operator confirmation identified COM6.
- An initial combined test-runner attempt completed WIND and WAVE, then tried to issue the next SELECT while an automatic heartbeat request was still pending. The service correctly rejected concurrent requests (`Wait for the current firmware request to finish`). No BUBBLE command was sent in that attempt. Testing was repeated in isolated per-mode service sessions with a longer heartbeat interval; all three physical mode runs passed.
- This was a test sequencing issue, not a firmware timeline or hardware-output failure. No application or firmware source code was changed.

## Physical vs automated validation

- **Physical results:** All exchanges, state transitions, timeline events, stop cancellations, mode switching, invalid-command responses, and reconnect behavior above were observed over the real COM6 USB serial connection.
- **Automated tests:** The repository's 51 passing automated tests remain mock-backed for protocol/control behavior; they are not the source of the physical results above. No automated test count was changed by this hardware session.
- **Not verified:** Actual actuator/wiring safety, driver electrical behavior, pressure or pneumatic limits, hardware output levels, and safety of connecting actuator loads. No loads were energized or tested.

## Recommendation

Phase 2D serial protocol validation is complete for simulation-only operation. Keep pumps, valve, drivers, and actuator supply disconnected. Do not proceed to pneumatic actuation based on this protocol result. Any future firmware that can drive physical outputs requires separate hardware identification, electrical/safety review, explicit authorization, and a tested independent power cutoff.
