import type { ExperienceCommandName } from '../../shared/experience-control-protocol'

const FIRMWARE_ID_PATTERN = /^[A-Za-z0-9_-]{1,16}$/

export type FirmwareFrame =
  | { type: 'line'; line: string }
  | { type: 'oversized' }

export class FirmwareJsonlDecoder {
  private line = ''
  private discardingLongLine = false

  constructor(private readonly maxLineLength: number) {}

  push(chunk: string): FirmwareFrame[] {
    const frames: FirmwareFrame[] = []
    for (const character of chunk) {
      if (character === '\n') {
        if (this.discardingLongLine) {
          this.discardingLongLine = false
          this.line = ''
          frames.push({ type: 'oversized' })
          continue
        }
        const line = this.line.replace(/\r$/, '')
        this.line = ''
        if (line) frames.push({ type: 'line', line })
        continue
      }
      if (this.discardingLongLine) continue
      this.line += character
      if (this.line.length > this.maxLineLength) {
        this.line = ''
        this.discardingLongLine = true
      }
    }
    return frames
  }

  reset(): void {
    this.line = ''
    this.discardingLongLine = false
  }
}

export function parseFirmwareJsonObject(line: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(line)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Firmware response must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

export function isFirmwareRequestId(value: string): boolean {
  return FIRMWARE_ID_PATTERN.test(value)
}

export function isFirmwareOperationId(value: string): boolean {
  return FIRMWARE_ID_PATTERN.test(value)
}

export function isFirmwareStatusResponseForRequest(
  message: Record<string, unknown>,
  requestId: string,
): boolean {
  const acknowledgement = message.acknowledgement
  return message.requestId === requestId &&
    Boolean(message.snapshot) &&
    Boolean(acknowledgement) &&
    typeof acknowledgement === 'object' &&
    acknowledgement !== null &&
    (acknowledgement as Record<string, unknown>).requestId === requestId &&
    (acknowledgement as Record<string, unknown>).command === 'STATUS_QUERY' &&
    (acknowledgement as Record<string, unknown>).type === 'ACK'
}

export function isFirmwareAcknowledgementForRequest(
  message: Record<string, unknown>,
  requestId: string,
): boolean {
  return typeof message.accepted === 'boolean' &&
    message.requestId === requestId &&
    message.state !== undefined
}

export function firmwareCommandMatches(
  message: Record<string, unknown>,
  command: ExperienceCommandName,
): boolean {
  return message.command === command
}
