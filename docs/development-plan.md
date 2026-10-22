# Nature Touch Development Plan

## Starting point

The initial scaffold was created in an empty workspace. The three original sketches, three MP3s, and a Japanese infographic have since been added under `卒研music/` and inspected in [hardware-analysis.md](hardware-analysis.md). Their physical wiring, driver behavior, safety provisions, and measured timing remain unverified; no separate hardware schematic or textual requirements document was found in the current inventory.

The sequence below is hardware-first and deliberately keeps Arduino bring-up independent of the React UI. Do not begin human-contact tests until the driver mapping, pressure protection, and independent cutoff have been verified.

## Phases and acceptance criteria

### 0. Inventory and safety review

**Dependencies:** source files, board, driver/component documentation, wiring and pneumatic parts.

**Work:** collect the three sketches without modifying them; inventory audio/video, Chinese requirements, and photos; record board/driver/valve/pump identities; produce a pin and wiring map; identify pressure regulation/relief and physical cutoff requirements.

**Acceptance:** each supplied artifact is accounted for; original sketches are preserved; unknowns are recorded by owner and resolution method; no actuator is energized until electrical and pressure risks are reviewed.

### 1. Verify USB serial communication

**Dependencies:** Arduino Nano, USB cable, Arduino IDE/toolchain, known-good host serial terminal; actuators disconnected.

**Work:** identify board variant/driver, COM port and baud rate; upload a serial-only diagnostic sketch or use an existing harmless diagnostic; verify reset behavior and repeatable connect, message, disconnect, and reconnect. Agree and document protocol framing/version.

**Acceptance:** repeated USB sessions exchange bounded newline-delimited messages without actuator power; port selection and reset-on-open behavior are documented; malformed input and unplug are observed safely. No pump-control firmware is part of this phase.

### 2. Verify hardware control mapping and safe shutdown

**Dependencies:** completed wiring/driver identification, bench instruments, independent actuator power cutoff, pressure safety components, supervised test procedure.

**Work:** with loads initially disconnected, confirm pin-to-driver mapping, polarity, reset/boot levels, and verified off behavior; then test each channel separately under controlled conditions. Confirm how to isolate/depressurize the pneumatic system. Do not use `Servo.write()` values as an assumed OFF command.

**Acceptance:** signed-off pin map and output truth table exist; power-up, Arduino reset, USB loss, host loss, cancel, and physical cutoff are tested; the physical cutoff removes actuator power; pressure limits and relief method are documented. Any unresolved unsafe state blocks the next phase.

### 3. Integrate Arduino movement patterns

**Dependencies:** phase 2 acceptance; original sketches and a timing measurement method.

**Work:** compare all sketches, identify common output logic and mode-specific sequences, preserve calibrated timing, and implement the minimum dispatcher/protocol/state handling. Use `millis()`-based progression so cancellation and serial input remain serviceable. Establish and test `BOOT_SAFE`, idle, prefill/ready, running, stopping, and fault behavior. Keep a reference copy of the originals.

**Acceptance:** all three modes match their baseline timing and output order within an agreed measurement tolerance; mode switching is rejected while running or proceeds only after verified stop; READY means prefill is complete; cancel/reset/watchdog enter the verified safe state; protocol parser handles invalid/oversized input without blocking timing. No frontend dependency.

### 4. Build Electron device communication

**Dependencies:** stable firmware protocol and hardware behavior from phases 1-3; Node.js and Windows build environment.

**Work:** implement main-process serial ownership, bounded framing/parser, request correlation, lifecycle/timeouts, typed and validated IPC, and real/mock device adapters. Keep renderer isolated with context isolation and Node integration disabled.

**Acceptance:** mock and hardware adapter share the same device contract; tests cover connect, handshake, prepare/READY, start/STARTED, cancel/STOPPED, timeout, malformed response, unplug, reset, and reconnect; disconnect never resumes a run; unauthorized IPC payloads cannot issue device commands.

### 5. Build React UI

**Dependencies:** reviewed architecture and stable preload API; mock adapter available.

**Work:** implement HOME and EXPERIENCE screens, WIND/WAVE/BUBBLE selection, readiness gating, device status, progress/error states, and cancel/return flow. Use the mock adapter for iteration without attached hardware.

**Acceptance:** all normal and error UI flows work against deterministic mock events; start is disabled unless ready; device status derives from main-process state; errors are visible and recoverable; window close and navigation do not leave the UI claiming an active run.

### 6. Integrate media and synchronization

**Dependencies:** mode-to-media mapping confirmed from requirements/assets; phase 4 and 5; exhibition PC/audio/video devices.

**Work:** package local assets; map the three MP3s to modes; add video only if confirmed as required; start media on correlated STARTED and stop on STOPPED/fault; measure end-to-end offset and jitter on the target machine.

**Acceptance:** correct media plays for each mode; missing/corrupt assets produce a recoverable error without unsafe actuator behavior; measured audio/device synchronization meets an agreed exhibition tolerance; repeated trials and reconnect behavior are recorded. Any extra synchronization mechanism must be justified by measurements and must preserve the Arduino pattern timing.

### 7. Test and package the exhibition application

**Dependencies:** phases 0-6 accepted; final target Windows machine and installation procedure.

**Work:** run supervised end-to-end and fault-injection tests; package an offline installer/app with firmware version and asset manifest; document startup, port selection, cutoff, recovery, and shutdown for operators.

**Acceptance:** clean install and offline startup work on the target Windows machine; all three modes pass repeated trials; disconnect, crash, reset, and cutoff tests have recorded outcomes; operator runbook and known limitations are reviewed; application never claims physical safety based only on a software state.

## Dependencies and sequence gates

The USB serial proof (phase 1) can proceed without actuator wiring and must precede host serial integration. Hardware mapping and physical safe shutdown (phase 2) gate live pattern tests. Pattern integration (phase 3) can proceed without React. Electron communication uses the agreed firmware contract; React can develop against the mock adapter while real-device integration proceeds, but media synchronization and exhibition acceptance depend on working device events and the actual exhibition hardware.

Use the project's selected Arduino toolchain and Windows-supported Node/Electron/SerialPort versions only after inspecting the available board and build environment. Pin package versions at implementation time and verify Electron native-module compatibility for the chosen SerialPort release. No dependencies need to be installed for this architecture review.

## Risks and unresolved questions

| Question / risk | Why it matters | Resolution before |
| --- | --- | --- |
| What exact Nano variant, USB-serial chip, bootloader, and serial settings are present? | Port behavior, reset-on-open, memory, and upload path vary | Phase 1 |
| What are the driver models/topology, input polarity, pins, current ratings, flyback protection, and supply? | No safe output level or wiring can be assumed | Phase 2 |
| Is the valve normally open/closed, and what happens on power loss? | Determines pressure release and failure behavior | Phase 2 |
| What pressure limits, regulator, relief valve, check valves, tubing ratings, and cutoff are installed? | Tactile contact requires controlled pneumatic energy and independent stop | Before any human-contact test |
| What do sketches do at boot, reset, prefill, completion, and during blocking delays? | Integration must preserve timing and make cancel/fault handling safe | Phase 3 |
| Do the sketches share pins, timers, libraries, or serial output? | Determines smallest safe integration strategy | Phase 3 |
| What exact Windows-to-firmware and audio timing tolerance is acceptable? | Serial ACK synchronization has measurable latency/jitter | Phase 6 |
| Which supplied audio file maps to which mode; is video required? | Prevents incorrect or unnecessary media behavior | Phase 6 |
| Which Windows version, target PC, audio output, screen, and operator workflow? | Packaging and exhibition reliability depend on deployment context | Phase 7 |
| What are the requirements document's explicit safety/experience constraints? | The brief may omit installation-critical behavior | Before implementation approval |

## Recommended first implementation task

After architecture review and artifact handoff, perform **USB serial bring-up with the Arduino physically connected but all pumps and valve power disconnected**. Verify board/COM-port identity, reset-on-open behavior, baud/framing, and repeatable connect/message/unplug/reconnect using a harmless diagnostic. This is the smallest test that validates the first hardware/software boundary without making unverified actuator assumptions. In parallel, inventory the original sketches and hardware photos for the phase 2 safety review; do not modify sketches or flash pump-control firmware as part of this first task.