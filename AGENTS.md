# AI Usage Dashboard — contributor guide

## Scope

This is a small personal dashboard. Keep the architecture to Fastify Server + React/Vite Web. Do not introduce a database, Redis, Docker, accounts, OAuth UI, multi-tenancy, GraphQL, or proxy/chat-completion features unless explicitly requested.

## Security rules

- Real credentials belong only in `server/.env`; it is ignored by Git.
- Never add `VITE_*` secrets, browser storage for credentials, or secret values to logs, errors, tests, README examples, or commits.
- Provider failures must stay independent. Preserve the last successful cache values and set that provider's status to `error`.
- All upstream requests need a timeout. Do not print upstream response bodies when they could contain credentials.

## Provider conventions

- Providers live in `server/src/providers/` and return the shared `Usage` model from `server/src/usage.ts`.
- `OpenCodeProvider` is API-key based.
- `WorkBuddyResourceProvider` uses the desktop-login state locally, synchronizing only access token and domain into `server/.env`; in cloud environments it uses those env values. Do not assume or implement a WorkBuddy refresh endpoint without verifying it.
- `TraeWorkProvider` uses the undocumented TRAE SOLO client flow. It may refresh an access token from `TRAE_WORK_REFRESH_TOKEN`, and therefore the process must have permission to atomically update `server/.env`. Do not add chat proxying, sign-in, or multi-account behavior from external reference projects.

## Validation

After source changes, run:

```powershell
pnpm check
pnpm build
```

For a local UI run, use `pnpm dev`. The Server is port 3000 and Vite is port 5173.

## Deployment expectations

- Serve `web/dist` and reverse-proxy `/api` to the Node process over localhost.
- Use HTTPS and gateway authentication (for example, Caddy/Nginx auth, Cloudflare Access, or Tailscale) for public deployments. Do not ship `DASHBOARD_TOKEN` to React.
- Persist and protect `server/.env` (`0600` where supported). TRAE refresh will otherwise be unable to retain its rotated token.
