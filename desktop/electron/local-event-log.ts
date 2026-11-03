import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface LocalEventLogContext {
  appCommit: string
  hardwareConfigVersion: string
}

export interface LocalEventLogFields {
  level?: 'info' | 'warn' | 'error'
  mode?: string
  operationId?: string
  deviceIdentity?: string
  phase?: string
  reason?: string
}

export interface LocalEventLogOptions {
  maxBytes?: number
  maxFiles?: number
  onError?: (error: unknown) => void
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function limit(value: string | undefined, length: number): string | undefined {
  return value === undefined ? undefined : value.slice(0, length)
}

export class LocalEventLog {
  private readonly maxBytes: number
  private readonly maxFiles: number
  private readonly onError: (error: unknown) => void
  private pendingWrites: Promise<void> = Promise.resolve()
  private readonly currentFile: string

  constructor(
    private readonly directory: string,
    private readonly context: LocalEventLogContext,
    options: LocalEventLogOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024
    this.maxFiles = options.maxFiles ?? 5
    this.onError = options.onError ?? (error => console.error('Local event log write failed:', error))
    this.currentFile = join(directory, 'app.jsonl')
    if (!Number.isInteger(this.maxBytes) || this.maxBytes < 1024) {
      throw new RangeError('Local event log maxBytes must be an integer of at least 1024.')
    }
    if (!Number.isInteger(this.maxFiles) || this.maxFiles < 1) {
      throw new RangeError('Local event log maxFiles must be a positive integer.')
    }
  }

  record(event: string, fields: LocalEventLogFields = {}): void {
    const row = {
      timestamp: new Date().toISOString(),
      level: fields.level ?? 'info',
      event: event.slice(0, 80),
      appCommit: this.context.appCommit.slice(0, 64),
      hardwareConfigVersion: this.context.hardwareConfigVersion.slice(0, 48),
      mode: limit(fields.mode, 16),
      operationId: limit(fields.operationId, 32),
      deviceIdentity: limit(fields.deviceIdentity, 64),
      phase: limit(fields.phase, 32),
      reason: limit(fields.reason, 160),
    }
    const line = JSON.stringify(Object.fromEntries(
      Object.entries(row).filter(([, value]) => value !== undefined),
    )) + '\n'

    this.pendingWrites = this.pendingWrites
      .then(() => this.append(line))
      .catch(error => this.onError(error))
  }

  flush(): Promise<void> {
    return this.pendingWrites
  }

  private async append(line: string): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    let currentSize = 0
    try {
      currentSize = (await stat(this.currentFile)).size
    } catch (error) {
      if (!isMissingFile(error)) throw error
    }

    const lineBytes = Buffer.byteLength(line, 'utf8')
    if (lineBytes > this.maxBytes) {
      throw new RangeError('Local event log record exceeds the configured file size limit.')
    }
    if (currentSize > 0 && currentSize + lineBytes > this.maxBytes) {
      await this.rotate()
    }
    await appendFile(this.currentFile, line, 'utf8')
  }

  private async rotate(): Promise<void> {
    if (this.maxFiles === 1) {
      await rm(this.currentFile, { force: true })
      return
    }

    await rm(this.rotatedFile(this.maxFiles - 1), { force: true })
    for (let index = this.maxFiles - 1; index >= 1; index--) {
      const source = index === 1 ? this.currentFile : this.rotatedFile(index - 1)
      try {
        await rename(source, this.rotatedFile(index))
      } catch (error) {
        if (!isMissingFile(error)) throw error
      }
    }
  }

  private rotatedFile(index: number): string {
    return join(this.directory, `app.${index}.jsonl`)
  }
}
