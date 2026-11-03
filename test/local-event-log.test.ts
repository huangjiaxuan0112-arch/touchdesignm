import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LocalEventLog } from '../desktop/electron/local-event-log'

test('local event log writes structured records and rotates to a bounded file count', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nature-touch-log-'))
  try {
    const log = new LocalEventLog(directory, {
      appCommit: 'phase0-test-commit',
      hardwareConfigVersion: 'UNVERSIONED',
    }, { maxBytes: 1024, maxFiles: 3 })

    for (let index = 0; index < 30; index++) {
      log.record('experience.command', {
        mode: 'mock',
        operationId: `operation-${index}`,
        phase: index % 2 === 0 ? 'START' : 'STOP',
      })
    }
    await log.flush()

    const files = await readdir(directory)
    assert.ok(files.length <= 3)
    assert.ok(files.includes('app.jsonl'))
    for (const file of files) {
      const content = await readFile(join(directory, file), 'utf8')
      assert.ok(Buffer.byteLength(content) <= 1024)
      for (const line of content.trim().split('\n')) {
        const row = JSON.parse(line)
        assert.equal(row.appCommit, 'phase0-test-commit')
        assert.equal(row.hardwareConfigVersion, 'UNVERSIONED')
        assert.equal(row.event, 'experience.command')
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('local event log surfaces disk failures without rejecting callers or flush', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nature-touch-log-error-'))
  const blockedPath = join(directory, 'not-a-directory')
  await writeFile(blockedPath, 'occupied')
  const errors: unknown[] = []
  try {
    const log = new LocalEventLog(join(blockedPath, 'logs'), {
      appCommit: 'phase0-test-commit',
      hardwareConfigVersion: 'UNVERSIONED',
    }, { onError: error => errors.push(error) })

    assert.doesNotThrow(() => log.record('app.started'))
    await assert.doesNotReject(log.flush())
    assert.equal(errors.length, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
