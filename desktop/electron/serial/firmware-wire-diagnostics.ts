// Passive, bounded pre-JSON observation. Never repairs bytes or changes frame acceptance.
export const FIRMWARE_WIRE_DIAGNOSTIC_VERSION = 'comm-diag-v1'
export interface WireSample { hex: string; ascii: string }
export interface WireTx { at: string; command: string; requestId: string; bytes: number; ascii: string }
export interface FirmwareWireDiagnostic {
  frame: number; bytes: number; characters?: number; startOffset: number; endOffset: number
  firstAt: string; lastAt: string; chunks: number; terminator: 'LF' | 'CRLF' | 'NONE'
  source: 'native-buffer' | 'reencoded-string'; asciiOnly: boolean; requestId?: string
  position?: number | null; bytePosition?: number | null
  prefix?: WireSample; suffix?: WireSample; before?: WireSample; after?: WireSample
  tx?: WireTx[]
}
export interface ObservedWireFrame {
  meta: FirmwareWireDiagnostic
  head: Buffer
  tail: Buffer
}
const sample = (bytes: Uint8Array): WireSample => ({
  hex: Buffer.from(bytes).toString('hex'),
  ascii: [...bytes].map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : '.').join(''),
})

export class FirmwareWireProbe {
  private head: number[] = []
  private tail: number[] = []
  private length = 0
  private offset = 0
  private start = 0
  private sequence = 0
  private chunks = 0
  private firstAt = ''
  private lastAt = ''
  private native = true
  private ascii = true

  push(bytes: Uint8Array, native: boolean): ObservedWireFrame[] {
    const result: ObservedWireFrame[] = []
    const at = new Date().toISOString()
    let counted = false
    for (const b of bytes) {
      if (!this.firstAt) this.firstAt = at
      this.lastAt = at
      if (!counted) { this.chunks++; counted = true }
      this.native &&= native
      this.offset++
      if (b === 10) {
        const blank = this.length === 0 || (this.length === 1 && this.head[0] === 13)
        const frame = this.snapshot(this.tail.at(-1) === 13 ? 'CRLF' : 'LF')
        if (!blank) result.push(frame)
        this.sequence++
        this.clearFrame()
        counted = false
      } else {
        this.length = Math.min(this.length + 1, Number.MAX_SAFE_INTEGER)
        if (this.head.length < 1536) this.head.push(b)
        this.tail.push(b)
        if (this.tail.length > 32) this.tail.shift()
        this.ascii &&= b < 128
      }
    }
    return result
  }
  partial(): ObservedWireFrame | undefined {
    return this.length ? this.snapshot('NONE') : undefined
  }
  reset(): void {
    this.offset = this.start = this.sequence = 0
    this.clearFrame()
  }
  private snapshot(terminator: FirmwareWireDiagnostic['terminator']): ObservedWireFrame {
    return { meta: { frame: this.sequence, bytes: this.length, startOffset: this.start,
      endOffset: this.offset, firstAt: this.firstAt, lastAt: this.lastAt, chunks: this.chunks,
      terminator, source: this.native ? 'native-buffer' : 'reencoded-string', asciiOnly: this.ascii },
      head: Buffer.from(this.head), tail: Buffer.from(this.tail) }
  }
  private clearFrame(): void {
    this.head = []; this.tail = []; this.length = this.chunks = 0
    this.firstAt = this.lastAt = ''; this.native = this.ascii = true; this.start = this.offset
  }
}

export function wireDiagnostic(frame: ObservedWireFrame, line?: string, position?: number | null): FirmwareWireDiagnostic {
  const bytePosition = frame.meta.asciiOnly ? position : null
  const headText = frame.head.toString('latin1')
  const requestId = /"requestId"\s*:\s*"([A-Za-z0-9_-]{1,16})"/.exec(headText)?.[1]
  return { ...frame.meta, characters: line?.length, requestId, position, bytePosition,
    prefix: sample(frame.head.subarray(0, 32)), suffix: sample(frame.tail),
    before: bytePosition == null ? undefined : sample(frame.head.subarray(Math.max(0, bytePosition - 32), bytePosition)),
    after: bytePosition == null ? undefined : sample(frame.head.subarray(bytePosition, bytePosition + 32)) }
}

// Log fields stay bounded even when a caller supplies oversized diagnostic values.
export function boundedWireDiagnostic(wire: FirmwareWireDiagnostic): FirmwareWireDiagnostic {
  const boundedSample = (value?: WireSample): WireSample | undefined => value && ({
    hex: value.hex.slice(0, 64), ascii: value.ascii.slice(0, 32),
  })
  return { ...wire, firstAt: wire.firstAt.slice(0, 32), lastAt: wire.lastAt.slice(0, 32),
    requestId: wire.requestId?.slice(0, 16), prefix: boundedSample(wire.prefix), suffix: boundedSample(wire.suffix),
    before: boundedSample(wire.before), after: boundedSample(wire.after),
    tx: wire.tx?.slice(-4).map(t => ({at:t.at.slice(0,32),command:t.command.slice(0,24),
      requestId:t.requestId.slice(0,16),bytes:t.bytes,ascii:t.ascii.slice(0,160)})) }
}
