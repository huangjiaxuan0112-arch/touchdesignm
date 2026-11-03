// Isolated supervised bench entry. Reuses the existing Electron serial service.
// No frontend changes, uploads, automatic START, RECOVER, retries or mode cycles.
import { app } from 'electron'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { NativeSerialTransport } from './serial/native-serial-transport'
import { ArduinoFirmwareService } from './serial/arduino-firmware-service'

const project = resolve(__dirname, '../../..')
const release = JSON.parse(readFileSync(resolve(project,
  'firmware/releases/nature_touch_open_air_bench_20261029/bench-release.json'), 'utf8'))
const stopAfterArgument = process.argv.find(value => value.startsWith('--stop-after-ms='))
const stopAfterMs = stopAfterArgument ? Number(stopAfterArgument.split('=')[1]) : 2000
if (![2000, 7000, 22000].includes(stopAfterMs)) throw Error('Only the explicitly reviewed 2000/7000/22000ms bench pairs are supported.')
if (!process.argv.includes('--confirmed-open-air-bench') || !release.uploadVerified ||
    release.sha256 !== '1dc67169edc0b513be668bee0f4d9354152bf2124535ee4d0252fd97835d3ca0') {
  throw Error('Requires the reviewed, uploaded OPEN_AIR_BENCH_ONLY artifact and confirmed nonpressurizing fixture.')
}
const directory = mkdtempSync(resolve(project, 'docs/evidence/open-air-bench-session-'))
mkdirSync(directory, { recursive: true })
function log(kind: string, value: unknown) {
  const row = { at: new Date().toISOString(), kind, value }
  appendFileSync(resolve(directory, 'events.jsonl'), JSON.stringify(row) + '\n')
  console.log(JSON.stringify(row))
}
const transport = new NativeSerialTransport()
const nativeOpen = transport.open.bind(transport)
transport.open = async (port, baud) => {
  const connection = await nativeOpen(port, baud)
  const write = connection.write.bind(connection)
  connection.write = async line => { log('TX', JSON.parse(line)); await write(line) }
  let buffer = ''
  connection.onData(chunk => {
    buffer += chunk
    for (let cut; (cut = buffer.indexOf('\n')) >= 0;) {
      const raw = buffer.slice(0, cut).trim(); buffer = buffer.slice(cut + 1)
      log('RX', raw)
    }
  })
  return connection
}
// Permission belongs only to this explicitly selected bench process. The main
// exhibition app remains read-only. No connection event calls START.
const service = new ArduinoFirmwareService(transport, {
  readOnly: false, allowSimulationTest: false, allowRealHardwareControl: true,
})
const id = () => randomBytes(6).toString('hex')
let used = false, busy = false
async function status() { return service.queryStatus(id()) }
async function close() {
  if (busy) { log('REFUSED_EXIT', 'Wait for the authorized START/STOP pair to finish.'); return }
  await service.disconnect(); log('CLOSED', 'No automatic reconnect.'); app.exit(0)
}
app.whenReady().then(async () => {
  const ports = (await service.listPorts()).filter(port =>
    port.vendorId?.toUpperCase() === '1A86' && port.productId?.toUpperCase() === '7523' &&
    port.serialNumber === '5&26B53364&0&9')
  if (ports.length !== 1) throw Error('Previously identified Nano is missing or ambiguous.')
  log('DEVICE', ports[0])
  await service.connect(ports[0].path, 9600)
  const initial = await status()
  const device = service.getSnapshot()
  if (device.firmware !== 'nature-touch-unified-real' || device.hardwareOutputsEnabled !== true ||
      initial.snapshot.state !== 'IDLE' || initial.snapshot.operationId !== null) {
    throw Error('Expected the uploaded real bench firmware in inactive IDLE.')
  }
  writeFileSync(resolve(directory, 'session.json'), JSON.stringify({
    scope: 'AIRBAG_DISCONNECTED_OPEN_NONPRESSURIZING_BENCH_ONLY',
    startupObservation: 'USER_CONFIRMED_D6_D7_DID_NOT_SELF_START_AFTER_UPLOAD',
    power: 'USER_CONFIRMED_LOADS_RECONNECTED_TO_SOLE_USB_OPERATOR_PRESENT_CUTOFF_ACCESSIBLE',
    hexSha256: release.sha256, initial, startSentAtPreparation: false,
  }, null, 2) + '\n')
  log('READY_WAITING_FOR_EXPLICIT_AUTHORIZATION', {
    directory, snapshot: device, allowed: ['STATUS', `START_STOP_ONCE WIND ${stopAfterMs}`, 'EXIT'],
    note: 'The START/STOP pair is forbidden until the user explicitly authorizes it. No START was sent.',
  })
  const runCommand = async (line: string) => {
    if (busy) { log('REJECT_BUSY', line); return }
    if (line === 'EXIT') { await close(); return }
    if (line === 'STATUS') {
      busy = true
      try { log('STATUS', await status()) } catch (error) { log('ERROR', String(error)) }
      finally { busy = false }
      return
    }
    if (line !== `START_STOP_ONCE WIND ${stopAfterMs}` || used) { log('REJECT_COMMAND', line); return }
    // One explicit console command represents separately obtained authorization
    // for BOTH one WIND START and its timed STOP, not a repeating test cycle.
    busy = true; used = true
    try {
      const before = await status()
      if (before.snapshot.state !== 'IDLE') throw Error('Explicit inactive IDLE required.')
      const selected = await service.selectExperience(id(), 'WIND')
      if (!selected.accepted) throw Error('SELECT rejected.')
      const operation = id()
      const started = await service.start(id(), operation)
      if (!started.accepted) throw Error('START rejected.')
      log('START_ACK', started)
      await new Promise(resolve => setTimeout(resolve, stopAfterMs))
      const stopped = await service.stop(id(), operation)
      if (!stopped.accepted) throw Error('STOP rejected.')
      const after = await status()
      if (after.snapshot.state !== 'IDLE') throw Error('STOP did not confirm logical IDLE.')
      log('ONE_PAIR_FINISHED_AWAIT_PHYSICAL_OBSERVATION', { started, stopped, after })
    } catch (error) {
      log('FAULT_STOP_TESTING', String(error))
      const current = service.getSnapshot().experience
      if (current.state === 'RUNNING' && current.operationId) {
        try { log('PROTECTIVE_STOP', await service.stop(id(), current.operationId)) }
        catch (stopError) { log('CUT_USB_STOP_UNCONFIRMED', String(stopError)) }
      }
    } finally { busy = false }
  }
  // Windows GUI Electron may receive EOF on stdin. A deliberately supplied
  // one-shot command is an alternative explicit input, never a connection
  // default. The operator must obtain authorization for BOTH START and STOP.
  if (process.argv.includes('--authorized-start-stop-once')) {
    if (stopAfterMs === 22000) log('D6_OBSERVATION_PLAN', {
      mode: 'WIND', originalFinalDeflateAtMs: 19000, originalCompletionAtMs: 24000,
      stopAfterStartAckMs: 22000,
      expected: 'Final DEFLATE: D7 OFF, D5 OFF (A-R), D6 ON; explicit STOP while still in this phase.',
      scope: 'Open nonpressurizing bench; no firmware or timeline changes; physical observation required.',
    })
    log('EXPLICIT_ONE_SHOT_COMMAND', `WIND START followed by STOP ${stopAfterMs}ms after START ACK`)
    await runCommand(`START_STOP_ONCE WIND ${stopAfterMs}`)
    await close()
    return
  }
  const input = createInterface({ input: process.stdin })
  input.on('line', line => { void runCommand(line) })
  input.on('close', () => {
    if (!busy) void close()
    else log('INPUT_LOST', 'Authorized pair continues toward its scheduled STOP; no new START accepted.')
  })
}).catch(async error => { log('PREPARATION_FAILED', String(error)); await service.disconnect(); app.exit(1) })
