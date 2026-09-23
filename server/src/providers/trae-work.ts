import { now, type Usage, type UsageProvider } from '../usage.js'
import { updateServerEnv } from '../env-store.js'

type EntitlementPack = {
  entitlement_base_info?: { quota?: { credits_limit?: unknown } }
  usage?: { credits_amount?: unknown }
}

type EntitlementResponse = {
  user_entitlement_pack_list?: unknown
}

type TokenResponse = {
  Result?: { Token?: unknown, RefreshToken?: unknown, TokenExpireAt?: unknown, TokenExpireDuration?: unknown }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function expirySeconds(): number | null {
  const value = Number(process.env.TRAE_WORK_TOKEN_EXPIRES_AT)
  return Number.isFinite(value) && value > 0 ? value : null
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = process.env.TRAE_WORK_REFRESH_TOKEN?.trim()
  if (!refreshToken) throw new Error('TRAE Work access token needs refresh, but TRAE_WORK_REFRESH_TOKEN is not configured')
  const response = await fetch('https://api.trae.com.cn/cloudide/api/v3/trae/oauth/ExchangeToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Trae/0.1.43' },
    body: JSON.stringify({ ClientID: 'en1oxy7wnw8j9n', RefreshToken: refreshToken, ClientSecret: '-', UserID: '' }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`TRAE Work token refresh failed (HTTP ${response.status})`)
  const body = (await response.json()) as TokenResponse
  const accessToken = typeof body.Result?.Token === 'string' ? body.Result.Token : ''
  if (!accessToken) throw new Error('TRAE Work token refresh returned no access token')
  const rotatedRefreshToken = typeof body.Result?.RefreshToken === 'string' && body.Result.RefreshToken
    ? body.Result.RefreshToken
    : refreshToken
  const rawExpiry = typeof body.Result?.TokenExpireAt === 'number' ? body.Result.TokenExpireAt : 0
  const duration = typeof body.Result?.TokenExpireDuration === 'number' ? body.Result.TokenExpireDuration : 0
  const expiresAt = rawExpiry > 0
    ? (rawExpiry > 1_000_000_000_000 ? Math.floor(rawExpiry / 1000) : rawExpiry)
    : (duration > 0 ? Math.floor(Date.now() / 1000) + duration : '')
  await updateServerEnv({
    TRAE_WORK_ACCESS_TOKEN: accessToken,
    TRAE_WORK_REFRESH_TOKEN: rotatedRefreshToken,
    TRAE_WORK_TOKEN_EXPIRES_AT: String(expiresAt),
  })
  return accessToken
}

async function currentAccessToken(): Promise<string> {
  const token = requiredEnv('TRAE_WORK_ACCESS_TOKEN')
  const expiresAt = expirySeconds()
  // Refresh five minutes early when the known expiry is close.
  if (expiresAt !== null && expiresAt <= Math.floor(Date.now() / 1000) + 300) return refreshAccessToken()
  return token
}

async function fetchUsage(accessToken: string, deviceId: string): Promise<Response> {
  return fetch('https://api.trae.cn/trae/api/v2/pay/ide_user_ent_usage', {
    method: 'POST',
    headers: {
      Authorization: `Cloud-IDE-JWT ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-User-Region': 'CN',
      'X-Device-Id': deviceId,
    },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  })
}

/**
 * Read-only TRAE SOLO entitlement usage. The endpoint and fields are based on
 * the desktop client's observed API contract and may change without notice.
 */
export class TraeWorkProvider implements UsageProvider {
  async getUsage(): Promise<Usage> {
    const deviceId = requiredEnv('TRAE_WORK_DEVICE_ID')
    let response = await fetchUsage(await currentAccessToken(), deviceId)
    // Existing env files may not have an expiry. If their token has already
    // expired, one refresh-and-retry keeps the dashboard self-healing.
    if (response.status === 401 && process.env.TRAE_WORK_REFRESH_TOKEN?.trim()) {
      response = await fetchUsage(await refreshAccessToken(), deviceId)
    }
    if (!response.ok) throw new Error(`TRAE Work usage request failed (HTTP ${response.status})`)

    const body = (await response.json()) as EntitlementResponse
    const packs = body.user_entitlement_pack_list
    if (!Array.isArray(packs)) throw new Error('TRAE Work usage response has an unexpected format')

    const quota = packs.reduce((sum, item) => {
      const pack = item as EntitlementPack
      const total = numberValue(pack.entitlement_base_info?.quota?.credits_limit)
      const used = Math.min(total, numberValue(pack.usage?.credits_amount))
      sum.total += total
      sum.used += used
      return sum
    }, { total: 0, used: 0 })
    if (quota.total <= 0) throw new Error('TRAE Work usage response has no active quota')

    const remaining = Math.max(0, quota.total - quota.used)
    return {
      provider: 'trae-work',
      used: quota.used,
      total: quota.total,
      remaining,
      percent: (quota.used / quota.total) * 100,
      resetAt: null,
      updatedAt: now(),
      status: 'ok',
      metrics: [{ label: '有效额度包', value: packs.length }],
    }
  }
}
