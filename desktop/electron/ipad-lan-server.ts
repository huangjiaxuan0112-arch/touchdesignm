import { createServer, type Server } from 'node:https'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { networkInterfaces } from 'node:os'
import { join, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ExhibitionLifecycleController } from '../experience/exhibition-lifecycle-controller'
import { EXPERIENCE_IDS } from '../shared/experience-definitions'
import type { ExhibitionLifecycleSnapshot } from '../shared/exhibition-lifecycle'

const SESSION_COOKIE = 'nature_touch_ipad_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const LOGIN_WINDOW_MS = 60_000
const LOGIN_FAILURE_LIMIT = 5
const MAX_BODY_BYTES = 4096
const PASSWORD_HASH_BYTES = 64

interface LoginFailures {
  count: number
  windowStartedAt: number
}

interface Session {
  expiresAt: number
}

function derivePasswordDigest(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolveDigest, rejectDigest) => {
    scrypt(password, salt, PASSWORD_HASH_BYTES, (error, digest) => {
      if (error) rejectDigest(error)
      else resolveDigest(digest)
    })
  })
}

export interface IpadLanServerConfig {
  bindAddress: string
  port: number
  password: string
  tlsKey: string
  tlsCertificate: string
  staticDirectory: string
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  return octets.length === 4 && octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255) &&
    (octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168))
}

function isPrivateIpv6(address: string): boolean {
  return /^[fF][c-dC-D]/.test(address)
}

function isPrivateLanAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4 ? isPrivateIpv4(address) : family === 6 && isPrivateIpv6(address)
}

function canonicalHost(address: string, port: number): string {
  return isIP(address) === 6 ? `[${address}]:${port}` : `${address}:${port}`
}

export function readIpadLanServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
  appPath = process.cwd(),
): IpadLanServerConfig | undefined {
  const names = [
    'NATURE_TOUCH_IPAD_BIND_ADDRESS',
    'NATURE_TOUCH_IPAD_TLS_KEY_PATH',
    'NATURE_TOUCH_IPAD_TLS_CERT_PATH',
    'NATURE_TOUCH_IPAD_PASSWORD',
  ] as const
  const supplied = names.filter(name => environment[name])
  if (supplied.length === 0) return undefined
  const missing = names.filter(name => !environment[name])
  if (missing.length) throw new Error(`Missing iPad LAN configuration: ${missing.join(', ')}`)

  const bindAddress = environment.NATURE_TOUCH_IPAD_BIND_ADDRESS!
  const port = Number(environment.NATURE_TOUCH_IPAD_PORT ?? 8443)
  if (!isPrivateLanAddress(bindAddress)) {
    throw new Error('The iPad LAN bind address must be an RFC1918 IPv4 or ULA IPv6 address.')
  }
  if (!Object.values(interfaces).flatMap(items => items ?? []).some(item => item.address === bindAddress)) {
    throw new Error('The iPad LAN bind address must belong to a local network interface.')
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('The iPad LAN port must be an integer between 1024 and 65535.')
  }
  if (environment.NATURE_TOUCH_IPAD_PASSWORD!.length < 12) {
    throw new Error('The iPad LAN password must contain at least 12 characters.')
  }

  const keyPath = resolve(environment.NATURE_TOUCH_IPAD_TLS_KEY_PATH!)
  const certificatePath = resolve(environment.NATURE_TOUCH_IPAD_TLS_CERT_PATH!)
  return {
    bindAddress,
    port,
    password: environment.NATURE_TOUCH_IPAD_PASSWORD!,
    tlsKey: readFileSync(keyPath, 'utf8'),
    tlsCertificate: readFileSync(certificatePath, 'utf8'),
    staticDirectory: join(appPath, 'ipad'),
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw new Error('JSON_REQUIRED')
  }
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE')
    chunks.push(buffer)
  }
  const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('INVALID_JSON')
  return payload as Record<string, unknown>
}

function remoteAddress(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unknown'
}

function cookieValue(request: IncomingMessage): string | undefined {
  const cookies = request.headers.cookie?.split(';') ?? []
  const prefix = `${SESSION_COOKIE}=`
  return cookies.map(cookie => cookie.trim()).find(cookie => cookie.startsWith(prefix))?.slice(prefix.length)
}

export class IpadLanServer {
  private readonly config: Omit<IpadLanServerConfig, 'password'>
  private readonly server: Server
  private readonly sessions = new Map<string, Session>()
  private readonly loginFailures = new Map<string, LoginFailures>()
  private readonly eventClients = new Set<ServerResponse>()
  private readonly passwordSalt = randomBytes(16)
  private readonly passwordDigest: Promise<Buffer>
  private readonly unsubscribe: () => void
  private listeningPort: number | undefined
  private closed = false
  private selectionInProgress = false

  constructor(
    config: IpadLanServerConfig,
    private readonly lifecycle: ExhibitionLifecycleController,
    allowLoopbackForTests = false,
  ) {
    const testLoopback = allowLoopbackForTests && config.bindAddress === '127.0.0.1' && config.port === 0
    if (!isPrivateLanAddress(config.bindAddress) && !testLoopback) {
      throw new Error('The iPad LAN server refuses non-private or wildcard bind addresses.')
    }
    if (config.password.length < 12) throw new Error('The iPad LAN password must contain at least 12 characters.')
    this.config = {
      bindAddress: config.bindAddress,
      port: config.port,
      tlsKey: config.tlsKey,
      tlsCertificate: config.tlsCertificate,
      staticDirectory: config.staticDirectory,
    }
    this.passwordDigest = derivePasswordDigest(config.password, this.passwordSalt)
    this.server = createServer({
      key: config.tlsKey,
      cert: config.tlsCertificate,
      minVersion: 'TLSv1.2',
    }, (request, response) => {
      this.applySecurityHeaders(response)
      void this.handle(request, response).catch(error => {
        console.error('iPad LAN request failed:', error)
        if (!response.headersSent) json(response, 500, { error: 'INTERNAL_ERROR' })
        else response.destroy()
      })
    })
    this.unsubscribe = lifecycle.subscribe(snapshot => this.broadcast(snapshot))
  }

  start(): Promise<number> {
    if (this.closed) return Promise.reject(new Error('The iPad LAN server is closed.'))
    return new Promise((resolveListen, rejectListen) => {
      const onError = (error: Error) => rejectListen(error)
      this.server.once('error', onError)
      this.server.listen(this.config.port, this.config.bindAddress, () => {
        this.server.removeListener('error', onError)
        const address = this.server.address()
        if (!address || typeof address === 'string') {
          rejectListen(new Error('The iPad LAN server did not bind a TCP address.'))
          return
        }
        this.listeningPort = address.port
        resolveListen(address.port)
      })
    })
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve()
    this.closed = true
    this.unsubscribe()
    for (const client of this.eventClients) client.end()
    this.eventClients.clear()
    if (!this.server.listening) return Promise.resolve()
    return new Promise((resolveClose, rejectClose) => {
      this.server.close(error => error ? rejectClose(error) : resolveClose())
    })
  }

  private applySecurityHeaders(response: ServerResponse): void {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Strict-Transport-Security', 'max-age=31536000')
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const host = canonicalHost(this.config.bindAddress, this.listeningPort ?? this.config.port)
    if (request.headers.host !== host) {
      json(response, 421, { error: 'MISDIRECTED_REQUEST' })
      return
    }
    const url = new URL(request.url ?? '/', `https://${host}`)
    if (request.method === 'GET' && url.pathname === '/') {
      this.serveFile(response, 'index.html', 'text/html; charset=utf-8')
      return
    }
    if (request.method === 'GET' && url.pathname === '/ipad.js') {
      this.serveFile(response, 'ipad.js', 'text/javascript; charset=utf-8')
      return
    }
    if (request.method === 'GET' && url.pathname === '/ipad.css') {
      this.serveFile(response, 'ipad.css', 'text/css; charset=utf-8')
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/login') {
      await this.login(request, response, `https://${host}`)
      return
    }
    if (url.pathname.startsWith('/api/')) {
      if (!this.requireSession(request, response)) return
      if (request.method === 'POST' && url.pathname === '/api/select') {
        await this.selectExperience(request, response, `https://${host}`)
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        json(response, 200, this.lifecycle.getSnapshot())
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        this.openEventStream(request, response)
        return
      }
      json(response, 404, { error: 'NOT_FOUND' })
      return
    }
    json(response, 404, { error: 'NOT_FOUND' })
  }

  private serveFile(response: ServerResponse, filename: string, contentType: string): void {
    response.writeHead(200, { 'Content-Type': contentType })
    response.end(readFileSync(join(this.config.staticDirectory, filename)))
  }

  private async login(
    request: IncomingMessage,
    response: ServerResponse,
    expectedOrigin: string,
  ): Promise<void> {
    if (request.headers.origin !== expectedOrigin) {
      json(response, 403, { error: 'ORIGIN_NOT_ALLOWED' })
      return
    }
    const ip = remoteAddress(request)
    const now = Date.now()
    const previous = this.loginFailures.get(ip)
    const attempts = previous && now - previous.windowStartedAt < LOGIN_WINDOW_MS
      ? previous
      : { count: 0, windowStartedAt: now }
    if (attempts.count >= LOGIN_FAILURE_LIMIT) {
      json(response, 429, { error: 'LOGIN_RATE_LIMITED' })
      return
    }
    attempts.count += 1
    this.loginFailures.delete(ip)
    if (this.loginFailures.size >= 128) {
      const oldest = this.loginFailures.keys().next().value
      if (oldest !== undefined) this.loginFailures.delete(oldest)
    }
    this.loginFailures.set(ip, attempts)

    let payload: Record<string, unknown>
    try {
      payload = await readJson(request)
    } catch (error) {
      const status = error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413 : 400
      json(response, status, { error: 'INVALID_REQUEST' })
      return
    }
    const password = typeof payload.password === 'string' ? payload.password : ''
    const [candidate, expectedDigest] = await Promise.all([
      derivePasswordDigest(password, this.passwordSalt),
      this.passwordDigest,
    ])
    if (candidate.length !== expectedDigest.length ||
        !timingSafeEqual(candidate, expectedDigest)) {
      json(response, 401, { error: 'INVALID_CREDENTIALS' })
      return
    }
    this.loginFailures.delete(ip)
    this.expireSessions(now)
    if (this.sessions.size >= 32) {
      json(response, 503, { error: 'SESSION_LIMIT_REACHED' })
      return
    }
    const token = randomBytes(32).toString('base64url')
    this.sessions.set(token, { expiresAt: now + SESSION_TTL_MS })
    response.setHeader('Set-Cookie',
      `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`)
    json(response, 200, { authenticated: true })
  }

  private requireSession(request: IncomingMessage, response: ServerResponse): boolean {
    const token = cookieValue(request)
    const now = Date.now()
    this.expireSessions(now)
    const session = token ? this.sessions.get(token) : undefined
    if (!session) {
      json(response, 401, { error: 'AUTHENTICATION_REQUIRED' })
      return false
    }
    session.expiresAt = now + SESSION_TTL_MS
    return true
  }

  private async selectExperience(
    request: IncomingMessage,
    response: ServerResponse,
    expectedOrigin: string,
  ): Promise<void> {
    if (request.headers.origin !== expectedOrigin) {
      json(response, 403, { error: 'ORIGIN_NOT_ALLOWED' })
      return
    }
    let payload: Record<string, unknown>
    try {
      payload = await readJson(request)
    } catch {
      json(response, 400, { error: 'INVALID_REQUEST' })
      return
    }
    if (typeof payload.experienceId !== 'string' ||
        !EXPERIENCE_IDS.includes(payload.experienceId as typeof EXPERIENCE_IDS[number])) {
      json(response, 400, { error: 'INVALID_EXPERIENCE' })
      return
    }
    if (this.selectionInProgress || this.lifecycle.getSnapshot().phase !== 'READY') {
      json(response, 409, { error: 'EXHIBITION_BUSY' })
      return
    }
    this.selectionInProgress = true
    try {
      const result = await this.lifecycle.select({
        type: 'SELECT',
        mode: 'mock',
        experienceId: payload.experienceId as typeof EXPERIENCE_IDS[number],
        requestId: randomBytes(12).toString('hex'),
      })
      if (!result.accepted) {
        json(response, 409, { error: 'SELECT_REJECTED' })
        return
      }
      json(response, 202, { accepted: true, snapshot: this.lifecycle.getSnapshot() })
    } catch (error) {
      const busy = this.lifecycle.getSnapshot().phase !== 'READY'
      json(response, busy ? 409 : 503, { error: busy ? 'EXHIBITION_BUSY' : 'SELECT_FAILED' })
    } finally {
      this.selectionInProgress = false
    }
  }

  private openEventStream(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    this.eventClients.add(response)
    this.sendSnapshot(response, this.lifecycle.getSnapshot())
    const heartbeat = setInterval(() => {
      if (!response.destroyed) response.write(': keep-alive\n\n')
    }, 15_000)
    const cleanup = () => {
      clearInterval(heartbeat)
      this.eventClients.delete(response)
    }
    request.on('aborted', cleanup)
    response.on('close', cleanup)
  }

  private broadcast(snapshot: ExhibitionLifecycleSnapshot): void {
    for (const client of this.eventClients) {
      if (client.destroyed || !client.writable) {
        this.eventClients.delete(client)
        continue
      }
      this.sendSnapshot(client, snapshot)
    }
  }

  private sendSnapshot(client: ServerResponse, snapshot: ExhibitionLifecycleSnapshot): void {
    client.write(`id: ${snapshot.revision}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
  }

  private expireSessions(now: number): void {
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(token)
    }
  }
}

export function createIpadLanServer(
  config: IpadLanServerConfig,
  lifecycle: ExhibitionLifecycleController,
): IpadLanServer {
  return new IpadLanServer(config, lifecycle)
}

export function createTestIpadLanServer(
  config: IpadLanServerConfig,
  lifecycle: ExhibitionLifecycleController,
): IpadLanServer {
  return new IpadLanServer(config, lifecycle, true)
}
