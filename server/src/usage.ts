export interface UsageWindow {
  /** Human-readable quota period supplied by the provider. */
  label: string
  used: number
  total: number
  remaining: number
  percent: number
  resetAt?: string | null
}

export interface UsageMetric {
  label: string
  value: string | number
}

export interface Usage {
  provider: string
  used: number
  total: number
  remaining: number
  percent: number
  resetAt?: string | null
  updatedAt: string
  status: 'ok' | 'error'
  error?: string
  /** Multiple real quota windows, when the upstream API supplies them. */
  windows?: UsageWindow[]
  /** Read-only provider facts that supplement a quota. */
  metrics?: UsageMetric[]
}

export interface UsageProvider {
  getUsage(): Promise<Usage>
}

export const now = () => new Date().toISOString()

export function errorUsage(provider: string, error: unknown): Usage {
  return {
    provider,
    used: 0,
    total: 0,
    remaining: 0,
    percent: 0,
    resetAt: null,
    updatedAt: now(),
    status: 'error',
    error: error instanceof Error ? error.message : 'Unknown provider error',
  }
}
