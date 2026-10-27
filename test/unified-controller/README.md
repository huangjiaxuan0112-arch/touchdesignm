# Unified simulation-only actuator controller

Run from the existing desktop project with Node 24:

```powershell
Set-Location .\desktop
npm test
npm run test:unified-actuators
```

The first command runs the existing 51 automated protocol/control/transport tests
with mocks; no physical serial transport is opened. The second compiles the
current unified firmware for `arduino:avr:nano:cpu=atmega328` using the installed
Arduino CLI, then executes that exact HEX in the existing AVR8js 0.21.1 dependency
from `test/avr8js-wind/node_modules`. No new dependency is required or installed.
The original sketches and their PWM tests are not rerun by this command.

The existing Arduino AVR core 1.8.8 and AVR compiler are prerequisites. Optional
`ARDUINO_CLI` and `AVR_NM` environment variables override the existing executables.
`UNIFIED_RESULTS` chooses a fresh evidence directory. Build files go into a unique
Windows temporary directory; no upload, monitor, port discovery or COM call occurs.

## What executes and what is measured

**Model qualification:** the final run uses an explicit test-side USART RXC
compatibility adapter in `avr-usart-compat.mjs`. Unmodified AVR8js 0.21.1 drops a
pending receive flag when Arduino toggles an unrelated UDRIE bit. This was
reproduced independently and caused a captured `requestId` to become `requetId`.
The adapter preserves an already pending RXC while RXEN remains enabled. It does
not replace bytes, responses, CPU execution or actuator records; firmware and
installed dependency files are unpatched. Every intervention is recorded in each
scenario's `usartRepairs`. Stock-model failures remain in the evidence directory.
The exact limitation and datasheet basis are in the Step 4 report. Do not describe
the final results as an unmodified AVR8js full-duplex pass.

The virtual Nano has 32 KiB flash, 2 KiB SRAM, timers 0/1/2, ports B/C/D and USART0
at 16 MHz. Protocol requests are delivered as virtual USART bytes with 9600-baud
frame timing. Firmware JSON replies are captured from virtual TX, rather than
invented by a fake protocol server.

An ELF-resolved SRAM hook observes the compiled actuator layer's last-written
revision byte. Each commit records its actual intention, the Arduino `millis()`
timestamp, command counter and virtual CPU-cycle time. Even consecutive inflation
calls produce separate commits. Expected timelines are used only for assertions.
Both D5/D6/D7 output changes and attempts to configure their DDR bits are monitored;
any such activity fails the scenario. Every captured JSON frame must also fit the
existing host's 384-character line limit.

Ten controller scenario groups plus one independent USART property regression
cover three-mode natural completion, BUBBLE repeat, STOP
before/during execution, mode changes after cancellation, duplicate/conflicting
requests, host lease expiry, invalid-traffic expiry, explicit fault recovery, and
preservation of previous evidence. Natural runs retain every expected action and
use actual STATUS_QUERY heartbeats while asserting action/completion timing within
2 ms of the calibrated Arduino `millis()` deadlines.

The actuator fault is injected **only in the virtual CPU SRAM** by setting the
compiled `ActuatorSimulation::faultLatched` byte. This is not a wire protocol
command, a physical sensor test or a detected electrical failure. Host silence is
simulated by withholding valid protocol messages, not by electrically disconnecting
USB. Existing host disconnect tests use mock transports separately.

## Evidence

- `results/results.json`: build provenance, assertions, every virtual JSON reply,
  intention commits, logical timing, raw virtual elapsed time and protected hashes.
- `results/unified.hex.txt`: the exact executed application HEX.
- `results/symbols.txt`, `results/compile.log`: ELF symbols and Nano memory usage.
- `results/protocol-tests.log`, `results/typecheck.log`: final existing-suite and
  TypeScript verification from this development session (run `npm test` and
  `npm run typecheck` to refresh those checks separately).
- `results/initial-validation.json`: retained first iteration failure and measured
  telemetry-induced timing offsets, before the cooperative serial fix.
- `results/pre-final-regression.json`, `results/failure-WIND.json`: retained stock
  USART model failure, including the received request missing a character.

`caseFilter:null` identifies a complete run. `UNIFIED_CASE` can filter names for
debugging; a filtered result is not an all-scenarios pass. Optional `TRACE_STACK=1`
samples SP at every instruction; the default records SP at virtual TX callbacks
only, so its stack low-water value is a sample, not a worst-case proof.

Exit 0 means every scenario passed; exit 1 means a build/runtime/assertion failure.
The summary is set to INCOMPLETE before building so stale PASS results cannot
masquerade as the current run. The historical initial-validation file is not
regenerated on reruns. Use `UNIFIED_RESULTS` if retaining separate reruns.

The controller preserves protocol v2 identity and diagnostic fields. The old
`ACTUATOR_EVENT` numeric D5/D6/D7 values are printed compatibility data only; the
new `stopAll()` has no pin or physical OFF pulse mapping. A simulation-only STOPPED
intention is not a guarantee about RC switches or pneumatic hardware.

See [Step 4 documentation](../../docs/phase-3b-step4-unified-controller.md).
