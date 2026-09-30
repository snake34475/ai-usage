import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { now, type Usage, type UsageProvider } from '../usage.js'
import { updateServerEnv } from '../env-store.js'

type BalanceEntry = {
  show_name?: unknown
  showName?: unknown
  model?: unknown
  total_units?: unknown
  totalUnits?: unknown
  used_units?: unknown
  usedUnits?: unknown
  remaining_units?: unknown
  remainingUnits?: unknown
  unit_type?: unknown
  unitType?: unknown
  expires_at?: unknown
  expiresAt?: unknown
}

type BalanceResponse = {
  code?: unknown
  success?: unknown
  msg?: unknown
  data?: { balances?: unknown }
}

type ParsedBalance = {
  label: string
  total: number
  used: number
  expiresAt: string | null
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : ''
}

/** Upstream sends epoch seconds or milliseconds depending on the endpoint. */
function isoFromEpoch(value: number): string {
  return new Date(value > 1_000_000_000_000 ? value : value * 1000).toISOString()
}

function parseBalance(row: BalanceEntry): ParsedBalance | null {
  const total = numberValue(row.total_units ?? row.totalUnits)
  const used = numberValue(row.used_units ?? row.usedUnits)
  const remaining = numberValue(row.remaining_units ?? row.remainingUnits)
  // Rows without a single usable number are display noise upstream.
  if (total === null && used === null && remaining === null) return null

  const resolvedTotal = Math.max(0, total ?? (used !== null && remaining !== null ? used + remaining : 0))
  const resolvedUsed = Math.max(
    0,
    resolvedTotal > 0
      ? Math.min(resolvedTotal, used ?? Math.max(0, resolvedTotal - (remaining ?? 0)))
      : (used ?? 0),
  )

  const label = stringValue(row.show_name ?? row.showName) || stringValue(row.model) || '未知模型'
  const unitType = stringValue(row.unit_type ?? row.unitType)
  const expiresAt = numberValue(row.expires_at ?? row.expiresAt)
  return {
    label: unitType ? `${label}（${unitType}）` : label,
    total: resolvedTotal,
    used: resolvedUsed,
    expiresAt: expiresAt !== null && expiresAt > 0 ? isoFromEpoch(expiresAt) : null,
  }
}

function osCategory(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'macos'
  if (platform === 'win32') return 'windows'
  return 'linux'
}

/**
 * Companion headers the official client sends on zcode.z.ai control-plane
 * calls (no X-ZCode-Agent on this plane). The billing gateway is behind
 * client fingerprinting, so a stable X-Device-Mid matters.
 */
function identityHeaders(origin: string, appVersion: string, deviceMid: string): Record<string, string> {
  let language = 'unknown'
  let timezone = 'unknown'
  try { language = Intl.DateTimeFormat().resolvedOptions().locale || 'unknown' } catch { /* keep fallback */ }
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown' } catch { /* keep fallback */ }
  return {
    'User-Agent': `ZCode/${appVersion}`,
    'HTTP-Referer': origin,
    'X-Title': 'Z Code@cli',
    'X-ZCode-App-Version': appVersion,
    'X-Platform': `${process.platform}-${os.arch()}`,
    'X-Release-Channel': 'production',
    'X-Client-Language': language,
    'X-Client-Timezone': timezone,
    'X-Os-Category': osCategory(process.platform),
    'X-Device-Mid': deviceMid,
  }
}

async function deviceMid(): Promise<string> {
  const existing = process.env.ZCODE_DEVICE_MID?.trim()
  if (existing) return existing
  // The gateway expects one stable device id; persist the generated value so
  // every refresh reuses it instead of cycling identities.
  const generated = randomUUID()
  await updateServerEnv({ ZCODE_DEVICE_MID: generated })
  return generated
}

/**
 * Read-only ZCode start-plan (GLM) credit balance from the platform billing
 * plane. The API is undocumented; response fields were confirmed against the
 * official client's observed contract and may change without notice.
 */
export class ZCodeProvider implements UsageProvider {
  async getUsage(): Promise<Usage> {
    const jwt = requiredEnv('ZCODE_PLAN_JWT')
    const origin = (process.env.ZCODE_PLAN_ORIGIN?.trim() || 'https://zcode.z.ai').replace(/\/+$/, '')
    const appVersion = process.env.ZCODE_APP_VERSION?.trim() || '3.14.0'
    const platform = `${process.platform}-${os.arch()}`

    const response = await fetch(
      `${origin}/api/v1/zcode-plan/billing/balance?app_version=${encodeURIComponent(appVersion)}&platform=${encodeURIComponent(platform)}`,
      {
        headers: {
          ...identityHeaders(origin, appVersion, await deviceMid()),
          authorization: `Bearer ${jwt}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (response.status === 401 || response.status === 403) {
      throw new Error(`ZCode plan token was rejected (HTTP ${response.status}); run "pnpm zcode:login" to sign in again`)
    }
    if (!response.ok) throw new Error(`ZCode balance request failed (HTTP ${response.status})`)

    const body = (await response.json()) as BalanceResponse
    // The billing gateway accepts code 0/200 or an absent code; success=false always fails.
    if (body.success === false || (typeof body.code === 'number' && body.code !== 0 && body.code !== 200)) {
      throw new Error(`ZCode balance request failed: ${stringValue(body.msg) || `code ${String(body.code)}`}`)
    }

    const rows = Array.isArray(body.data?.balances) ? (body.data.balances as BalanceEntry[]) : []
    const balances = rows.map(parseBalance).filter((balance): balance is ParsedBalance => balance !== null)
    if (!balances.length) throw new Error('ZCode balance response has no usable entries')

    const total = balances.reduce((sum, balance) => sum + balance.total, 0)
    const used = balances.reduce((sum, balance) => sum + balance.used, 0)
    if (total <= 0) throw new Error('ZCode balance response has no active quota')
    const resetAt = balances.reduce<string | null>(
      (earliest, balance) => (!balance.expiresAt ? earliest : !earliest || balance.expiresAt < earliest ? balance.expiresAt : earliest),
      null,
    )

    return {
      provider: 'zcode',
      used,
      total,
      remaining: Math.max(0, total - used),
      percent: (used / total) * 100,
      resetAt,
      updatedAt: now(),
      status: 'ok',
      windows: balances.map((balance) => ({
        label: balance.label,
        used: balance.used,
        total: balance.total,
        remaining: Math.max(0, balance.total - balance.used),
        percent: balance.total > 0 ? (balance.used / balance.total) * 100 : 0,
        resetAt: balance.expiresAt,
      })),
      metrics: [{ label: '余额条目', value: balances.length }],
    }
  }
}
