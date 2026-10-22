# Nature Touch

Nature Touch is a Windows desktop application scaffold for the interactive exhibition. This repository currently contains a minimal Electron + React shell only. It does not communicate with Arduino hardware or control pumps or valves.

## Requirements

- Node.js 20 or newer and npm
- Windows for exhibition-machine testing

## Install and run

From the repository root:

```powershell
cd desktop
npm install
npm run dev
```

The development command starts the Vite renderer and opens it in Electron.

## Build and typecheck

Run these from `desktop/`:

```powershell
npm run typecheck
npm run build
npm run preview
```

`preview` opens the built Electron application. Packaging an installer is not configured in this foundation phase.

For the isolated Arduino Nano diagnostic procedure, see [docs/phase-1b-serial.md](docs/phase-1b-serial.md). Keep all actuator loads and power disconnected during those tests.

For the Phase 2B simulation-only unified firmware, protocol tests, upload procedure, and remaining safety gates, see [docs/phase-2b-integration.md](docs/phase-2b-integration.md). The Nano firmware emits source-timeline diagnostics only; it does not drive actuators.

## Project layout

- `desktop/electron/`: Electron main process and minimal preload bridge
- `desktop/renderer/`: Vite and React renderer placeholder
- `desktop/shared/`: shared device and proposed serial protocol types
- `firmware/`: diagnostic and unified Nano firmware; the unified build is simulation-only and has no physical output behavior
- `firmware/original/` and `references/original/`: reserved for unmodified source sketches and supplied project references
- `assets/audio/`: reserved for supplied local audio
- `docs/`: architecture and development plan
- `test/`: reserved for protocol and device tests

The original sketches and three MP3 assets are now available under `卒研music/`; see [docs/hardware-analysis.md](docs/hardware-analysis.md) for the source-level inventory and unresolved hardware questions. Preserve the sketches unchanged. The separate hardware schematic, driver details, and pressure-safety information remain unverified.

## Security and hardware boundary

Electron uses context isolation, disables Node integration in the renderer, enables sandboxing, and exposes a narrow typed API through preload. The local mock simulation is separate from the serial-controlled Nano simulation firmware. Neither simulation generates physical actuator signals.

Do not connect or operate tactile hardware based on this scaffold. Verify driver and pin mappings, pressure protection, and an independent physical actuator power cutoff before any live test.