# Nature Touch Phase 0 Final Report

## Result

**Phase 0 software acceptance: PASS.** This is not a physical hardware or
pressurized-system pass, nor a packaged release.

## Architecture and scope

The formal experience lifecycle is coordinated by Electron Main's
`ExperienceCoordinator`; Home submits experience intents and Player owns media
preparation, synchronization, cancellation, and cleanup. The normal
exhibition UI uses the Mock controller and exposes no firmware mode, ARM, or
Bench controls. Firmware services remain behind the Coordinator and retain the
Protocol v2 and real-output gates. The reviewed open-air bench profile remains
separate and was not used.

Phase 0 preserved current media and timelines, centralized lifecycle/STOP
coordination, extracted firmware Scheduler responsibilities, removed the
unused `ArduinoConnection` UI, added bounded local logs, and aligned the
project README and test entry points. No Arduino, Protocol v2, media asset,
hardware parameter, or historical release file was changed in finalization.

## Verification

Verified on Windows against application commit
`02528785b2bd65b20009c5a791e483cb38b6b4e2`:

- TypeScript typecheck: PASS.
- Core tests: **118/118 PASS**.
- Electron/Vite build: PASS.
- Electron Mock UI: **10/10 PASS**; includes cancellation, one START per
  experience, STOP/COMPLETED, FAULT/disconnect cleanup, and a hard block on
  real serial enumeration/open.
- Electron audio: PASS for WIND, WAVE, and BUBBLE; actual video/audio playback,
  mock natural completion, and media cleanup verified.
- Unified firmware simulation/AVR8js: **11/11 PASS**; Protocol, current
  timelines, STOP, FAULT, and HOST_TIMEOUT covered.
- Real Driver Safety: **5/5 PASS**; real selector compilation remains blocked;
  zero GPIO edges and zero output-mode transitions.
- `git diff --check`: PASS.

The offline simulation build used 10,770 bytes Flash and 1,379 bytes SRAM, with
the current WIND/WAVE/BUBBLE durations of 24,000/25,000/27,420 ms. See
[the Build Manifest](./build-manifest.json) for tool versions, source hashes,
simulation HEX hash, and the external evidence directory.

## Git and deliverables

- Branch: `refactor/phase0-technical-debt`.
- Application/test commit: `02528785b2bd65b20009c5a791e483cb38b6b4e2`.
- `main` and `backup/phase0-baseline-69ccc5e` remain unchanged at
  `69ccc5e70aa764b1a65cb1a386af17617a112870`.
- Final documentation adds the Build Manifest, this report, and
  [the handoff](./PHASE0_HANDOFF.md).
- Test outputs remain outside the repository; the tracked historical UI
  evidence was not overwritten.

## Remaining risks and next step

The software is ready as a v3.0 development baseline. Physical deployment is
still unverified: the hardware config is `UNVERSIONED`, no firmware was flashed
or verified on a device, no COM or actuator was used, and physical mapping,
pressure safety, reset/OFF behavior, and sustained operation remain open.
The new v3.0 Waiting/Cooldown, audience lock, iPad control, and final actuator
timelines are not implemented. See [the handoff](./PHASE0_HANDOFF.md) before
starting those work packages.
