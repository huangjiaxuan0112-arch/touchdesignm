// Opt-in REAL serial verification after an approved simulation-only upload.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ArduinoFirmwareService } from '../desktop/electron/serial/arduino-firmware-service'
import { NativeSerialTransport } from '../desktop/electron/serial/native-serial-transport'
import type { SerialTransport } from '../desktop/electron/serial/serial-transport'

async function main() {
  assert.ok(process.argv.includes('--loads-isolated'), 'Explicit current physical-isolation confirmation required')
  const portIndex = process.argv.indexOf('--port')
  const port = process.argv[portIndex + 1]
  assert.ok(portIndex >= 0 && /^COM\d+$/i.test(port), 'Specify the rediscovered port')
  const directory = resolve('docs/evidence/firmware-update-20261027')
  const evidence: {
    startedAtUtc: string; kind: string; port: string; writes: { at: number; request: Record<string, unknown> }[];
    frames: { at: number; message: Record<string, unknown> }[];
    checks: Record<string, unknown>; result?: string; error?: string; [key: string]: unknown
  } = { startedAtUtc: new Date().toISOString(), kind: 'REAL USB Nano; existing service and native transport',
    port, writes: [], frames: [], checks: {}, loadsPhysicallyIsolatedConfirmed: true }
  const native = new NativeSerialTransport()
  let line = ''
  const audited: SerialTransport = {
    listPorts: () => native.listPorts(),
    open: async (path, baud) => {
      const connection = await native.open(path, baud)
      connection.onData((chunk) => {
        line += chunk
        let end: number
        while ((end = line.indexOf('\n')) >= 0) {
          const frame = line.slice(0, end).trim(); line = line.slice(end + 1)
          if (frame) evidence.frames.push({ at: Date.now(), message: JSON.parse(frame) })
        }
      })
      const write = connection.write.bind(connection)
      connection.write = async (text) => {
        const request = JSON.parse(text) as Record<string, unknown>
        assert.ok(['IDENTIFY', 'STATUS_QUERY', 'SELECT', 'START', 'STOP'].includes(String(request.type)))
        evidence.writes.push({ at: Date.now(), request })
        await write(text)
      }
      return connection
    },
  }
  const service = new ArduinoFirmwareService(audited, { readOnly: true, allowSimulationTest: true, heartbeatIntervalMs: 15000 })
  const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))
  try {
    evidence.ports = await service.listPorts()
    evidence.initial = await service.connect(port)
    assert.equal(service.getSnapshot().identified, true)
    assert.equal(service.getSnapshot().experience.state, 'IDLE')
    const identity = evidence.frames.find(({ message }) => message.command === 'IDENTIFY' && message.type === 'ACK')!.message
    assert.equal(identity.protocol, 2)
    assert.equal(identity.hardwareOutputsEnabled, false)
    assert.ok((identity.capabilities as string[]).includes('SIMULATION_ONLY'))
    evidence.identify = identity
    evidence.checks.identifyAndIdle = 'PASS'
    await service.armSimulationTest(true, true)
    assert.equal((await service.selectExperience('selectStop', 'WIND')).accepted, true)
    assert.equal((await service.start('startStop', 'updatedStop')).accepted, true)
    evidence.running = await service.queryStatus('runningStatus')
    assert.equal(service.getSnapshot().experience.state, 'RUNNING')
    await pause(1100)
    evidence.stopAck = await service.stop('stopCheck', 'updatedStop')
    evidence.afterStop = await service.queryStatus('stoppedStatus')
    assert.equal(service.getSnapshot().experience.state, 'IDLE')
    assert.ok(evidence.frames.some(({ message }) => message.name === 'STOPPED' && message.operationId === 'updatedStop'))
    evidence.checks.windSelectStartStop = 'PASS'
    await service.selectExperience('selectLease', 'WIND')
    await service.start('startLease', 'updatedLease')
    const count = evidence.writes.length
    await pause(6500)
    assert.equal(evidence.writes.length, count, 'No accepted host traffic during timeout test')
    evidence.afterSilence = await service.queryStatus('timeoutStatus')
    const status = service.getSnapshot()
    assert.equal(status.experience.state, 'FAULT')
    assert.equal(status.experience.faultCode, 'HOST_TIMEOUT')
    assert.equal(status.simulationTestArmed, false)
    const fault = evidence.frames.find(({ message }) => message.name === 'FAULT' && message.operationId === 'updatedLease')!
    assert.equal(fault.message.code, 'HOST_TIMEOUT')
    evidence.faultEvent = fault
    evidence.checks.hostTimeout = 'PASS'
    const startWrite = evidence.writes.find(({ request }) => request.requestId === 'startLease')!
    const statusWrite = evidence.writes.find(({ request }) => request.requestId === 'timeoutStatus')!
    evidence.silentWriteGapMs = statusWrite.at - startWrite.at
    evidence.startWriteToFaultReceiptMs = fault.at - startWrite.at
    const starts = evidence.writes.filter(({ request }) => request.type === 'START').length
    await assert.rejects(service.start('blockedStart', 'notAllowed'), /read-only/)
    await pause(3000)
    evidence.faultStillLatched = await service.queryStatus('latchedStatus')
    assert.equal(service.getSnapshot().experience.faultCode, 'HOST_TIMEOUT')
    assert.equal(evidence.writes.filter(({ request }) => request.type === 'START').length, starts)
    assert.equal(evidence.frames.some(({ at, message }) => at > fault.at && message.operationId === 'updatedLease' &&
      ['ACTUATOR_EVENT', 'COMPLETED'].includes(String(message.name))), false)
    evidence.checks.noAutomaticRestart = 'PASS'
    evidence.softwareStoppedEvidence = {
      directPhysicalIntentReadback: false,
      explanation: 'Physical FAULT/HOST_TIMEOUT is observed. The flash-verified reviewed binary calls ActuatorSimulation::stopAll() before entering FAULT; compiled virtual execution independently records STOPPED. Protocol v2 does not serialize the SRAM intent on fault.',
    }
    evidence.review = JSON.parse(readFileSync(resolve('docs/evidence/firmware-upload-review-20261027/review-manifest.json'), 'utf8'))
    evidence.result = 'PASS'
  } catch (error) {
    evidence.result = 'FAIL'
    evidence.error = error instanceof Error ? error.stack : String(error)
    throw error
  } finally {
    evidence.finalDisconnect = await service.disconnect()
    evidence.finishedAtUtc = new Date().toISOString()
    writeFileSync(resolve(directory, 'post-upload-real.json'), JSON.stringify(evidence, null, 2) + '\n')
    console.log(JSON.stringify({ result: evidence.result, checks: evidence.checks, evidence: resolve(directory, 'post-upload-real.json') }))
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
