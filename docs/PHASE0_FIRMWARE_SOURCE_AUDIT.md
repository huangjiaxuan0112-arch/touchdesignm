# Phase 0 Firmware Source and Configuration Audit

## Scope and method

This is a read-only audit of the checked-in source and release metadata at
`refactor/phase0-technical-debt`, HEAD
`6567fa5fd26e5839897d49804c3e48fb217c6875`. SHA-256 values below are calculated
from the exact files currently present in the worktree. No firmware test,
compiler, upload, COM access, or hardware command was run for this audit.

## Source roles

| Location | Role in this audit |
|---|---|
| `firmware/unified/nature_touch_unified/` | Active working firmware source and the source used by the unified-controller test harness. This is the only source tree to target for the planned Phase 0 refactor. |
| `firmware/releases/nature_touch_final_locked_20261029/nature_touch_unified/` | Retained locked release snapshot; historical reference, not the current active working source. Its adjacent `manifest.json` and ZIP are historical release records. |
| `firmware/releases/nature_touch_real_candidate_20261029/nature_touch_unified/` | Retained real-candidate snapshot. Its `build-real.ps1` builds from this snapshot, not from `firmware/unified/`. The release status explicitly says it has no real HEX and its physical output gates remain closed. |
| `firmware/releases/nature_touch_open_air_bench_20261029/nature_touch_unified/` | Isolated open-air bench snapshot. Its build script targets this snapshot; its recorded scope excludes a connected airbag and does not establish production authorization. |
| `firmware/diagnostic/` | Standalone diagnostic sketches and tools; not the active unified firmware. |
| `firmware/original/README.md` | States that verbatim original Arduino sketches should be placed here after receipt. No original sketch is present, so comparison against the supplied originals is not possible. |

`firmware/unified/nature_touch_unified/` contains the unified `.ino`, timeline,
driver selector, real driver, and simulated driver. The `.ino` owns Protocol v2
command/session handling and the HOST_TIMEOUT path; `experience-timelines.h`
contains the existing mode schedules; `actuator-driver.h` selects the actuator
implementation; and `real-actuators.h` / `simulated-actuators.h` implement the
selected driver behavior. The release build scripts intentionally compile the
local release snapshot. Do not treat a release-snapshot build as a build of the
active working source.

## Checked-in source SHA-256

Column paths are relative to each source tree listed in the header.

| File | Active unified | Locked snapshot | Real candidate | Open-air bench |
|---|---|---|---|---|
| `actuator-driver.h` | `177f7dd40ee5e636c8b24546e5bff41c91d372d2e02cc1fe0373aed7069488d4` | `177f7dd40ee5e636c8b24546e5bff41c91d372d2e02cc1fe0373aed7069488d4` | `177f7dd40ee5e636c8b24546e5bff41c91d372d2e02cc1fe0373aed7069488d4` | `38326b6aca5cdeb99f40ff5e07c6574fd142c916c03003b05e3b900c2962474d` |
| `experience-timelines.h` | `8e1dac9eff6e246b88b7a99c54baeeed096bdc4ae5e780780fed7649ab69cbff` | `8e1dac9eff6e246b88b7a99c54baeeed096bdc4ae5e780780fed7649ab69cbff` | `8e1dac9eff6e246b88b7a99c54baeeed096bdc4ae5e780780fed7649ab69cbff` | `8e1dac9eff6e246b88b7a99c54baeeed096bdc4ae5e780780fed7649ab69cbff` |
| `nature_touch_unified.ino` | `47d22ea888bccafe6cc2469b9eb76da2fc115658df4dbd1353a20e78b31fe823` | `47d22ea888bccafe6cc2469b9eb76da2fc115658df4dbd1353a20e78b31fe823` | `47d22ea888bccafe6cc2469b9eb76da2fc115658df4dbd1353a20e78b31fe823` | `47d22ea888bccafe6cc2469b9eb76da2fc115658df4dbd1353a20e78b31fe823` |
| `real-actuators.h` | `2bd11f3b79be88cd36fe00bcd01183b24e6f13ec1e07a1ec0d1403da77994156` | `361d31e6027119e134441ceca1ead8c87b7b5cba0c992c1e02fddf9ebb12dafe` | `1921dab6d326c8aa2d7e726f78f9b718e1f28de27c6206e7532a8664bc1eb945` | `a3c7142a53a88bacdfd9431d35c785fb388f0fe8a3cbea8477472afa4ae8b1c7` |
| `simulated-actuators.h` | `d3fae82cc3393ae08105d3f424f9b31a77cd1309926d81d78c2ad423e61355ba` | `d3fae82cc3393ae08105d3f424f9b31a77cd1309926d81d78c2ad423e61355ba` | `d3fae82cc3393ae08105d3f424f9b31a77cd1309926d81d78c2ad423e61355ba` | `d3fae82cc3393ae08105d3f424f9b31a77cd1309926d81d78c2ad423e61355ba` |

The locked ZIP `firmware/releases/nature_touch_final_LOCKED_20261029.zip` is
present (SHA-256
`098fab168ea6ebb14693b2aa80b81878eaaaea4f6ac673c704659b8722e56b79`).
Its contents were not unpacked or reconciled against the adjacent directory in
this audit.

## Manifest hash discrepancies

The following comparisons are between a manifest declaration and the exact
source file at the corresponding path in that release directory. “Declared”
values are metadata, not independently verified provenance. A mismatch does
not, by itself, establish why it occurred.

### Locked snapshot: `manifest.json`

| Manifest field | File | Declared SHA-256 | Current file SHA-256 |
|---|---|---|---|
| `sourceSha256` | `nature_touch_unified/actuator-driver.h` | `76078824c6e9be9d34890ec6cc6616f176b322a86d98ea54044bdf901f0640b9` | `177f7dd40ee5e636c8b24546e5bff41c91d372d2e02cc1fe0373aed7069488d4` |
| `sourceSha256` | `nature_touch_unified/real-actuators.h` | `b9996d28832e832377f7bc7a6e647b61805818d84c4213cba65b716255a71756` | `361d31e6027119e134441ceca1ead8c87b7b5cba0c992c1e02fddf9ebb12dafe` |
| `sourceSha256` | `nature_touch_unified/simulated-actuators.h` | `21a1a831bfb8543a43fb3db34c62b0e241247e8b204d37b8bab677d9ec1a1d1b` | `d3fae82cc3393ae08105d3f424f9b31a77cd1309926d81d78c2ad423e61355ba` |

The `sourceSha256` declarations for the `.ino` and timeline match. All four
`clientSourceSha256` declarations in this manifest differ from the current
worktree files:

| File | Declared SHA-256 | Current worktree SHA-256 |
|---|---|---|
| `desktop/electron/main.ts` | `3de2b24664b9c26c33f4bd11b1c82b906a81dcdf82bc5434398460630357ee65` | `73c9ef9e9f23d83aac66868e1550b618b15988e5df808f0cffe34344299332b2` |
| `desktop/electron/serial/arduino-firmware-service.ts` | `a440afdc6b98b4abe919633f3a1e91fbe5d59f23849c2720e5c2723fe02983a4` | `d10775333ef0647f7ec5d419cde6e0d12d50d7d5d1d1065c99b146924f69db52` |
| `desktop/shared/firmware-control-protocol.ts` | `05c880f9260024babf786ad47b2bc3d2ec83a11701948329ce60dda3b8f23e21` | `8f93437b2acf205ce7f49064dbd6196ed19d79927c2b9b914a2df2a24ca6d032` |
| `desktop/renderer/src/device/ArduinoConnection.tsx` | `d21434c615a68e40c37f95fa7e56cc4ccc6ace5df0a9f0fa6a16f20704002c5f` | `d054e2c03c4a555937ca95058dc0e4dcf23b1c73d6b17ccf00772ffcbf0ee10e` |

### Real candidate: `release-status.json`

For both `workingSourceSha256` and `candidateSourceSha256`, the `.ino` and
timeline match. The `actuator-driver.h` and `simulated-actuators.h` entries in
both fields differ from the files. The `real-actuators.h` declaration differs
in each field:

| Manifest field | File | Declared SHA-256 | Current file SHA-256 |
|---|---|---|---|
| `workingSourceSha256` | `actuator-driver.h` | `76078824c6e9be9d34890ec6cc6616f176b322a86d98ea54044bdf901f0640b9` | `177f7dd40ee5e636c8b24546e5bff41c91d372d2e02cc1fe0373aed7069488d4` |
| `workingSourceSha256` | `simulated-actuators.h` | `21a1a831bfb8543a43fb3db34c62b0e241247e8b204d37b8bab677d9ec1a1d1b` | `d3fae82cc3393ae08105d3f424f9b31a77cd1309926d81d78c2ad423e61355ba` |
| `workingSourceSha256` | `real-actuators.h` | `b324447b262ea071fe218571e9f1510cd55fd14c32b6061cca803b5ffa21c8bb` | `1921dab6d326c8aa2d7e726f78f9b718e1f28de27c6206e7532a8664bc1eb945` |
| `candidateSourceSha256` | `actuator-driver.h` | `76078824c6e9be9d34890ec6cc6616f176b322a86d98ea54044bdf901f0640b9` | `177f7dd40ee5e636c8b24546e5bff41c91d372d2e02cc1fe0373aed7069488d4` |
| `candidateSourceSha256` | `simulated-actuators.h` | `21a1a831bfb8543a43fb3db34c62b0e241247e8b204d37b8bab677d9ec1a1d1b` | `d3fae82cc3393ae08105d3f424f9b31a77cd1309926d81d78c2ad423e61355ba` |
| `candidateSourceSha256` | `real-actuators.h` | `5df330638c6a6562ab296ea21e288ea63cc058507479e929de788fc528c653ca` | `1921dab6d326c8aa2d7e726f78f9b718e1f28de27c6206e7532a8664bc1eb945` |

### Open-air bench: `bench-release.json`

The `.ino` and timeline declarations match. These three source declarations do
not:

| File | Declared SHA-256 | Current file SHA-256 |
|---|---|---|
| `actuator-driver.h` | `f2c7ad7b1d8b687d3fb6adb724234bad6be941bd8282849cde7139de299cd841` | `38326b6aca5cdeb99f40ff5e07c6574fd142c916c03003b05e3b900c2962474d` |
| `real-actuators.h` | `ce4527f8f8d5cac4244fd457402eae578beac2bbd6bb58b59cac5c4fd943333a` | `a3c7142a53a88bacdfd9431d35c785fb388f0fe8a3cbea8477472afa4ae8b1c7` |
| `simulated-actuators.h` | `21a1a831bfb8543a43fb3db34c62b0e241247e8b204d37b8bab677d9ec1a1d1b` | `d3fae82cc3393ae08105d3f424f9b31a77cd1309926d81d78c2ad423e61355ba` |

The tree proves that these values do not match. It does not establish whether
the cause was a later source copy, a stale manifest, or another event; no cause
is asserted here. No `.hex`, `.elf`, or `.bin` file is present under `firmware/`
in this checkout. The bench manifest records a historical HEX at an absolute
path on another machine; this audit did not verify that artifact.

## Hardware configuration comparison

The roles below follow the real-driver structs and code: D5 is the valve,
D6 is the suction/extraction pump, and D7 is the inflation pump. Pulse values
are microseconds. The columns describe source declarations and evidence labels,
not independent hardware verification or permission to operate.

| Source | D5 OFF/ON | D6 OFF/ON | D7 OFF/ON | STOP valve | Pump/valve settle | HOST_TIMEOUT | Relevant status |
|---|---:|---:|---:|---:|---:|---:|---|
| Active unified | 1200/1800 | 1200/1800 | 1200/1800 | 1200 selected, not verified | 500/300 ms, theory only / not measured | 5000 ms | D5/D7 mapping flags true; D6 mapping false; physical output and deployment gates closed |
| Locked snapshot | 1200/1800 | 544/2400 | 1200/1800 | 1200 selected, not bench verified | `UINT16_MAX` / unmeasured | 5000 ms | Historical D6 mapping flag true; physical release remains blocked |
| Real candidate snapshot | 1200/1800 | 1200/1800 | 1200/1800 | 1200 selected, not verified | 500/300 ms, normal functional operation reported; worst-case margins not established | 5000 ms | Mapping flags reported true; physical output, deployment, independent pressure protection, and timing verification gates remain closed |
| Open-air bench snapshot | 1200/1800 | 1200/1800 | 1200/1800 | 1200 selected, not verified for pressurized use | 500/300 ms, normal operation reported; worst-case margins not established | 5000 ms | Limited open-air bench scope; explicitly not approved for a connected airbag; production and overpressure gates remain closed |

`HOST_TIMEOUT_MS=5000` is the firmware's host-contact/run timeout in the unified
`.ino`; it is not evidence of physical USB disconnect detection. The unified
timeline retains the existing three-mode durations: WIND 24000 ms, WAVE
25000 ms, and BUBBLE 27420 ms. The active `.ino` also has `ACTUATOR_EVENT`
logical values; those are not pulse-width declarations and must not be confused
with the real driver's per-channel microsecond settings.

The release metadata reports normal operation and specific user observations
with limited scope. Those reports do not establish quantified pressure limits,
independent overpressure protection, worst-case shutdown margins, or production
authorization. The active working source's `D6_MAPPING_VERIFIED=false` also
differs from candidate/bench source flags and their reported status. Do not
silently reconcile these states or choose one pulse mapping as the final
physical truth.

## Build and test provenance / output isolation

- `test/unified-controller/verify.mjs` compiles the active
  `firmware/unified/nature_touch_unified/` sketch into a temporary build
  directory. Its result directory defaults to the tracked
  `test/unified-controller/results/`; set `UNIFIED_RESULTS` to a new directory
  outside the repository before a future run.
- `test/avr8js-wind/run-all.mjs` and `simulate.mjs` default to
  `test/avr8js-wind/results-step3/`, which contains existing evidence. Set
  `AVR_RESULTS_ROOT` to a new directory outside the repository; the runner
  passes it through to each mode. The harness also reads the historical
  preservation baseline under `test/avr8js-wind/results/`.
- `test/actuator-driver-safety/verify.mjs` uses a temporary compiler/build
  directory and defaults results to a newly created `docs/evidence` directory.
  Set `DRIVER_SAFETY_RESULTS` to a new directory outside the repository before
  a future run.
- `test/d7-real-driver/verify.mjs` uses the active unified source, temporary
  build material, and creates a uniquely named `docs/evidence/pneumatic-driver-*`
  directory. It has no results-root override in the inspected script; it does
  not overwrite an existing evidence directory, but its new evidence is written
  inside the repository.
- `firmware/releases/nature_touch_real_candidate_20261029/build-real.ps1` and
  `firmware/releases/nature_touch_open_air_bench_20261029/build-real.ps1` each
  point at their adjacent snapshot directory. They are separate release build
  targets, not substitutes for the active-source harness. No release build
  script was run during this audit.

Example for future offline validation from the repository root, with fresh
temporary output locations:

```powershell
$env:UNIFIED_RESULTS = Join-Path $env:TEMP ("nature-touch-unified-" + [guid]::NewGuid().ToString("N"))
node .\test\unified-controller\verify.mjs

$env:AVR_RESULTS_ROOT = Join-Path $env:TEMP ("nature-touch-avr-" + [guid]::NewGuid().ToString("N"))
node .\test\avr8js-wind\run-all.mjs

$env:DRIVER_SAFETY_RESULTS = Join-Path $env:TEMP ("nature-touch-driver-safety-" + [guid]::NewGuid().ToString("N"))
node .\test\actuator-driver-safety\verify.mjs
```

These are isolation examples only and were not executed. Do not run these
scripts with their default output paths when preserving the currently tracked
or historical evidence is required. Any future build/test report should record
the exact source directory, source hashes, toolchain/FQBN, output directory,
and whether the result is simulation, open-air bench, or a separately
authorized physical test.

## P0-05B1 conclusion

- Active source identified: `firmware/unified/nature_touch_unified/`.
- Release snapshots retained and distinguished from the active source.
- Manifest mismatches are enumerated above; their causes remain unknown.
- Configuration differences and security/evidence boundaries are recorded
  without changing any source, value, permission gate, release record, or
  Protocol v2 behavior.
- Original Arduino sketches have not been received into `firmware/original/`.
- No build, firmware test, COM access, upload, or hardware action was performed.
- The audit supports proceeding to P0-05B2 only after the manifest/source
  provenance discrepancies and the intended authority for differing physical
  configuration flags are explicitly handled. This document does not resolve
  them.
