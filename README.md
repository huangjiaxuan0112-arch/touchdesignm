# Nature Touch — v3.0 Exhibition Prototype

Nature Touch is a Windows Electron + React application for the WIND, WAVE, and
BUBBLE exhibition experiences. The v3.0 S01 prototype provides local software-only
media playback and keeps physical actuator control disabled. This repository is
not a packaged exhibition release.

## Runtime architecture

```text
ExhibitionHome / ExperiencePlayer
  -> typed preload API
  -> Electron Main ExhibitionLifecycleController
  -> ExperienceCoordinator
  -> MockExperienceController (current exhibition UI)

Firmware experience commands
  -> ExperienceCoordinator
  -> FirmwareService -> NativeSerialTransport -> Protocol v2 firmware

Read-only diagnostics and output-disabled test APIs
  -> Main process permission checks -> FirmwareService
```

The Main process owns READY → STARTING → WAITING (5s) → EXPERIENCE (15s) →
AWAIT_COMPLETION → COOLDOWN (at least 8s) → READY. Mock device COMPLETED, not
video `ended`, authorizes cooldown. The UI contains no STOP, Pause, Back, Replay,
firmware mode selector, ARM, or Bench controls.

The Home and Player contain no firmware mode selector, ARM, or Bench controls.
Normal launches keep real hardware control disabled. The pre-existing
`--open-air-bench` Main-process profile and its fixture/device checks are
preserved, but are not exposed by the Home UI; an isolated open-air bench
utility also remains outside the default test and build path. S01 uses the
existing local MP4 assets as temporary media; Waiting visuals are explicitly
marked temporary. Device completion is owned by the Main Mock controller.

The active firmware source is
`firmware/unified/nature_touch_unified/`. The retained `firmware/releases/`
directories are historical snapshots and build from their own sources; they
are not interchangeable with the active source. Physical configuration,
deployment identity, and pressure-protection validation remain unverified.

## Requirements

- Windows
- Node.js 20 or newer and npm
- Arduino CLI and AVR8js only for the offline firmware tests

## Install and run

From the repository root:

```powershell
cd desktop
npm install
npm run dev
```

## Build and tests

Run these commands from `desktop/`:

```powershell
npm run typecheck
npm test
npm run build
npm run preview
```

Electron Mock lifecycle and media tests:

```powershell
$env:NATURE_TOUCH_UI_RESULTS_DIR = Join-Path $env:TEMP "NatureTouch-UI-$([guid]::NewGuid().ToString('N'))"
npm run test:ui
npm run test:audio
```

Both commands run the same current lifecycle fixture. It replaces the SerialPort
enumerator and open method before Main loads; a COM enumeration or open attempt
fails the test. Results are written to a unique temporary directory outside the
repository.

Offline firmware checks:

```powershell
$env:UNIFIED_RESULTS = Join-Path $env:TEMP "NatureTouch-Unified-$([guid]::NewGuid().ToString('N'))"
$env:DRIVER_SAFETY_RESULTS = Join-Path $env:TEMP "NatureTouch-DriverSafety-$([guid]::NewGuid().ToString('N'))"
npm run test:firmware
```

`test:firmware` runs the unified simulation/AVR8js suite and the Real Driver
compile-block/GPIO-safety suite. Results are written to the supplied locations;
do not reuse a directory containing prior evidence. These tests do not connect
to COM or upload firmware.

The current package version is `0.1.0` and is not a release designation.
[`docs/build-manifest.json`](docs/build-manifest.json) records the prior Phase 0
baseline; it does not identify this v3.0 prototype build. The P0-05 firmware
source and configuration audit is in
[`docs/PHASE0_FIRMWARE_SOURCE_AUDIT.md`](docs/PHASE0_FIRMWARE_SOURCE_AUDIT.md).

## Hardware boundary

Do not treat a successful simulation, compile, or historical bench report as
authorization for connected or pressurized operation. No physical COM access,
firmware upload, actuator START, or pressure test was performed for Phase 0
final verification. The independent physical bench utility requires its own
review and explicit operator authorization; it is not launched by the normal
application.

Historical phase documents describe prior experiments and are not a current
product specification. iPad control and final exhibition media assets remain
out of scope for S01.
