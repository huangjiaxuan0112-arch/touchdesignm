import { useEffect, useState } from 'react'
import { INITIAL_FIRMWARE_CONTROL_SNAPSHOT, type FirmwareControlSnapshot } from '../../../shared/firmware-control-protocol'
import { DEFAULT_SERIAL_BAUD_RATE, type SerialPortInfo } from '../../../shared/serial-protocol'

export function ArduinoConnection({ realMode, onModeChange, disabled, onSnapshot, onBusyChange }: {
  realMode: boolean
  onModeChange: (real: boolean) => void
  disabled: boolean
  onSnapshot: (snapshot: FirmwareControlSnapshot) => void
  onBusyChange: (busy: boolean) => void
}) {
  const [ports, setPorts] = useState<SerialPortInfo[]>([])
  const [portPath, setPortPath] = useState('')
  const [connectedPort, setConnectedPort] = useState('')
  const [snapshot, setSnapshot] = useState(INITIAL_FIRMWARE_CONTROL_SNAPSHOT)
  const [isolated, setIsolated] = useState(false)
  const [firmwareConfirmed, setFirmwareConfirmed] = useState(false)
  const [commandResult, setCommandResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const api = window.natureTouch

  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])

  useEffect(() => {
    if (!api) return
    let mounted = true
    const update = (state: FirmwareControlSnapshot) => {
      if (!mounted) return
      setSnapshot(state)
      onSnapshot(state)
      if (!state.identified) setFirmwareConfirmed(false)
    }
    const unsubscribe = api.onFirmwareState(update)
    void api.getFirmwareState().then(update)
      .catch((cause: unknown) => { if (mounted) setError(String(cause)) })
    return () => { mounted = false; unsubscribe() }
  }, [api, onSnapshot])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try { await action() } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  async function refreshPorts() {
    const available = await api.listSerialPorts()
    setPorts(available)
    setPortPath((current) => available.some((port) => port.path === current) ? current : '')
  }

  const connected = snapshot.connectionState === 'connected'
  const connecting = snapshot.connectionState === 'connecting'
  const running = snapshot.experience.state === 'RUNNING' || snapshot.experience.state === 'STOPPING'
  const requestId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16)

  return <section className="device-connection" aria-label="Device connection">
    <label>Device mode <select aria-label="Device mode" value={realMode ? 'real' : 'mock'}
      disabled={busy || connecting || disabled || running}
      onChange={(event) => {
        const real = event.target.value === 'real'
        void run(async () => {
          if (!real) { await api.disconnectFirmware(); setIsolated(false) }
          onModeChange(real)
          if (real) await refreshPorts()
        })
      }}>
      <option value="mock">Mock Device — simulated</option>
      <option value="real" disabled={!api}>Real Arduino — read-only USB</option>
    </select></label>
    <p role="status">{realMode ? `Real Arduino: ${snapshot.connectionState}${connected ? ` (${connectedPort || 'existing session'})` : ''} · ${snapshot.simulationTestArmed ? 'SIMULATION TEST ARMED' : 'READ ONLY'}` : 'Mock Mode — no Arduino commands'}</p>
    {realMode && <>
      <label>COM port <select aria-label="COM port" value={portPath} disabled={busy || connected || connecting}
        onChange={(event) => setPortPath(event.target.value)}>
        <option value="">Choose a detected port</option>
        {ports.map((port) => <option key={port.path} value={port.path}>{port.path} · {port.manufacturer || 'Unknown device'}{port.vendorId ? ` (${port.vendorId}:${port.productId})` : ''}</option>)}
      </select></label>
      <button disabled={busy || connecting} onClick={() => void run(refreshPorts)}>Refresh ports</button>
      <label><input type="checkbox" checked={isolated} disabled={busy || connected || connecting}
        onChange={(event) => setIsolated(event.target.checked)} />
        I confirm valve and both pumps are physically isolated from all power paths. USB/reset cannot energize them.
      </label>
      <p>Opening serial may reset an unknown installed sketch. Controls require a separately armed simulation test session.</p>
      <button disabled={busy || connecting || (!connected && (!portPath || !isolated))}
        onClick={() => void run(async () => {
          if (connected) { await api.disconnectFirmware(); setIsolated(false) }
          else { setConnectedPort(portPath); setSnapshot(await api.connectFirmware(portPath, DEFAULT_SERIAL_BAUD_RATE, isolated)) }
        })}>{connected ? 'Disconnect Arduino' : 'Connect + IDENTIFY'}</button>
      <button disabled={busy || !connected || !snapshot.identified}
        onClick={() => void run(() => api.queryFirmwareStatus(crypto.randomUUID().replace(/-/g, '').slice(0, 16)))}>STATUS_QUERY</button>
      <p>IDENTIFY: {snapshot.identified ? `${snapshot.firmware} · Protocol ${snapshot.protocolVersion} · reports outputs disabled` : 'Not identified'}</p>
      <label><input type="checkbox" aria-label="Confirm simulation firmware" checked={firmwareConfirmed}
        disabled={busy || !snapshot.identified || snapshot.simulationTestArmed}
        onChange={(event) => setFirmwareConfirmed(event.target.checked)} />
        I confirm the identified Nature Touch simulation-only firmware is the intended test firmware. Loads remain physically isolated; this is not actuator control.
      </label>
      <button disabled={busy || disabled || running || !connected || (!snapshot.simulationTestArmed &&
        (!isolated || !firmwareConfirmed || !snapshot.simulationTestEligible))}
        onClick={() => void run(async () => {
          if (snapshot.simulationTestArmed) await api.disarmFirmwareSimulationTest()
          else await api.armFirmwareSimulationTest(isolated, firmwareConfirmed)
        })}>{snapshot.simulationTestArmed ? 'Disarm simulation test' : 'Arm Real Arduino Simulation Test'}</button>
      <button disabled={busy || disabled || !snapshot.simulationTestArmed || snapshot.experience.state !== 'IDLE' || !snapshot.experience.selectedExperienceId}
        onClick={() => void run(async () => {
          const ack = await api.startFirmwareExperience(requestId(), requestId())
          setCommandResult(JSON.stringify(ack))
          if (!ack.accepted) throw new Error(`START rejected: ${ack.code}`)
          await api.queryFirmwareStatus(requestId())
        })}>Test START</button>
      <button disabled={busy || !snapshot.simulationTestArmed || snapshot.experience.state !== 'RUNNING' || !snapshot.experience.operationId}
        onClick={() => void run(async () => {
          const ack = await api.stopFirmwareExperience(requestId(), snapshot.experience.operationId!)
          setCommandResult(JSON.stringify(ack))
          if (!ack.accepted) throw new Error(`STOP rejected: ${ack.code}`)
          await api.queryFirmwareStatus(requestId())
        })}>Test STOP</button>
      {connected && snapshot.identified && snapshot.simulationTestEligible && snapshot.experience.state === 'FAULT' &&
        <button disabled={busy || disabled || !isolated || !firmwareConfirmed}
          onClick={() => void run(async () => {
            const ack = await api.recoverFirmware(requestId(), isolated, firmwareConfirmed)
            if (!ack.accepted) throw new Error(`RECOVER rejected: ${ack.code ?? 'UNKNOWN'}`)
            setCommandResult('Recovered to IDLE. Arm simulation test, SELECT a mode and START manually.')
          })}>RECOVER</button>}
      {commandResult && <p aria-label="Last test acknowledgement">{commandResult}</p>}
      {snapshot.identified && <pre aria-label="Arduino status">{JSON.stringify(snapshot.experience, null, 2)}</pre>}
      {snapshot.lastError && <p role="alert">{snapshot.lastError}</p>}
    </>}
    {error && <p role="alert">{error}</p>}
    {!api && <p>Open the Electron application to access devices.</p>}
  </section>
}
