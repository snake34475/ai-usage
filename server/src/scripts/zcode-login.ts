import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(here, '../../.env')
dotenv.config({ path: envPath })

const origin = (process.env.ZCODE_PLAN_ORIGIN?.trim() || 'https://zcode.z.ai').replace(/\/+$/, '')
const apiBase = `${origin}/api/v1`
const provider = 'bigmodel'
const appVersion = process.env.ZCODE_APP_VERSION?.trim() || '3.14.0'
const loginTimeoutMs = 300_000

type Envelope = { code?: unknown, msg?: unknown, data?: unknown }

type CliInitData = {
  flow_id: string
  authorize_url: string
  expires_at: number
  poll_interval_sec: number
}

type CliPollData = {
  status?: unknown
  token?: unknown
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function stringValue(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : ''
}

async function startFlow(pollToken: string): Promise<CliInitData> {
  const response = await fetch(`${apiBase}/oauth/cli/init`, {
    method: 'POST',
    headers: { authorization: `Bearer ${pollToken}`, 'content-type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ provider }),
    signal: AbortSignal.timeout(15_000),
  })
  let raw: Envelope | null = null
  try { raw = JSON.parse(await response.text()) as Envelope } catch { raw = null }
  if (!raw || typeof raw.code !== 'number') throw new Error(`Login init: invalid response envelope (HTTP ${response.status})`)
  if (!response.ok || raw.code !== 0) throw new Error(`Login init failed (HTTP ${response.status}, code ${raw.code}${raw.msg ? `, ${stringValue(raw.msg)}` : ''})`)
  const data = (raw.data ?? {}) as CliInitData
  const flowId = stringValue(data.flow_id)
  const authorizeUrl = stringValue(data.authorize_url)
  if (!flowId || !authorizeUrl || typeof data.expires_at !== 'number' || data.expires_at <= 0 || typeof data.poll_interval_sec !== 'number' || data.poll_interval_sec <= 0) {
    throw new Error('Login init: invalid response data')
  }
  return { flow_id: flowId, authorize_url: authorizeUrl, expires_at: data.expires_at, poll_interval_sec: data.poll_interval_sec }
}

/**
 * One poll round with the official client's error semantics: 4xx (except
 * 408/429) and a non-zero envelope code are fatal; network errors, 5xx, and
 * malformed 200 bodies are retried as if pending.
 */
async function pollOnce(flowId: string, pollToken: string): Promise<{ retry: true } | { retry: false, data: CliPollData | null }> {
  let response: Response
  try {
    response = await fetch(`${apiBase}/oauth/cli/poll/${encodeURIComponent(flowId)}`, {
      headers: { authorization: `Bearer ${pollToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return { retry: true }
  }
  if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
    throw new Error(`Login poll failed (HTTP ${response.status})`)
  }
  if (!response.ok) return { retry: true }
  let raw: Envelope | null = null
  try { raw = JSON.parse(await response.text()) as Envelope } catch { return { retry: true } }
  if (!raw || typeof raw.code !== 'number') return { retry: true }
  if (raw.code !== 0) throw new Error(`Login poll failed (code ${raw.code}${raw.msg ? `, ${stringValue(raw.msg)}` : ''})`)
  return { retry: false, data: (raw.data ?? null) as CliPollData | null }
}

async function waitForPlanToken(flow: CliInitData, pollToken: string): Promise<string> {
  const deadline = Math.min(Date.now() + loginTimeoutMs, flow.expires_at * 1000)
  const intervalMs = Math.max(1_000, flow.poll_interval_sec * 1000)
  for (;;) {
    if (Date.now() >= deadline) throw new Error('Authorization timed out. Please retry login.')
    const outcome = await pollOnce(flow.flow_id, pollToken)
    if (outcome.retry) {
      await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())))
      continue
    }
    const data = outcome.data
    if (data?.status === 'ready') {
      const token = stringValue(data.token)
      if (!token) throw new Error('Login succeeded but the response carried no plan token')
      return token
    }
    if (data?.status === 'failed') throw new Error('Authorization failed. Please retry login.')
    if (data?.status !== 'pending') throw new Error('Login poll returned an unexpected status')
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())))
  }
}

function envValue(value: string): string {
  return value.replaceAll('\r', '').replaceAll('\n', '')
}

async function updateEnv(values: Record<string, string>): Promise<void> {
  let current = ''
  try {
    current = await fs.readFile(envPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${envValue(value)}`
    const matcher = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm')
    current = matcher.test(current) ? current.replace(matcher, line) : `${current}${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`
  }
  const tempPath = `${envPath}.${process.pid}.tmp`
  await fs.writeFile(tempPath, current, { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tempPath, envPath)
}

async function main(): Promise<void> {
  // The official CLI login: a random client poll token authorizes both the
  // init call and every poll; the browser never calls back to localhost.
  const pollToken = crypto.randomBytes(32).toString('hex')
  const flow = await startFlow(pollToken)

  // The desktop client appends this zcode.z.ai interstitial (param name
  // `redirect` for bigmodel) so the authorization completes server-side.
  const interstitial = new URL('/app/oauth/login', origin)
  interstitial.searchParams.set('redirect', 'zcode://oauth/callback')
  interstitial.searchParams.set('app_version', appVersion)
  const authorizeUrl = new URL(flow.authorize_url)
  authorizeUrl.searchParams.set('redirect', interstitial.toString())

  console.log('Open this ZCode login URL in your browser, then sign in with your BigModel account:')
  console.log(authorizeUrl.toString())
  console.log('\nWaiting for the authorization to complete…')

  const planToken = await waitForPlanToken(flow, pollToken)

  const existingMid = process.env.ZCODE_DEVICE_MID?.trim()
  await updateEnv({
    ZCODE_PLAN_JWT: planToken,
    ...(existingMid ? {} : { ZCODE_DEVICE_MID: crypto.randomUUID() }),
  })
  const written = existingMid ? 'ZCODE_PLAN_JWT' : 'ZCODE_PLAN_JWT, ZCODE_DEVICE_MID'
  console.log(`ZCode credentials were saved to server/.env (${written}). Restart pnpm dev to use them.`)
}

main().catch((error: unknown) => {
  // Never print tokens or raw upstream bodies.
  console.error(error instanceof Error ? error.message : 'ZCode login failed')
  process.exitCode = 1
})
