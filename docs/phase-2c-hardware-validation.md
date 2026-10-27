# Nature Touch Phase 2C: Real Arduino USB Verification

## Result

**Physical USB protocol verification: PASS** on 2026-10-27 (local Windows session, JST). The application connected to the operator-confirmed Arduino Nano on COM6 at 9600 baud, completed IDENTIFY and STATUS_QUERY, disconnected explicitly, and reconnected successfully.

The operator confirmed that external actuator power was disconnected and that only USB was connected. No SELECT, START, STOP, RECOVER, upload, or GPIO-control command was sent. The firmware remains simulation-only. This test does not establish electrical safety or verify actuator wiring.

## Port identification

Windows identified COM3 and COM4 as Bluetooth serial ports. The connected USB serial device was a WCH CH340:

| Port | Windows / USB metadata | Observation |
| --- | --- | --- |
| COM3 | Bluetooth serial (`BTHENUM`) | Not the Nano |
| COM4 | Bluetooth serial (`BTHENUM`) | Not the Nano |
| Initial port | USB-SERIAL CH340 | Initially appeared online, then absent after the serial monitor was closed and the port was rechecked |
| Reconnected port | USB-SERIAL CH340 | Operator confirmed unplug/replug mapping; present in native SerialPort discovery and used for the successful test |

The first attempt to open the initially discovered USB serial port returned Windows `Access denied`; no protocol data was sent on that attempt. A serial monitor was open at the time and may have owned the port. After the operator closed it, the Nano reappeared under a different port name. Port names are not assumed stable; select the currently enumerated and physically confirmed port.

## Physical protocol responses

The project’s existing `ArduinoFirmwareService` and native `SerialPort` transport were used. The service sent IDENTIFY and then STATUS_QUERY at 9600 baud. The READY event is also emitted by the sketch at startup.

First connection, raw newline-delimited frames:

```json
{"type":"EVENT","name":"READY","deviceId":"nature-touch-nano-simulation","protocol":2,"hardwareOutputsEnabled":false}
{"type":"ACK","command":"IDENTIFY","accepted":true,"requestId":"r1","state":"IDLE","protocol":2,"firmware":"nature-touch-unified-simulation","deviceId":"nature-touch-nano-simulation","hardwareOutputsEnabled":false,"capabilities":["WIND","WAVE","BUBBLE","SIMULATION_ONLY"]}
{"type":"ACK","command":"STATUS_QUERY","accepted":true,"requestId":"r2","state":"IDLE"}
{"type":"STATUS","requestId":"r2","acknowledgement":{"type":"ACK","command":"STATUS_QUERY","accepted":true,"requestId":"r2","state":"IDLE"},"snapshot":{"state":"IDLE","selectedExperienceId":null,"operationId":null,"elapsedMs":0,"durationMs":null,"faultCode":null,"hardwareOutputsEnabled":false}}
```

The IDENTIFY reply matched the required protocol-v2 simulation identity and `hardwareOutputsEnabled:false`. The STATUS reply was valid for request `r2`, reported `IDLE`, and had no selected experience or active operation.

## Disconnect and reconnect

| Check | Result |
| --- | --- |
| Initial COM6 connection at 9600 | PASS; identified protocol 2 and `nature-touch-unified-simulation` |
| Initial STATUS_QUERY | PASS; correlated ACK and IDLE snapshot |
| Explicit application disconnect | PASS; service reported `disconnected` |
| Explicit reconnect to COM6 at 9600 | PASS; fresh READY event, IDENTIFY (`r3`), and STATUS_QUERY (`r4`); state remained IDLE |
| Final explicit disconnect | PASS |
| Firmware upload or actuator command | Not performed |

The reconnect raw protocol replies were an IDENTIFY ACK for `r3`, a STATUS_QUERY ACK for `r4`, and a STATUS response correlated to `r4`. As expected for this firmware, opening the port caused a READY startup event.

## Validation boundaries

- These are actual USB serial exchanges with the connected physical Nano, not mock results.
- The port was selected based on both USB metadata and operator unplug/replug confirmation.
- The user confirmed actuator power was disconnected; this was not independently measured.
- The successful handshake verifies that the board currently responds as the expected simulation firmware. It does not prove which build produced it or verify electrical behavior.
- No command capable of starting an experience was sent. D5, D6, and D7 were not enabled or driven by this test.
- COM5 access denial was resolved after the operator closed the serial monitor and re-identified the current Nano port as COM6. Avoid opening the same COM port in Arduino Serial Monitor and Electron simultaneously.
- Mock tests remain separate from this physical check. The repository test suite had 51 passing automated tests before this hardware session; no application or firmware source code was modified during this hardware verification.

## Safety and next steps

Leave actuator loads and power disconnected. If further serial inspection is needed, close the Electron connection before opening another serial program. Do not upload firmware or send SELECT/START/STOP without separate approval and an appropriate safety review. A firmware report that outputs are disabled is not proof that the hardware is safe.
