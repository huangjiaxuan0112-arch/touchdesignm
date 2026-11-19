import type { ExperienceSnapshot } from '../../shared/experience-control-protocol'

export class FirmwareSessionState {
  private _remoteState: ExperienceSnapshot['state'] = 'IDLE'
  private _runStartedAt: number | undefined
  private _simulationIdentityConfirmed = false
  private _realIdentityConfirmed = false

  get remoteState(): ExperienceSnapshot['state'] {
    return this._remoteState
  }

  get runStartedAt(): number | undefined {
    return this._runStartedAt
  }

  get simulationIdentityConfirmed(): boolean {
    return this._simulationIdentityConfirmed
  }

  get realIdentityConfirmed(): boolean {
    return this._realIdentityConfirmed
  }

  beginConnection(): void {
    this._remoteState = 'IDLE'
    this._runStartedAt = undefined
    this._simulationIdentityConfirmed = false
    this._realIdentityConfirmed = false
  }

  confirmSimulationIdentity(simulation: boolean): void {
    this._simulationIdentityConfirmed = simulation
  }

  confirmRealIdentity(real: boolean): void {
    this._realIdentityConfirmed = real
  }

  setRemoteState(state: ExperienceSnapshot['state']): void {
    this._remoteState = state
  }

  setRunStartedAt(runStartedAt: number | undefined): void {
    this._runStartedAt = runStartedAt
  }

  clearRun(): void {
    this._runStartedAt = undefined
  }

  invalidateIdentity(): void {
    this._realIdentityConfirmed = false
  }
}
