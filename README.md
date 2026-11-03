# Nature Touch — Phase 0

Nature Touch is a Windows Electron + React application for the WIND, WAVES, and
BUBBLES exhibition experiences. The normal Phase 0 exhibition launch provides
local software-only media playback and keeps physical actuator control disabled.
This repository is not a packaged exhibition release.

## Runtime architecture

```text
ExhibitionHome / ExperiencePlayer
  -> typed preload API
  -> Electron Main ExperienceCoordinator
  -> MockExperienceController (current exhibition UI)

Firmware experience commands
  -> ExperienceCoordinator
  -> FirmwareService -> NativeSerialTransport -> Protocol v2 firmware

Read-only diagnostics and output-disabled test APIs
  -> Main process permission checks -> FirmwareService
```

The Home and Player contain no firmware mode selector, ARM, or Bench controls.
Normal launches keep real hardware control disabled. The pre-existing
`--open-air-bench` Main-process profile and its fixture/device checks are
preserved, but are not exposed by the Home UI; an isolated open-air bench
utility also remains outside the default test and build path. The UI plays the
local MP3 with a muted looping MP4; device completion is owned by the
Coordinator/Mock controller, not by the media duration.

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

Electron Mock UI and Audio tests:

```powershell
$env:NATURE_TOUCH_UI_RESULTS_DIR = Join-Path $env:TEMP "NatureTouch-UI-$([guid]::NewGuid().ToString('N'))"
npm run test:ui
npm run test:audio
```

The UI/Audio fixtures replace the SerialPort enumerator and open method before
Main loads; a COM enumeration or open attempt fails the test. The UI test keeps
its historical output path when `NATURE_TOUCH_UI_RESULTS_DIR` is unset, so use
a fresh external directory when preserving earlier evidence matters.

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

The current package version is `0.1.0` and is not a release designation. See
[`docs/build-manifest.json`](docs/build-manifest.json) for the recorded software
and firmware identity, and [`docs/PHASE0_HANDOFF.md`](docs/PHASE0_HANDOFF.md)
for remaining software and physical-validation work. The P0-05 firmware source
and configuration audit is in
[`docs/PHASE0_FIRMWARE_SOURCE_AUDIT.md`](docs/PHASE0_FIRMWARE_SOURCE_AUDIT.md).

## Hardware boundary

Do not treat a successful simulation, compile, or historical bench report as
authorization for connected or pressurized operation. No physical COM access,
firmware upload, actuator START, or pressure test was performed for Phase 0
final verification. The independent physical bench utility requires its own
review and explicit operator authorization; it is not launched by the normal
application.

Historical phase documents describe prior experiments and are not a current
product specification. The v3.0 Waiting, iPad control, Cooldown, and audience
interaction-lock features have not been implemented.
