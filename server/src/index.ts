import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import dotenv from 'dotenv'
import Fastify from 'fastify'
import { OpenCodeProvider } from './providers/opencode.js'
import { TraeWorkProvider } from './providers/trae-work.js'
import { WorkBuddyResourceProvider } from './providers/workbuddy-resource.js'
import { errorUsage, now, type Usage, type UsageProvider } from './usage.js'

const here = path.dirname(fileURLToPath(import.meta.url))
// Works in both `tsx src/index.ts` and the compiled `dist/index.js`.
// Missing credentials leave the affected provider in an error state instead of
// preventing the dashboard server from starting.
dotenv.config({ path: path.resolve(here, '../.env') })

const app = Fastify({ logger: true })
await app.register(cors, { origin: ['http://localhost:5173'] })

const providers: UsageProvider[] = [new OpenCodeProvider(), new WorkBuddyResourceProvider(), new TraeWorkProvider()]
let usageCache: Usage[] = []
let lastRefreshAt: string | null = null
let refreshInFlight: Promise<void> | null = null
let lastManualRefreshMs = 0

function providerName(provider: UsageProvider): string {
  if (provider instanceof OpenCodeProvider) return 'opencode'
  if (provider instanceof WorkBuddyResourceProvider) return 'workbuddy'
  return 'trae-work'
}

async function refreshUsage(): Promise<void> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    const results = await Promise.all(providers.map(async (provider) => {
      const name = providerName(provider)
      try {
        const fresh = await provider.getUsage()
        return fresh
      } catch (error) {
        app.log.warn({ provider: name, err: error }, 'Provider refresh failed')
        const previous = usageCache.find((usage) => usage.provider === name)
        // Keep the last successful numbers and timestamp when a later fetch fails.
        return previous
          ? { ...previous, status: 'error' as const, error: error instanceof Error ? error.message : 'Provider refresh failed' }
          : errorUsage(name, error)
      }
    }))
    usageCache = results
    lastRefreshAt = now()
  })().finally(() => { refreshInFlight = null })
  return refreshInFlight
}

app.addHook('onRequest', async (request, reply) => {
  const dashboardToken = process.env.DASHBOARD_TOKEN
  if (!dashboardToken || request.url === '/api/health') return
  if (request.headers.authorization !== `Bearer ${dashboardToken}`) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }
})

app.get('/api/health', async () => ({ status: 'ok' }))
app.get('/api/usage', async () => ({ updatedAt: lastRefreshAt, providers: usageCache }))
app.post('/api/usage/refresh', async (_request, reply) => {
  const currentMs = Date.now()
  if (currentMs - lastManualRefreshMs < 30_000) {
    return reply.code(429).send({ error: 'Please wait 30 seconds before refreshing again' })
  }
  lastManualRefreshMs = currentMs
  await refreshUsage()
  return { updatedAt: lastRefreshAt, providers: usageCache }
})

const port = Number.parseInt(process.env.PORT ?? '3000', 10)
const interval = Number.parseInt(process.env.REFRESH_INTERVAL ?? '300000', 10)
await app.listen({ port: Number.isFinite(port) ? port : 3000, host: '0.0.0.0' })
void refreshUsage()
setInterval(() => { void refreshUsage() }, Number.isFinite(interval) && interval > 0 ? interval : 300_000).unref()
