/**
 * DeepSeek account-balance reader (`ctx.deepseekBalance`): one authenticated
 * `GET /user/balance` against the configured endpoint, decoded into exact minor
 * units.
 *
 * The reader owns no cache. Resolution is per call — the credential is read
 * afresh so a rotated key reaches the next read without a restart — and a
 * caller that wants a time series of its own samples the endpoint on its own
 * schedule.
 *
 * @module @deepseek-ai/dsh-deepseek-balance
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { BalanceError } from './errors.ts'
import { parseBalanceResponse } from './parse.ts'
import type { BalanceSnapshot } from './types.ts'

export { BalanceError } from './errors.ts'
export { balanceResponseSchema, parseBalanceResponse, toMinor } from './parse.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    deepseekBalance: DeepSeekBalance
  }
}

/** Credential reference read when the composition states none. */
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Public API base used when neither config nor environment supplies one. */
const DEFAULT_BASE_URL = 'https://api.deepseek.com'

/** Environment variable carrying a deployment-private base URL. */
const BASE_URL_ENV = 'DEEPSEEK_BASE_URL'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Path the balance endpoint lives at, appended to the configured base. */
const BALANCE_PATH = '/user/balance'

/**
 * Plugin config. The endpoint and the credential reference are deployment
 * choices — a proxy that mirrors the API lives at another base, and a
 * deployment that names its key differently says so — so both are stated
 * rather than assumed.
 */
export interface Config {
  /** Credential reference (environment-variable name) resolved per read. */
  apiKeyEnv: string
  /** Endpoint base; falls back to $DEEPSEEK_BASE_URL from a trusted environment layer, then the public API. */
  baseURL?: string
  /** Upper bound on one read, in milliseconds. */
  timeoutMs: number
}

export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  timeoutMs: z.natural().min(1).default(10_000),
})

/**
 * The balance reader. Stateless: every read resolves its own credential and
 * performs its own request.
 */
export class DeepSeekBalance extends Service {
  static Config: z<Config> = Config

  /**
   * @param ctx - Cordis context, which may carry a credential provider.
   * @param config - validated plugin config.
   */
  constructor(ctx: Context, public config: Config) {
    super(ctx, 'deepseekBalance')
  }

  /**
   * Read the account balance once.
   *
   * The credential is resolved per call, so a changed key reaches the next read
   * without a restart. Redirects are refused rather than followed: the request
   * carries the account key, and a redirect would hand it to whichever host
   * answered.
   *
   * @param signal - caller cancellation; combined with the configured timeout.
   * @returns the account's availability and per-currency balances.
   * @throws BalanceError when no credential resolves, the endpoint refuses, or the reply is not the documented shape.
   */
  async read(signal?: AbortSignal): Promise<BalanceSnapshot> {
    const apiKey = await this.resolveApiKey()
    const endpoint = this.endpoint()
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const composed = signal === undefined ? timeout : AbortSignal.any([signal, timeout])

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        redirect: 'error',
        headers: {
          authorization: 'Bearer ' + apiKey,
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        signal: composed,
      })
    } catch (error: unknown) {
      if (signal?.aborted === true) {
        throw new BalanceError('the balance read was cancelled', 'ABORTED', { cause: error })
      }
      throw new BalanceError(
        'DeepSeek balance request to ' + endpoint + ' failed: ' + String(error),
        'HTTP_ERROR',
        { cause: error },
      )
    }

    if (!response.ok) throw refusal(response.status, endpoint)

    let body: unknown
    try {
      body = await response.json()
    } catch (error: unknown) {
      if (signal?.aborted === true) {
        throw new BalanceError('the balance read was cancelled', 'ABORTED', { cause: error })
      }
      throw new BalanceError(
        'DeepSeek balance response from ' + endpoint + ' was not JSON',
        'MALFORMED_RESPONSE',
        { cause: error },
      )
    }

    return { ...parseBalanceResponse(body), readAt: Date.now() }
  }

  /**
   * Resolve the credential reference across the seated provider, or the launch
   * environment when the composition mounts no provider.
   */
  private async resolveApiKey(): Promise<string> {
    const name = this.config.apiKeyEnv
    if (!isCredentialRefName(name)) {
      throw new BalanceError(
        'balance apiKeyEnv "' + name + '" is not an environment-variable name',
        'MISSING_CREDENTIAL',
      )
    }
    const ref = credentialRef(name)
    const credentials = this.ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return hit.value
    } else {
      // Without the seam there is no managed store to rank against, so the
      // environment is the whole credential plane.
      const ambient = launchEnvironmentOf(this.ctx).get(name)
      if (ambient !== undefined && ambient.value.length > 0) return ambient.value
    }
    throw new BalanceError(
      'no API key for balance reference "' + name + '"; store it through the credentials service'
      + ' (the web Models page writes it), or export ' + name + ' in the launching environment',
      'MISSING_CREDENTIAL',
    )
  }

  /**
   * The endpoint this deployment reads.
   *
   * A configured base wins, then the launch environment, then the public API.
   * A base carrying a path keeps it, so a proxy mounted under a prefix is
   * addressed where it actually is instead of at the public root.
   */
  private endpoint(): string {
    const base = this.config.baseURL
      ?? launchEnvironmentOf(this.ctx).get(BASE_URL_ENV)?.value
      ?? DEFAULT_BASE_URL
    return base.replace(/\/+$/u, '') + BALANCE_PATH
  }
}

/**
 * Classify one non-2xx answer. A proxy that mirrors only the chat API answers
 * 404 here, which is a deployment fact worth naming rather than a generic
 * transport error.
 * @param status - the HTTP status.
 * @param endpoint - the endpoint that answered, for the message.
 * @returns the error to throw.
 */
function refusal(status: number, endpoint: string): BalanceError {
  if (status === 401 || status === 403) {
    return new BalanceError(
      'DeepSeek rejected the API key for ' + endpoint + ' (HTTP ' + String(status) + ')',
      'UNAUTHORIZED',
    )
  }
  if (status === 404 || status === 405) {
    return new BalanceError(
      endpoint + ' does not serve the balance API (HTTP ' + String(status)
      + '); this endpoint is probably a proxy that mirrors only the chat API',
      'UNSUPPORTED_ENDPOINT',
    )
  }
  return new BalanceError(
    'DeepSeek balance request to ' + endpoint + ' answered HTTP ' + String(status),
    'HTTP_ERROR',
  )
}

export default DeepSeekBalance
