# Nature Touch Phase 0 Handoff

## Status and baseline

- Phase 0 software acceptance: **PASS**.
- Branch: `refactor/phase0-technical-debt`.
- Phase 0 application and test commit: `02528785b2bd65b20009c5a791e483cb38b6b4e2`.
- Its parent is the P0-05 scheduler refactor, `dcf3f3bdf487656e898a5d15de4c087c18ceabb5`.
- `main` and `backup/phase0-baseline-69ccc5e` remain at `69ccc5e70aa764b1a65cb1a386af17617a112870`.
- The package version `0.1.0` is not a release version. See [the Build Manifest](./build-manifest.json) and [the final report](./PHASE0_FINAL_REPORT.md).

## Runtime responsibilities

```text
Normal exhibition UI
  ExhibitionHome / ExperiencePlayer
    -> typed preload API
    -> Electron Main ExperienceCoordinator
    -> MockExperienceController

Firmware control services
  -> Electron Main ExperienceCoordinator
  -> ArduinoFirmwareService / FirmwareService
  -> NativeSerialTransport
  -> Protocol v2 firmware
```

The audience Home no longer exposes firmware selection, Simulation ARM, or
Bench controls. It uses the Mock controller for local playback. The normal
application launch keeps real output disabled. The pre-existing
`--open-air-bench` Main-process profile and its reviewed-device and fixture
checks remain isolated and were not used by final validation; the independent
bench utility is also retained.

The Coordinator remains the application lifecycle authority. Media readiness,
playback, synchronization, cancellation, and cleanup remain in the Player.
Device status and completion are not inferred from local media duration.

## Delivered in Phase 0

- Centralized lifecycle coordination and idempotent STOP handling.
- Simplified Home and Player lifecycle while preserving async cancellation,
  media synchronization, the current independent MP3 plus looping muted MP4,
  current timeline durations, and fault/disconnect cleanup.
- Extracted the firmware Scheduler while retaining Protocol v2, `millis()`
  deadlines, PROGMEM timelines, and the active hardware-output gates.
- Removed the unused `ArduinoConnection` UI and audience-facing hardware
  controls; retained the separate bench path and its safety checks.
- Added bounded local JSONL logs under
  `%APPDATA%\\Nature Touch\\logs\\app.jsonl` (2 MiB per file, up to 5 files).
  Entries include the app commit and `UNVERSIONED` hardware config marker;
  they do not include raw serial payloads or port paths.
- Added the bounded-log tests, isolated firmware test entry point, a Windows
  build manifest, and this handoff.

## Verification

The final software and offline firmware matrix is recorded in
[the Build Manifest](./build-manifest.json). It was run against application
commit `02528785b2bd65b20009c5a791e483cb38b6b4e2`; evidence is outside the Git
repository at:

`D:\touch\NatureTouch-Phase0-Evidence\P006-P007-Commit-0252878-20261103-174601-49145168`

Re-run from `desktop\` using PowerShell:

```powershell
npm run typecheck
npm test
npm run build
$env:NATURE_TOUCH_UI_RESULTS_DIR = Join-Path $env:TEMP "NatureTouch-UI-$([guid]::NewGuid().ToString('N'))"
npm run test:ui
npm run test:audio
$env:UNIFIED_RESULTS = Join-Path $env:TEMP "NatureTouch-Unified-$([guid]::NewGuid().ToString('N'))"
$env:DRIVER_SAFETY_RESULTS = Join-Path $env:TEMP "NatureTouch-DriverSafety-$([guid]::NewGuid().ToString('N'))"
npm run test:firmware
```

These are software-only checks. Electron UI fixtures block serial enumeration
and opening; firmware tests compile and run in AVR8js. No COM port was accessed,
no HEX was uploaded, and no physical actuator was started.

## Open hardware and product dependencies

Do not treat this software PASS as hardware approval. Before deployment, a
responsible hardware operator must independently review and verify:

- The physical board and firmware identity, approved build, and any flash /
  verify record. None is established by the simulation HEX in the Manifest.
- The `UNVERSIONED` hardware configuration and actual D5/D6/D7 mapping and
  pulse behavior. In particular, D6's mapping remains unverified.
- OFF/reset behavior, STOP valve behavior, settling assumptions, pressure
  protection, fault behavior under physical loads, and sustained operation.
- The retained open-air bench profile's fixture and operator conditions before
  any separate, explicitly authorized bench session.

See [the firmware source audit](./PHASE0_FIRMWARE_SOURCE_AUDIT.md) for the
recorded source and configuration comparisons. Historical release hashes and
bench observations must not be interpreted as current physical verification.

## v3.0 entry

Software development for the final v3.0 plan can begin from this branch and
baseline. The following product work is deliberately **not implemented** and
must remain separate, reviewable work packages:

- The 5-second Waiting, 15-second single audiovisual experience, and minimum
  8-second Cooldown.
- The new audience interaction lock and iPad control/API.
- New final three-mode actuator timelines and any corresponding media changes.
- Hardware configuration approval, physical tests, installer packaging, and
  multi-hour / multi-day exhibition operation.

Keep physical-output work blocked until the hardware dependencies above have
their own evidence and authorization. To roll back a Phase 0 work-package
commit, use `git revert` on the specific commit; do not reset or clean the
preserved branch history.
