import { useEffect, useState } from 'react'
import type { RuntimeInfo } from '../../../shared/ipc'
import { EXPERIENCE_IDS, EXPERIENCE_DEFINITIONS, type ExperienceId } from '../../../shared/experience-definitions'
import type { ExperienceAcknowledgement, ExperienceSnapshot, ExperienceStatusResponse } from '../../../shared/experience-control-protocol'
import { DEFAULT_SERIAL_BAUD_RATE, type SerialPortInfo, type SerialStateSnapshot } from '../../../shared/serial-protocol'
import {
  INITIAL_FIRMWARE_CONTROL_SNAPSHOT,
  type FirmwareControlSnapshot,
} from '../../../shared/firmware-control-protocol'

export default function App() {
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [ports, setPorts] = useState<SerialPortInfo[]>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [baudRate, setBaudRate] = useState(DEFAULT_SERIAL_BAUD_RATE)
  const [serialState, setSerialState] = useState<SerialStateSnapshot>({ state: 'disconnected' })
  const [experienceState, setExperienceState] = useState<ExperienceSnapshot>({
    state: 'IDLE',
    selectedExperienceId: null,
    operationId: null,
    elapsedMs: 0,
    durationMs: null,
    progress: 0,
    faultCode: null,
  })
  const [selectedExperience, setSelectedExperience] = useState<ExperienceId>('WIND')
  const [experienceMessage, setExperienceMessage] = useState('')
  const [firmwareState, setFirmwareState] = useState<FirmwareControlSnapshot>(INITIAL_FIRMWARE_CONTROL_SNAPSHOT)
  const [firmwareMessage, setFirmwareMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    void window.natureTouch.getRuntimeInfo().then(setRuntimeInfo)
    void window.natureTouch.getSerialState().then(setSerialState)
    void window.natureTouch.getExperienceState().then(setExperienceState)
    void window.natureTouch.getFirmwareState().then(setFirmwareState)
    void refreshPorts()
    const removeSerialListener = window.natureTouch.onSerialState(setSerialState)
    const removeExperienceListener = window.natureTouch.onExperienceState(setExperienceState)
    const removeFirmwareListener = window.natureTouch.onFirmwareState(setFirmwareState)
    const progressTimer = window.setInterval(() => {
      void window.natureTouch.getExperienceState().then(setExperienceState)
    }, 100)
    return () => {
      removeSerialListener()
      removeExperienceListener()
      removeFirmwareListener()
      window.clearInterval(progressTimer)
    }
  }, [])

  async function refreshPorts(): Promise<void> {
    try {
      const availablePorts = await window.natureTouch.listSerialPorts()
      setPorts(availablePorts)
      setSelectedPort((current) => current || availablePorts[0]?.path || '')
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  async function runAction(action: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    setActionError('')
    try {
      await action()
      setSerialState(await window.natureTouch.getSerialState())
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
      setSerialState(await window.natureTouch.getSerialState())
    } finally {
      setBusy(false)
    }
  }

  async function runExperienceAction(action: () => Promise<unknown>): Promise<void> {
    setExperienceMessage('')
    try {
      const result = await action()
      if (result && typeof result === 'object' && 'accepted' in result && !result.accepted) {
        const rejection = result as ExperienceAcknowledgement
        setExperienceMessage(`Rejected: ${rejection.code ?? 'INVALID_COMMAND'}`)
      } else if (result && typeof result === 'object' && 'snapshot' in result) {
        const status = result as ExperienceStatusResponse
        setExperienceMessage(status.acknowledgement.accepted ? 'Status received.' : `Rejected: ${status.acknowledgement.code ?? 'INVALID_COMMAND'}`)
        setExperienceState(status.snapshot)
      } else {
        setExperienceMessage('Mock controller updated.')
      }
      setExperienceState(await window.natureTouch.getExperienceState())
    } catch (error) {
      setExperienceMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function runFirmwareAction(action: () => Promise<unknown>): Promise<void> {
    setFirmwareMessage('')
    try {
      const result = await action()
      if (result && typeof result === 'object' && 'accepted' in result && !result.accepted) {
        const rejection = result as ExperienceAcknowledgement
        setFirmwareMessage(`Rejected: ${rejection.code ?? 'INVALID_COMMAND'}`)
      } else if (result && typeof result === 'object' && 'snapshot' in result) {
        const status = result as ExperienceStatusResponse
        setFirmwareMessage(status.acknowledgement.accepted ? 'Firmware status received.' : `Rejected: ${status.acknowledgement.code ?? 'INVALID_COMMAND'}`)
      } else if (result && typeof result === 'object' && 'experience' in result) {
        setFirmwareState(result as FirmwareControlSnapshot)
        setFirmwareMessage('Protocol v2 firmware identified. Simulation-only controls are ready.')
      } else {
        setFirmwareMessage('Firmware command acknowledged.')
      }
      setFirmwareState(await window.natureTouch.getFirmwareState())
    } catch (error) {
      setFirmwareMessage(error instanceof Error ? error.message : String(error))
      setFirmwareState(await window.natureTouch.getFirmwareState())
    }
  }

  function makeRequestId(): string {
    return crypto.randomUUID()
  }

  function makeFirmwareId(): string {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  }

  const isConnected = serialState.state === 'connected'
  const canSelectExperience = experienceState.state === 'IDLE' || experienceState.state === 'COMPLETED'
  const canStartExperience = experienceState.state === 'IDLE' && experienceState.selectedExperienceId !== null
  const canStopExperience = experienceState.state === 'RUNNING' && experienceState.operationId !== null
  const firmwareConnected = firmwareState.connectionState === 'connected'
  const firmwareIdentified = firmwareConnected && firmwareState.identified
  const canSelectFirmwareExperience = firmwareIdentified &&
    (firmwareState.experience.state === 'IDLE' || firmwareState.experience.state === 'COMPLETED')
  const canStartFirmwareExperience = firmwareIdentified &&
    firmwareState.experience.state === 'IDLE' &&
    firmwareState.experience.selectedExperienceId !== null
  const canStopFirmwareExperience = firmwareIdentified &&
    (firmwareState.experience.state === 'RUNNING' ||
      (firmwareState.experience.state === 'FAULT' && firmwareState.experience.operationId !== null))

  return (
    <main className="placeholder">
      <p className="eyebrow">Nature Touch</p>
      <h1>USB serial diagnostics</h1>
      <p className="status">Keep all pumps, valves, and actuator power disconnected during this test.</p>
      <p className="runtime">
        {runtimeInfo
          ? `Version ${runtimeInfo.appVersion} · ${runtimeInfo.platform}`
          : 'Loading application information...'}
      </p>
      <section className="diagnostics" aria-label="Serial diagnostic controls">
        <div className="serial-fields">
          <label>
            Serial port
            <select
              value={selectedPort}
              onChange={(event) => setSelectedPort(event.target.value)}
              disabled={isConnected || busy}
            >
              <option value="">Select a port</option>
              {ports.map((port) => (
                <option key={port.path} value={port.path}>
                  {port.path}{port.manufacturer ? ` · ${port.manufacturer}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Baud rate
            <input
              type="number"
              min="300"
              max="2000000"
              step="1"
              value={baudRate}
              onChange={(event) => setBaudRate(Number(event.target.value))}
              disabled={isConnected || busy}
            />
          </label>
          <button type="button" onClick={() => void refreshPorts()} disabled={busy}>
            Refresh ports
          </button>
        </div>
        <div className="serial-actions">
          {isConnected ? (
            <button type="button" onClick={() => void runAction(() => window.natureTouch.disconnectSerial())} disabled={busy}>
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void runAction(() => window.natureTouch.connectSerial(selectedPort, baudRate))}
              disabled={busy || !selectedPort}
            >
              Connect
            </button>
          )}
          <button type="button" onClick={() => void runAction(() => window.natureTouch.pingSerial())} disabled={!isConnected || busy}>
            Send PING
          </button>
          <button type="button" onClick={() => void runAction(() => window.natureTouch.getDiagnosticStatus())} disabled={!isConnected || busy}>
            Read diagnostic status
          </button>
        </div>
        <dl className="serial-state">
          <div><dt>Connection</dt><dd>{serialState.state}</dd></div>
          <div><dt>Selected</dt><dd>{serialState.portPath ?? 'None'}</dd></div>
          <div><dt>Last response</dt><dd>{serialState.lastResponse ?? 'None'}</dd></div>
          {serialState.lastError && <div><dt>Transport</dt><dd role="status">{serialState.lastError}</dd></div>}
          {actionError && <div><dt>Request</dt><dd role="alert">{actionError}</dd></div>}
        </dl>
      </section>
      <section className="diagnostics mock-panel" aria-label="Software-only experience simulation">
        <h2>Experience simulation (software only)</h2>
        <p>Simulated timing only. This panel is disconnected from SerialPort and physical outputs.</p>
        <div className="serial-fields">
          <label>
            Experience
            <select
              value={selectedExperience}
              onChange={(event) => setSelectedExperience(event.target.value as ExperienceId)}
              disabled={!canSelectExperience || busy}
            >
              {EXPERIENCE_IDS.map((experienceId) => (
                <option key={experienceId} value={experienceId}>
                  {EXPERIENCE_DEFINITIONS[experienceId].name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void runExperienceAction(() => window.natureTouch.selectExperience(selectedExperience, makeRequestId()))}
            disabled={!canSelectExperience || busy}
          >
            Select
          </button>
        </div>
        <div className="serial-actions">
          <button
            type="button"
            onClick={() => void runExperienceAction(() => window.natureTouch.startExperience(makeRequestId(), crypto.randomUUID()))}
            disabled={!canStartExperience || busy}
          >
            Start simulation
          </button>
          <button
            type="button"
            onClick={() => void runExperienceAction(() => window.natureTouch.stopExperience(makeRequestId(), experienceState.operationId ?? ''))}
            disabled={!canStopExperience || busy}
          >
            Stop simulation
          </button>
          <button
            type="button"
            onClick={() => void runExperienceAction(() => window.natureTouch.queryExperienceStatus(makeRequestId()))}
            disabled={busy}
          >
            Query status
          </button>
          <button
            type="button"
            onClick={() => void runExperienceAction(() => window.natureTouch.simulateExperienceFault('SIMULATED_FAILURE'))}
            disabled={busy || experienceState.state === 'FAULT'}
          >
            Simulate fault
          </button>
          <button
            type="button"
            onClick={() => void runExperienceAction(() => window.natureTouch.simulateConnectionLoss())}
            disabled={busy || experienceState.state === 'FAULT'}
          >
            Simulate connection loss
          </button>
          <button
            type="button"
            onClick={() => void runExperienceAction(() => window.natureTouch.recoverExperience(makeRequestId()))}
            disabled={busy || (experienceState.state !== 'FAULT' && experienceState.state !== 'COMPLETED')}
          >
            Reset mock
          </button>
        </div>
        <div className="simulation-progress" role="progressbar" aria-valuenow={Math.round(experienceState.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${Math.round(experienceState.progress * 100)}%` }} />
        </div>
        <dl className="serial-state">
          <div><dt>State</dt><dd>{experienceState.state}</dd></div>
          <div><dt>Experience</dt><dd>{experienceState.selectedExperienceId ?? 'None'}</dd></div>
          <div><dt>Elapsed</dt><dd>{experienceState.elapsedMs} / {experienceState.durationMs ?? 0} ms</dd></div>
          <div><dt>Progress</dt><dd>{Math.round(experienceState.progress * 100)}%</dd></div>
          <div><dt>Operation</dt><dd>{experienceState.operationId ?? 'None'}</dd></div>
          {experienceState.faultCode && <div><dt>Fault</dt><dd role="alert">{experienceState.faultCode}</dd></div>}
          {experienceMessage && <div><dt>Simulation</dt><dd role="status">{experienceMessage}</dd></div>}
        </dl>
      </section>
      <section className="diagnostics mock-panel" aria-label="Arduino Nano simulation-only firmware controls">
        <h2>Arduino Nano firmware (simulation only)</h2>
        <p>
          Requires protocol v2 identification before experience commands. Firmware emits diagnostic timeline
          events only; it never generates actuator signals. Keep pumps, valve, drivers, and actuator power disconnected.
        </p>
        <div className="serial-actions">
          {firmwareConnected ? (
            <button
              type="button"
              onClick={() => void runFirmwareAction(() => window.natureTouch.disconnectFirmware())}
              disabled={busy}
            >
              Disconnect firmware
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void runFirmwareAction(() => window.natureTouch.connectFirmware(selectedPort, baudRate))}
              disabled={busy || !selectedPort}
            >
              Connect and identify v2
            </button>
          )}
          <button
            type="button"
            onClick={() => void runFirmwareAction(() => window.natureTouch.queryFirmwareStatus(makeFirmwareId()))}
            disabled={!firmwareIdentified || busy}
          >
            Query firmware status
          </button>
        </div>
        <div className="serial-fields">
          <label>
            Experience
            <select
              value={selectedExperience}
              onChange={(event) => setSelectedExperience(event.target.value as ExperienceId)}
              disabled={!canSelectFirmwareExperience || busy}
            >
              {EXPERIENCE_IDS.map((experienceId) => (
                <option key={experienceId} value={experienceId}>
                  {EXPERIENCE_DEFINITIONS[experienceId].name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void runFirmwareAction(() =>
              window.natureTouch.selectFirmwareExperience(selectedExperience, makeFirmwareId()))}
            disabled={!canSelectFirmwareExperience || busy}
          >
            Select on Nano
          </button>
        </div>
        <div className="serial-actions">
          <button
            type="button"
            onClick={() => void runFirmwareAction(() =>
              window.natureTouch.startFirmwareExperience(makeFirmwareId(), makeFirmwareId()))}
            disabled={!canStartFirmwareExperience || busy}
          >
            Start Nano simulation
          </button>
          <button
            type="button"
            onClick={() => void runFirmwareAction(() =>
              window.natureTouch.stopFirmwareExperience(
                makeFirmwareId(),
                firmwareState.experience.operationId ?? '',
              ))}
            disabled={!canStopFirmwareExperience || busy}
          >
            Stop Nano simulation
          </button>
          <button
            type="button"
            onClick={() => void runFirmwareAction(() => window.natureTouch.recoverFirmware(makeFirmwareId()))}
            disabled={!firmwareIdentified || busy || firmwareState.experience.state !== 'FAULT'}
          >
            Request firmware recovery
          </button>
        </div>
        <dl className="serial-state">
          <div><dt>Connection</dt><dd>{firmwareState.connectionState}</dd></div>
          <div><dt>Protocol identified</dt><dd>{firmwareState.identified ? `v${firmwareState.protocolVersion}` : 'No'}</dd></div>
          <div><dt>Firmware</dt><dd>{firmwareState.firmware ?? 'Unknown'}</dd></div>
          <div><dt>Hardware outputs</dt><dd>{firmwareState.hardwareOutputsEnabled ? 'ENABLED' : 'Disabled (simulation-only)'}</dd></div>
          <div><dt>State</dt><dd>{firmwareState.experience.state}</dd></div>
          <div><dt>Experience</dt><dd>{firmwareState.experience.selectedExperienceId ?? 'None'}</dd></div>
          <div><dt>Elapsed</dt><dd>{firmwareState.experience.elapsedMs} / {firmwareState.experience.durationMs ?? 0} ms</dd></div>
          <div><dt>Operation</dt><dd>{firmwareState.experience.operationId ?? 'None'}</dd></div>
          <div><dt>Last firmware event</dt><dd>{firmwareState.lastEvent ?? 'None'}</dd></div>
          {firmwareState.experience.faultCode && (
            <div><dt>Firmware fault</dt><dd role="alert">{firmwareState.experience.faultCode}</dd></div>
          )}
          {firmwareState.lastError && <div><dt>Transport</dt><dd role="alert">{firmwareState.lastError}</dd></div>}
          {firmwareMessage && <div><dt>Firmware request</dt><dd role="status">{firmwareMessage}</dd></div>}
        </dl>
      </section>
    </main>
  )
}