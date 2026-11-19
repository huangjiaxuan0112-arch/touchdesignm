import type { ExperienceCommandName } from '../../shared/experience-control-protocol'

const FIRMWARE_ID_PATTERN = /^[A-Za-z0-9_-]{1,16}$/

export type FirmwareFrame =
  | { type: 'line'; line: string }
  | {
      type: 'oversized'
      observedLength: number
      prefix: string
      suffix: string
    }

const OVERSIZED_SAMPLE_LENGTH = 32
const MAX_DIAGNOSTIC_LENGTH = 0x7fffffff
const JSON_ERROR_CONTEXT_LENGTH = 64
const JSON_ERROR_EDGE_LENGTH = 8

export class FirmwareJsonlDecoder {
  private line = ''
  private discardingLongLine = false
  private oversizedLength = 0
  private oversizedPrefix = ''
  private oversizedSuffix = ''

  constructor(private readonly maxLineLength: number) {}

  push(chunk: string): FirmwareFrame[] {
    const frames: FirmwareFrame[] = []
    for (const character of chunk) {
      if (character === '\n') {
        if (this.discardingLongLine) {
          frames.push({
            type: 'oversized',
            observedLength: this.oversizedLength,
            prefix: this.oversizedPrefix,
            suffix: this.oversizedSuffix,
          })
          this.discardingLongLine = false
          this.line = ''
          this.oversizedLength = 0
          this.oversizedPrefix = ''
          this.oversizedSuffix = ''
          continue
        }
        const line = this.line.replace(/\r$/, '')
        this.line = ''
        if (line) frames.push({ type: 'line', line })
        continue
      }
      if (this.discardingLongLine) {
        this.oversizedLength = Math.min(this.oversizedLength + 1, MAX_DIAGNOSTIC_LENGTH)
        if (this.oversizedPrefix.length < OVERSIZED_SAMPLE_LENGTH) {
          this.oversizedPrefix = (this.oversizedPrefix + character).slice(0, OVERSIZED_SAMPLE_LENGTH)
        }
        this.oversizedSuffix = (this.oversizedSuffix + character).slice(-OVERSIZED_SAMPLE_LENGTH)
        continue
      }
      this.line += character
      if (this.line.length > this.maxLineLength) {
        this.oversizedLength = this.line.length
        this.oversizedPrefix = this.line.slice(0, OVERSIZED_SAMPLE_LENGTH)
        this.oversizedSuffix = this.line.slice(-OVERSIZED_SAMPLE_LENGTH)
        this.line = ''
        this.discardingLongLine = true
      }
    }
    return frames
  }

  reset(): void {
    this.line = ''
    this.discardingLongLine = false
    this.oversizedLength = 0
    this.oversizedPrefix = ''
    this.oversizedSuffix = ''
  }
}

export function parseFirmwareJsonObject(line: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(line)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Firmware response must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

export interface FirmwareJsonParseDiagnostic {
  frameType: string
  position: number | null
  context: string
  before: string
  after: string
  message: string
}

export function getFirmwareJsonParseDiagnostic(
  line: string,
  error: unknown,
): FirmwareJsonParseDiagnostic {
  const errorMessage = error instanceof Error ? error.message : String(error)
  const positionMatch = /position\s+(\d+)/i.exec(errorMessage)
  const parsedPosition = positionMatch ? Number(positionMatch[1]) : NaN
  const position = Number.isSafeInteger(parsedPosition)
    ? Math.min(parsedPosition, line.length)
    : null
  const frameTypeMatch = /^\s*\{\s*"type"\s*:\s*"([A-Za-z0-9_-]{1,24})"/.exec(line.slice(0, 128))
  const frameType = frameTypeMatch?.[1] ?? 'unknown'
  const contextStart = position === null
    ? 0
    : Math.max(0, Math.min(position - Math.floor(JSON_ERROR_CONTEXT_LENGTH / 2), line.length - JSON_ERROR_CONTEXT_LENGTH))
  const contextEnd = Math.min(line.length, contextStart + JSON_ERROR_CONTEXT_LENGTH)
  const before = position === null ? '' : line.slice(Math.max(0, position - JSON_ERROR_EDGE_LENGTH), position)
  const after = position === null
    ? ''
    : line.slice(position, Math.min(line.length, position + JSON_ERROR_EDGE_LENGTH))
  const printable = (value: string): string =>
    [...value].map(character => {
      const code = character.charCodeAt(0)
      return code >= 0x20 && code <= 0x7e ? character : '.'
    }).join('')

  return {
    frameType,
    position,
    context: printable(line.slice(contextStart, contextEnd)),
    before: printable(before),
    after: printable(after),
    message: printable(errorMessage).slice(0, 160),
  }
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
