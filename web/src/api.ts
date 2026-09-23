import type { UsageResponse } from './types'

export async function getUsage(): Promise<UsageResponse> {
  const response = await fetch('/api/usage')
  if (!response.ok) throw new Error('Unable to load usage')
  return response.json() as Promise<UsageResponse>
}

export async function refreshUsage(): Promise<UsageResponse> {
  const response = await fetch('/api/usage/refresh', { method: 'POST' })
  if (!response.ok) throw new Error('Unable to refresh usage')
  return response.json() as Promise<UsageResponse>
}
