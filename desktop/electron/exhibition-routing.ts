import type { FirmwareControlSnapshot } from '../shared/firmware-control-protocol'
import type { ExperienceMode, ExperienceSnapshot, ExperienceEvent } from '../shared/experience-application-contract'

// Immutable composition-root choice only: never read from renderer, argv or env.
export function resolveExhibitionMode(requested: ExperienceMode, deploymentReviewed: boolean): ExperienceMode {
  if (requested === 'firmware' && !deploymentReviewed) throw new Error('Firmware exhibition requires reviewed deployment permission.')
  return requested
}

// A pure API projection, not a second state store. Keeps the existing audience UI stable.
export function audienceSnapshot(snapshot: ExperienceSnapshot): ExperienceSnapshot {
  return { ...snapshot, mode: 'mock', deviceSource: snapshot.mode }
}
export function audienceEvents(event: ExperienceEvent, selectedMode: ExperienceMode): ExperienceEvent[] {
  if (selectedMode === 'mock') return [event]
  if (event.snapshot.mode !== 'firmware') return []
  return [event, { ...event, snapshot: audienceSnapshot(event.snapshot) }]
}

export const EXHIBITION_FIRMWARE_TARGET = { firmwareVersion: '3.0.0-30s', timelineVersion: '30s-4292e376', sourceRevision: '5356f28e' } as const
export function firmwareExhibitionReady(state: FirmwareControlSnapshot, deploymentReviewed: boolean): boolean {
  return deploymentReviewed && state.identified && state.protocolVersion === 2 && state.connectionState === 'connected' &&
    state.firmware === 'nature-touch-unified-real' && state.hardwareOutputsEnabled === true &&
    state.firmwareVersion === EXHIBITION_FIRMWARE_TARGET.firmwareVersion &&
    state.timelineVersion === EXHIBITION_FIRMWARE_TARGET.timelineVersion &&
    state.sourceRevision === EXHIBITION_FIRMWARE_TARGET.sourceRevision
}
