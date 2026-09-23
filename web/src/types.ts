export interface UsageWindow {
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
  windows?: UsageWindow[]
  metrics?: UsageMetric[]
}

export interface UsageResponse {
  updatedAt: string | null
  providers: Usage[]
}
