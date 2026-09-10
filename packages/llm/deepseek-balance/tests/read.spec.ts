import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import DeepSeekBalance, { BalanceError } from '../src/index.ts'
import type { Config } from '../src/index.ts'

const CNY = { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }

afterEach(() => { vi.unstubAllGlobals() })

/** A credential provider holding one key, or none. */
class StubCredentials extends Service {
  constructor(ctx: Context, private readonly value: string | undefined) {
    super(ctx, 'credentials')
  }

  resolve(): Promise<ResolvedCredential | undefined> {
    return Promise.resolve(this.value === undefined ? undefined : { value: this.value, source: 'memory' })
  }
}

/** One JSON answer, as `fetch` would return it. */
function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Boot the reader over a scripted transport. */
async function boot(options: {
  response?: Response | (() => Promise<Response>)
  credential?: string | undefined
  config?: Partial<Config>
} = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const scripted = options.response ?? answer(200, { is_available: true, balance_infos: [CNY] })
  // A Response body reads once, so a fixed answer is captured as text and
  // rebuilt per call — which is what a real transport does anyway.
  const fixed = typeof scripted === 'function'
    ? undefined
    : { status: scripted.status, headers: scripted.headers, body: await scripted.text() }
  const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    if (fixed === undefined) return (scripted as () => Promise<Response>)()
    return Promise.resolve(new Response(fixed.body, { status: fixed.status, headers: fixed.headers }))
  })
  vi.stubGlobal('fetch', fetchMock)

  const ctx = new Context()
  const key = 'credential' in options ? options.credential : 'sk-live'
  if (key !== undefined) await ctx.plugin(StubCredentials, key)
  await ctx.plugin(DeepSeekBalance, {
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    timeoutMs: 10_000,
    ...options.config,
  } as Config)
  return { object: ctx.deepseekBalance, calls, fetchMock }
}

/** Run one read and return whatever it threw. */
async function failureOf(read: () => Promise<unknown>): Promise<unknown> {
  return await read().catch((error: unknown) => error)
}

describe('reading the account balance', () => {
  it('reads the configured endpoint once with the resolved key', async () => {
    const { object, calls } = await boot()
    const snapshot = await object.read()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.deepseek.com/user/balance')
    expect(calls[0]?.init.method).toBe('GET')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-live')
    expect(snapshot.available).toBe(true)
    expect(snapshot.lines).toEqual([{
      currency: 'CNY', totalMinor: 11_000, grantedMinor: 1_000, toppedUpMinor: 10_000,
    }])
    expect(Number.isSafeInteger(snapshot.readAt)).toBe(true)
  })

  it('refuses to follow a redirect instead of handing the key to another host', async () => {
    // The policy is opted into per request; asserting it here is the regression
    // guard that no later edit can drop it.
    const { object, calls } = await boot()
    await object.read()
    expect(calls[0]?.init.redirect).toBe('error')
  })

  it('honours a configured base and keeps any path prefix it carries', async () => {
    const { object, calls } = await boot({ config: { baseURL: 'https://gateway.internal/deepseek/' } })
    await object.read()
    expect(calls[0]?.url).toBe('https://gateway.internal/deepseek/user/balance')
  })

  it('falls back to the public API when no base is configured', async () => {
    const { object, calls } = await boot()
    await object.read()
    expect(calls[0]?.url).toContain('https://api.deepseek.com')
  })

  it('names a missing credential instead of issuing an unauthenticated request', async () => {
    const { object, calls } = await boot({ credential: undefined })
    const failure = await failureOf(() => object.read())
    expect(failure).toBeInstanceOf(BalanceError)
    expect((failure as BalanceError).code).toBe('MISSING_CREDENTIAL')
    expect(calls).toHaveLength(0)
  })

  it('refuses a credential reference that is not a variable name', async () => {
    const { object } = await boot({ config: { apiKeyEnv: 'not a name' } })
    const failure = await failureOf(() => object.read())
    expect((failure as BalanceError).code).toBe('MISSING_CREDENTIAL')
  })

  it('reports a rejected key as unauthorized', async () => {
    const { object } = await boot({ response: answer(401, { error: 'bad key' }) })
    const failure = await failureOf(() => object.read())
    expect((failure as BalanceError).code).toBe('UNAUTHORIZED')
    expect((failure as BalanceError).message).toContain('401')
  })

  it('names an endpoint that does not serve the balance API', async () => {
    // The realistic failure for a proxy that mirrored only the chat API.
    for (const status of [404, 405]) {
      const { object } = await boot({ response: answer(status, {}) })
      const failure = await failureOf(() => object.read())
      expect((failure as BalanceError).code).toBe('UNSUPPORTED_ENDPOINT')
    }
  })

  it('classifies any other status as a transport failure', async () => {
    const { object } = await boot({ response: answer(500, {}) })
    const failure = await failureOf(() => object.read())
    expect((failure as BalanceError).code).toBe('HTTP_ERROR')
  })

  it('rejects a body that is not JSON', async () => {
    const { object } = await boot({
      response: new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    })
    const failure = await failureOf(() => object.read())
    expect((failure as BalanceError).code).toBe('MALFORMED_RESPONSE')
  })

  it('rejects a JSON body that is not a balance reply', async () => {
    const { object } = await boot({ response: answer(200, { ok: true }) })
    const failure = await failureOf(() => object.read())
    expect((failure as BalanceError).code).toBe('MALFORMED_RESPONSE')
  })

  it('reports caller cancellation as an abort, not as a provider error', async () => {
    const { object } = await boot({
      response: () => Promise.reject(new Error('aborted')),
    })
    const controller = new AbortController()
    controller.abort()
    const failure = await failureOf(() => object.read(controller.signal))
    expect((failure as BalanceError).code).toBe('ABORTED')
  })

  it('reports a transport failure as an HTTP error carrying its cause', async () => {
    const { object } = await boot({ response: () => Promise.reject(new Error('ECONNREFUSED')) })
    const failure = await failureOf(() => object.read())
    expect((failure as BalanceError).code).toBe('HTTP_ERROR')
    expect((failure as BalanceError).cause).toBeInstanceOf(Error)
  })

  it('resolves the credential per read, so a rotated key is used next time', async () => {
    const { object, calls } = await boot()
    await object.read()
    await object.read()
    expect(calls).toHaveLength(2)
  })
})
