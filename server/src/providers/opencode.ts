import { now, type Usage, type UsageProvider, type UsageWindow } from '../usage.js'

type WindowName = 'rolling' | 'weekly' | 'monthly'

type OpenCodeWindow = {
  status?: unknown
  percent?: unknown
  resetsAt?: unknown
}

type OpenCodeResponse = {
  usage?: Partial<Record<WindowName, OpenCodeWindow>>
}

function windowFromEnv(): WindowName {
  const value = process.env.OPENCODE_GO_WINDOW
  return value === 'weekly' || value === 'monthly' ? value : 'rolling'
}

function asPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error('OpenCode response contains an invalid usage percent')
  }
  return value
}

const windowLabels: Record<WindowName, string> = {
  rolling: 'Rolling 5 hours',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

function parseWindow(name: WindowName, source: OpenCodeWindow | undefined): UsageWindow | null {
  if (!source || (source.status !== 'ok' && source.status !== 'rate-limited')) return null
  const percent = asPercent(source.percent)
  return {
    label: windowLabels[name],
    used: percent,
    total: 100,
    remaining: 100 - percent,
    percent,
    resetAt: typeof source.resetsAt === 'string' && percent > 0 ? source.resetsAt : null,
  }
}

export class OpenCodeProvider implements UsageProvider {
  async getUsage(): Promise<Usage> {
    const apiKey = process.env.OPENCODE_GO_API_KEY
    if (!apiKey) throw new Error('OPENCODE_GO_API_KEY is not configured')

    console.info('[OpenCode] fetching usage')
    const response = await fetch('https://opencode.ai/zen/go/v1/usage', {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`OpenCode request failed (HTTP ${response.status})`)

    const body = (await response.json()) as OpenCodeResponse
    const windows = (['rolling', 'weekly', 'monthly'] as const)
      .map((name) => parseWindow(name, body.usage?.[name]))
      .filter((window): window is UsageWindow => window !== null)
    const selected = windows.find((window) => window.label === windowLabels[windowFromEnv()])
    if (!selected) {
      throw new Error('OpenCode response does not contain an active usage window')
    }

    console.info('[OpenCode] success')
    return {
      provider: 'opencode',
      ...selected,
      updatedAt: now(),
      status: 'ok',
      windows,
    }
  }
}
