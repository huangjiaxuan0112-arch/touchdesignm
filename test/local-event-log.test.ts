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
        command: 'STATUS_QUERY',
        requestId: `request-${index}`,
        source: 'heartbeat',
        elapsedMs: index,
        responseType: 'STATUS',
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
        assert.equal(row.command, 'STATUS_QUERY')
        assert.equal(row.source, 'heartbeat')
        assert.equal(row.responseType, 'STATUS')
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('wire evidence survives reason truncation and remains bounded independently', async()=>{
  const directory=await mkdtemp(join(tmpdir(),'nature-touch-wire-log-'))
  try {
    const log=new LocalEventLog(directory,{appCommit:'test',hardwareConfigVersion:'test'})
    log.record('firmware.protocol.invalid',{reason:'x'.repeat(1000),wire:{
      frame:7,bytes:359,characters:358,position:247,bytePosition:247,startOffset:10,endOffset:370,
      firstAt:new Date().toISOString(),lastAt:new Date().toISOString(),chunks:2,terminator:'CRLF',source:'native-buffer',asciiOnly:true,
      prefix:{hex:'ab'.repeat(100),ascii:'x'.repeat(100)},before:{hex:'cd'.repeat(32),ascii:'c'.repeat(32)},
      after:{hex:'ef'.repeat(32),ascii:'a'.repeat(32)},suffix:{hex:'12'.repeat(32),ascii:'s'.repeat(32)},
      tx:Array.from({length:10},()=>({at:new Date().toISOString(),command:'STATUS_QUERY',requestId:'r7',bytes:40,ascii:'x'.repeat(1000)})),
    }})
    await log.flush()
    const row=JSON.parse(await readFile(join(directory,'app.jsonl'),'utf8'))
    assert.equal(row.reason.length,160);assert.equal(row.wire.position,247)
    assert.equal(row.wire.prefix.hex.length,64);assert.equal(row.wire.prefix.ascii.length,32)
    assert.equal(row.wire.tx.length,4);assert.equal(row.wire.tx[0].ascii.length,160)
    assert.ok(JSON.stringify(row).length<2400)
  }finally{await rm(directory,{recursive:true,force:true})}
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
