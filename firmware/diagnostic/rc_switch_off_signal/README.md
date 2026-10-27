# RC Switch OFF Signal Diagnostic

Standalone Arduino Nano signal diagnostic for D5 (valve), D6 (suction pump), and D7 (inflation pump). It is not the unified firmware and does not determine physical OFF by itself.

## Before use

- Disconnect all pumps, valves, bags, and pneumatic loads from the electronic-switch outputs. Verify they cannot receive power through another path.
- Use a suitable isolated, current-limited test supply and an appropriate dummy load on the switch output. Establish the switch input limits and dummy-load rating before connecting anything; do not guess voltages or ratings.
- Measure the dummy-load side with suitable instruments. A signal command, indicator LED, or unloaded output voltage alone is not proof of OFF.
- Do not upload or connect this diagnostic while physical actuators remain connected.

## Operation

1. Compile and upload this sketch manually only after the load-isolation and test-fixture checks above.
2. Open Serial Monitor at 9600 baud with newline line endings. Startup attaches no Servo outputs.
3. Enter `ARM ISOLATED` only after personally confirming that all pneumatic loads are disconnected.
4. Send one explicit command at a time, for example `SET D5 90`. The sketch accepts only D5, D6, or D7 and a caller-supplied Servo value from 0 to 180; it never sweeps or changes values automatically.
5. Record the externally measured output behavior and test conditions. Test other values only as separate, explicit commands within limits established for the switch.
6. `DISARM` detaches the signal and clears the software confirmation. Detach is not asserted to be a physical OFF state.

Serial logging reports the selected pin and requested Servo value. It reports no physical ON/OFF conclusion. The operator must establish an OFF criterion from the applicable switch/load requirements and measured load-side voltage/current. Do not copy a measured result to the production driver until the test conditions and evidence have been reviewed.

## Physical observation record

Add a row for each explicitly tested command value. Record instrument readings and test conditions; use **PASS** only when the pre-established OFF criterion is met.

| Channel / load | Servo command | Switch supply and test fixture | Load-side voltage/current | OFF criterion and evidence | Result / reviewer / date |
|---|---:|---|---|---|---|
| D5 / valve |  |  |  |  |  |
| D6 / suction pump |  |  |  |  |  |
| D7 / inflation pump |  |  |  |  |  |
