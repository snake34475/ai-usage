import { now, type Usage, type UsageProvider } from '../usage.js'
import { readLocalWorkBuddyAuth } from './workbuddy-auth.js'

type ResourceAccount = {
  CapacitySize?: unknown
  CapacityRemain?: unknown
  CycleCapacitySize?: unknown
  CycleCapacityRemain?: unknown
}

type ResourceResponse = {
  code?: unknown
  msg?: unknown
  data?: { Response?: { Data?: { Accounts?: unknown } } }
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function packageQuota(account: ResourceAccount): { total: number, remaining: number } {
  const cycleTotal = asNumber(account.CycleCapacitySize)
  const total = cycleTotal > 0 ? cycleTotal : asNumber(account.CapacitySize)
  const sourceRemaining = cycleTotal > 0 ? account.CycleCapacityRemain : account.CapacityRemain
  return { total: Math.max(0, total), remaining: Math.max(0, Math.min(total, asNumber(sourceRemaining))) }
}

/**
 * Current AI resource-pack quota. This is a non-public WorkBuddy desktop
 * endpoint, verified locally on 2026-09-23; keep failures isolated because
 * the upstream may change without notice.
 */
export class WorkBuddyResourceProvider implements UsageProvider {
  async getUsage(): Promise<Usage> {
    const { token } = await readLocalWorkBuddyAuth()
    const nowDate = new Date()
    const response = await fetch('https://www.codebuddy.cn/v2/billing/meter/get-user-resource', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        PageNumber: 1,
        PageSize: 100,
        ProductCode: 'p_tcaca',
        Status: [0, 3],
        PackageEndTimeRangeBegin: localDateTime(nowDate),
        PackageEndTimeRangeEnd: localDateTime(new Date(nowDate.getTime() + 365 * 101 * 24 * 60 * 60 * 1000)),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`WorkBuddy resource request failed (HTTP ${response.status})`)
    const body = (await response.json()) as ResourceResponse
    const accounts = body.data?.Response?.Data?.Accounts
    if (body.code !== 0 || !Array.isArray(accounts)) {
      throw new Error(`WorkBuddy resource request failed: ${typeof body.msg === 'string' ? body.msg : 'unexpected response'}`)
    }

    const quota = accounts.reduce((total, item) => {
      const account = packageQuota(item as ResourceAccount)
      total.total += account.total
      total.remaining += account.remaining
      return total
    }, { total: 0, remaining: 0 })
    if (quota.total === 0) throw new Error('WorkBuddy resource response has no active quota')
    const used = Math.max(0, quota.total - quota.remaining)
    return {
      provider: 'workbuddy',
      used,
      total: quota.total,
      remaining: quota.remaining,
      percent: (used / quota.total) * 100,
      resetAt: null,
      updatedAt: now(),
      status: 'ok',
      metrics: [{ label: '有效资源包', value: accounts.length }],
    }
  }
}

function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
