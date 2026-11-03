import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { request as httpsRequest } from 'node:https'
import type { ExhibitionLifecycleController } from '../desktop/experience/exhibition-lifecycle-controller'
import {
  createTestIpadLanServer,
  readIpadLanServerConfig,
  type IpadLanServerConfig,
} from '../desktop/electron/ipad-lan-server'
import type { ExhibitionLifecycleSnapshot } from '../desktop/shared/exhibition-lifecycle'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const fixtures = join(testDirectory, 'fixtures')
const tlsKey = readFileSync(join(fixtures, 'ipad-test-key.pem'), 'utf8')
const tlsCertificate = readFileSync(join(fixtures, 'ipad-test-cert.pem'), 'utf8')
const testPassword = 'NatureTouch-Test-Password-481'

function createLifecycle() {
  let snapshot: ExhibitionLifecycleSnapshot = {
    revision: 0,
    phase: 'READY',
    experienceId: null,
    operationId: null,
    faultCode: null,
  }
  const listeners = new Set<(value: ExhibitionLifecycleSnapshot) => void>()
  let selectCalls = 0
  let selectedExperience: string | undefined
  const lifecycle = {
    getSnapshot: () => ({ ...snapshot }),
    subscribe: (listener: (value: ExhibitionLifecycleSnapshot) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    select: async (command: { experienceId: string; mode: string }) => {
      selectCalls += 1
      selectedExperience = command.experienceId
      snapshot = {
        revision: snapshot.revision + 1,
        phase: 'STARTING',
        experienceId: command.experienceId as ExhibitionLifecycleSnapshot['experienceId'],
        operationId: null,
        faultCode: null,
      }
      for (const listener of listeners) listener({ ...snapshot })
      await new Promise(resolveDelay => setTimeout(resolveDelay, 30))
      return { accepted: true }
    },
    advanceToWaiting: () => {
      snapshot = { ...snapshot, revision: snapshot.revision + 1, phase: 'WAITING' }
      for (const listener of listeners) listener({ ...snapshot })
    },
    get selectCalls() { return selectCalls },
    get selectedExperience() { return selectedExperience },
  }
  return lifecycle
}

function headerValue(headers: import('node:http').IncomingHttpHeaders, name: string): string {
  const value = headers[name]
  if (Array.isArray(value)) return value.join(';')
  return value ?? ''
}

function request(
  address: string,
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }> {
  return new Promise((resolveResponse, rejectResponse) => {
    const request = httpsRequest({
      hostname: address,
      port,
      path,
      method: options.method ?? 'GET',
      rejectUnauthorized: false,
      headers: options.headers,
    }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('end', () => resolveResponse({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    request.on('error', rejectResponse)
    if (options.body) request.write(options.body)
    request.end()
  })
}

test('iPad LAN configuration is opt-in, private-interface-bound, and rejects public binds', () => {
  assert.equal(readIpadLanServerConfig({}, {}, process.cwd()), undefined)
  const environment = {
    NATURE_TOUCH_IPAD_BIND_ADDRESS: '192.168.20.15',
    NATURE_TOUCH_IPAD_TLS_KEY_PATH: join(fixtures, 'ipad-test-key.pem'),
    NATURE_TOUCH_IPAD_TLS_CERT_PATH: join(fixtures, 'ipad-test-cert.pem'),
    NATURE_TOUCH_IPAD_PASSWORD: testPassword,
  }
  const interfaces = {
    Ethernet: [{
      address: '192.168.20.15',
      netmask: '255.255.255.0',
      family: 'IPv4' as const,
      mac: '00-00-00-00-00-00',
      internal: false,
      cidr: '192.168.20.15/24',
    }],
  }
  const config = readIpadLanServerConfig(environment, interfaces, process.cwd())
  assert.equal(config?.bindAddress, '192.168.20.15')
  assert.equal(config?.tlsCertificate.includes('BEGIN CERTIFICATE'), true)
  assert.throws(() => readIpadLanServerConfig({
    ...environment,
    NATURE_TOUCH_IPAD_BIND_ADDRESS: '8.8.8.8',
  }, interfaces, process.cwd()), /RFC1918 IPv4 or ULA IPv6/)
  assert.throws(() => readIpadLanServerConfig(environment, {}, process.cwd()), /local network interface/)
  assert.throws(() => readIpadLanServerConfig({
    ...environment,
    NATURE_TOUCH_IPAD_PASSWORD: 'short',
  }, interfaces, process.cwd()), /at least 12 characters/)
})

test('HTTPS iPad API authenticates, rate-limits, publishes revisions, and serializes selections', async () => {
  const address = '127.0.0.1'
  const lifecycle = createLifecycle()
  const config: IpadLanServerConfig = {
    bindAddress: address,
    port: 0,
    password: testPassword,
    tlsKey,
    tlsCertificate,
    staticDirectory: resolve(testDirectory, '../desktop/ipad'),
  }
  const server = createTestIpadLanServer(config, lifecycle as unknown as ExhibitionLifecycleController)
  const port = await server.start()
  const origin = `https://${address}:${port}`
  const host = `${address}:${port}`
  const jsonHeaders = { Origin: origin, 'Content-Type': 'application/json' }

  try {
    const page = await request(address, port, '/')
    assert.equal(page.status, 200)
    const csp = page.headers['content-security-policy']
    assert.match(Array.isArray(csp) ? csp.join(';') : csp ?? '', /default-src 'self'/)
    assert.equal(page.headers['strict-transport-security'], 'max-age=31536000')
    assert.match(page.body, /展览控制登录/)
    const blockedState = await request(address, port, '/api/state')
    assert.equal(blockedState.status, 401)

    const badOrigin = await request(address, port, '/api/login', {
      method: 'POST',
      headers: { ...jsonHeaders, Origin: 'https://attacker.invalid' },
      body: JSON.stringify({ password: testPassword }),
    })
    assert.equal(badOrigin.status, 403)
    const badPassword = await request(address, port, '/api/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ password: 'incorrect-password' }),
    })
    assert.equal(badPassword.status, 401)

    const login = await request(address, port, '/api/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ password: testPassword }),
    })
    assert.equal(login.status, 200)
    assert.equal(login.body.includes(testPassword), false)
    const cookie = (login.headers['set-cookie']?.[0] ?? '').split(';')[0]
    assert.match(login.headers['set-cookie']?.[0] ?? '', /HttpOnly; Secure; SameSite=Strict/)
    assert.match(cookie, /^nature_touch_ipad_session=/)

    const state = await request(address, port, '/api/state', { headers: { Cookie: cookie } })
    assert.equal(state.status, 200)
    assert.equal(JSON.parse(state.body).phase, 'READY')
    const noOrigin = await request(address, port, '/api/select', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ experienceId: 'WAVE' }),
    })
    assert.equal(noOrigin.status, 403)

    const firstSelection = request(address, port, '/api/select', {
      method: 'POST',
      headers: { ...jsonHeaders, Cookie: cookie },
      body: JSON.stringify({ experienceId: 'WAVE' }),
    })
    await new Promise(resolveDelay => setTimeout(resolveDelay, 5))
    const concurrentSelection = await request(address, port, '/api/select', {
      method: 'POST',
      headers: { ...jsonHeaders, Cookie: cookie },
      body: JSON.stringify({ experienceId: 'BUBBLE' }),
    })
    assert.equal(concurrentSelection.status, 409)
    const selected = await firstSelection
    assert.equal(selected.status, 202)
    assert.equal(lifecycle.selectCalls, 1)
    assert.equal(lifecycle.selectedExperience, 'WAVE')

    const restoredState = await request(address, port, '/api/state', { headers: { Cookie: cookie } })
    assert.equal(JSON.parse(restoredState.body).phase, 'STARTING')
    assert.equal(lifecycle.selectCalls, 1, 'state recovery must not submit another SELECT or START')

    const eventStream = httpsRequest({
      hostname: address,
      port,
      path: '/api/events',
      rejectUnauthorized: false,
      headers: { Cookie: cookie, Host: host },
    })
    const streamResponse = await new Promise<import('node:http').IncomingMessage>((resolveResponse, rejectResponse) => {
      eventStream.once('response', resolveResponse)
      eventStream.once('error', rejectResponse)
      eventStream.end()
    })
    assert.equal(streamResponse.statusCode, 200)
    let eventData = ''
    const waitingEvent = new Promise<void>((resolveEvent, rejectEvent) => {
      const timeout = setTimeout(() => rejectEvent(new Error('Timed out waiting for SSE state update.')), 2_000)
      streamResponse.on('data', chunk => {
        eventData += Buffer.from(chunk).toString('utf8')
        if (eventData.includes('"phase":"WAITING"')) {
          clearTimeout(timeout)
          resolveEvent()
        }
      })
    })
    lifecycle.advanceToWaiting()
    await waitingEvent
    streamResponse.destroy()
    assert.match(eventData, /id: 1/)
    assert.match(eventData, /"revision":2/)

    for (let attempt = 0; attempt < 5; attempt++) {
      const failure = await request(address, port, '/api/login', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ password: 'incorrect-password' }),
      })
      assert.equal(failure.status, 401)
    }
    const limited = await request(address, port, '/api/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ password: 'incorrect-password' }),
    })
    assert.equal(limited.status, 429)
  } finally {
    await server.close()
  }
})
