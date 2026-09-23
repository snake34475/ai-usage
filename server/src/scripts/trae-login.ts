import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(here, '../../.env')
dotenv.config({ path: envPath })

const clientId = 'en1oxy7wnw8j9n'
const appVersion = '0.1.43'

type TokenResponse = {
  Result?: {
    Token?: unknown
    RefreshToken?: unknown
    TokenExpireAt?: unknown
    TokenExpireDuration?: unknown
  }
}

function randomId(): string {
  return crypto.randomBytes(16).toString('hex')
}

function loginUrl(machineId: string, deviceId: string): string {
  const params = new URLSearchParams({
    login_version: '1',
    auth_from: 'solo',
    login_channel: 'native_ide',
    plugin_version: '2.3.62834',
    auth_type: 'local',
    client_id: clientId,
    redirect: '0',
    login_trace_id: crypto.randomBytes(8).toString('hex'),
    auth_callback_url: 'http://127.0.0.1:18080/authorize',
    machine_id: machineId,
    device_id: deviceId,
    x_device_id: deviceId,
    x_machine_id: machineId,
    x_device_brand: 'PC',
    x_device_type: 'PC',
    x_os_version: '1.0',
    x_app_version: appVersion,
    x_app_type: 'stable',
  })
  return `https://www.trae.cn/authorization?${params}`
}

function parseCallback(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('The callback must be a complete URL')
  }
  const refreshToken = url.searchParams.get('refreshToken')
  if (!refreshToken) throw new Error('The callback did not contain a refreshToken')
  return refreshToken
}

async function exchangeToken(refreshToken: string): Promise<{ accessToken: string, refreshToken: string, expiresAt: number | null }> {
  const response = await fetch('https://api.trae.com.cn/cloudide/api/v3/trae/oauth/ExchangeToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': `Trae/${appVersion}` },
    body: JSON.stringify({ ClientID: clientId, RefreshToken: refreshToken, ClientSecret: '-', UserID: '' }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Token exchange failed (HTTP ${response.status})`)
  const body = (await response.json()) as TokenResponse
  const accessToken = typeof body.Result?.Token === 'string' ? body.Result.Token : ''
  if (!accessToken) throw new Error('Token exchange returned no access token')
  const rotatedRefreshToken = typeof body.Result?.RefreshToken === 'string' && body.Result.RefreshToken
    ? body.Result.RefreshToken
    : refreshToken
  const expiry = typeof body.Result?.TokenExpireAt === 'number' ? body.Result.TokenExpireAt : 0
  const duration = typeof body.Result?.TokenExpireDuration === 'number' ? body.Result.TokenExpireDuration : 0
  const expiresAt = expiry > 0
    ? (expiry > 1_000_000_000_000 ? Math.floor(expiry / 1000) : expiry)
    : (duration > 0 ? Math.floor(Date.now() / 1000) + duration : null)
  return { accessToken, refreshToken: rotatedRefreshToken, expiresAt }
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
    const matcher = new RegExp(`^${key}=.*$`, 'm')
    current = matcher.test(current) ? current.replace(matcher, line) : `${current}${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`
  }
  await fs.writeFile(envPath, current, { encoding: 'utf8', mode: 0o600 })
}

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Run this command in an interactive terminal')
  process.stdout.write(prompt)
  return new Promise((resolve, reject) => {
    let value = ''
    const input = process.stdin
    input.setEncoding('utf8')
    input.setRawMode(true)
    input.resume()
    const cleanup = () => {
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
    }
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup()
          process.stdout.write('\n')
          reject(new Error('Cancelled'))
          return
        }
        if (character === '\r' || character === '\n') {
          cleanup()
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (character === '\u007f' || character === '\b') {
          if (value) {
            value = value.slice(0, -1)
            process.stdout.write('\b \b')
          }
          continue
        }
        value += character
        process.stdout.write('*')
      }
    }
    input.on('data', onData)
  })
}

async function main(): Promise<void> {
  const machineId = randomId()
  const deviceId = randomId()
  console.log('Open this TRAE login URL in your browser, then sign in:')
  console.log(loginUrl(machineId, deviceId))
  console.log('\nAfter the browser redirects to 127.0.0.1, copy the complete address-bar URL.')
  const callback = await readHidden('Paste the callback URL (input is hidden): ')
  const refreshToken = parseCallback(callback)
  const credential = await exchangeToken(refreshToken)
  await updateEnv({
    TRAE_WORK_ACCESS_TOKEN: credential.accessToken,
    TRAE_WORK_REFRESH_TOKEN: credential.refreshToken,
    TRAE_WORK_DEVICE_ID: deviceId,
    TRAE_WORK_TOKEN_EXPIRES_AT: credential.expiresAt ? String(credential.expiresAt) : '',
  })
  console.log('TRAE credentials were saved to server/.env. Restart pnpm dev to use them.')
}

main().catch((error: unknown) => {
  // Never print callback URLs, tokens, or raw upstream bodies.
  console.error(error instanceof Error ? error.message : 'TRAE login failed')
  process.exitCode = 1
})
