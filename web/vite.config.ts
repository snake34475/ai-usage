import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = path.dirname(fileURLToPath(import.meta.url))

// In local dev the Vite server plays the role of the production reverse proxy:
// it forwards /api to the Fastify server and injects the bearer token that the
// browser must never see. The value is read server-side from server/.env only.
function dashboardToken(): string {
  try {
    const content = fs.readFileSync(path.resolve(here, '../server/.env'), 'utf8')
    const line = content.split(/\r?\n/).find((candidate) => candidate.startsWith('DASHBOARD_TOKEN='))
    return line ? line.slice('DASHBOARD_TOKEN='.length).trim() : ''
  } catch {
    return ''
  }
}

const token = dashboardToken()

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      },
    },
  },
})
