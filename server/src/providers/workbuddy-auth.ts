import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { updateServerEnv } from '../env-store.js'

type LoginState = {
  auth?: { accessToken?: unknown, domain?: unknown }
}

const allowedDomains = new Set(['www.codebuddy.cn', 'www.workbuddy.cn'])

function loginStateCandidates(): string[] {
  const authSuffix = path.join('CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop.info')
  return [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, authSuffix),
    process.env.APPDATA && path.join(process.env.APPDATA, authSuffix),
    path.join(os.homedir(), '.workbuddy', 'auth', 'workbuddy-desktop.info'),
  ].filter((candidate): candidate is string => Boolean(candidate))
}

function authValues(token: unknown, domain: unknown): { token: string, domain: string } | null {
  if (typeof token === 'string' && token.length > 0 && typeof domain === 'string' && allowedDomains.has(domain)) {
    return { token, domain }
  }
  return null
}

function environmentAuth(): { token: string, domain: string } | null {
  const token = process.env.WORKBUDDY_ACCESS_TOKEN
  const domain = process.env.WORKBUDDY_DOMAIN
  return authValues(token, domain)
}

/**
 * Prefers a signed-in local desktop client and synchronizes its current token
 * to server/.env. A cloud server has no desktop client and uses the synced env.
 */
export async function readLocalWorkBuddyAuth(): Promise<{ token: string, domain: string }> {
  for (const candidate of loginStateCandidates()) {
    try {
      const contents = await fs.readFile(candidate, 'utf8')
      const state = JSON.parse(contents) as LoginState
      const token = state.auth?.accessToken
      const domain = state.auth?.domain
      const local = authValues(token, domain)
      if (local) {
        await updateServerEnv({ WORKBUDDY_ACCESS_TOKEN: local.token, WORKBUDDY_DOMAIN: local.domain })
        return local
      }
    } catch {
      // Try the next standard path. Never expose a login-state read failure.
    }
  }
  const saved = environmentAuth()
  if (saved) return saved
  throw new Error('WorkBuddy credentials are not configured. Sign in locally once to sync server/.env, or set WORKBUDDY_ACCESS_TOKEN and WORKBUDDY_DOMAIN on the server.')
}
