# AI Usage Dashboard

A deliberately small personal dashboard for OpenCode Go, WorkBuddy, TRAE Work, and ZCode (GLM) usage. Third-party credentials are read only by the Fastify server; the React app only calls `/api/usage`.

## Run locally

1. Copy `server/.env.example` to `server/.env` and enter the credentials that are available to you.
2. Install dependencies with `pnpm install`.
3. Run `pnpm dev`.

Open the dashboard at http://localhost:5173. The API listens at http://localhost:3000.

Set a long, random `DASHBOARD_TOKEN` in `server/.env`. Every API route except
`/api/health` requires `Authorization: Bearer <DASHBOARD_TOKEN>`. The browser
must not contain that value: for the web dashboard, use a protected reverse
proxy that authenticates the browser and injects the header when forwarding to
the local Node server. Private widgets can send the header directly.

## Providers

- OpenCode Go: `GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <API key>`. It returns and the dashboard displays all three actual quota windows: rolling 5 hours, weekly, and monthly. It does not expose a natural-day window.
- WorkBuddy AI quota: on the same computer as a signed-in WorkBuddy desktop client, the Server reads its current local login state and synchronizes `WORKBUDDY_ACCESS_TOKEN` and `WORKBUDDY_DOMAIN` to `server/.env`. On a cloud server, it instead uses those synced env values. It aggregates active resource packages into Used, Total, and Remaining values. This is a non-public endpoint and may change.
- TRAE Work: `POST https://api.trae.cn/trae/api/v2/pay/ide_user_ent_usage` with `Cloud-IDE-JWT` access-token and device-ID headers. When `TRAE_WORK_TOKEN_EXPIRES_AT` is within five minutes, the Server exchanges `TRAE_WORK_REFRESH_TOKEN` for a new access token and atomically updates `server/.env`. A 401 response also triggers one refresh-and-retry. If refreshing fails, only the TRAE card becomes stale/error. This is an undocumented client endpoint and may change.
- ZCode (GLM): `GET https://zcode.z.ai/api/v1/zcode-plan/billing/balance` with the start-plan JWT. It returns per-model credit buckets, shown as one progress bar per model plus the earliest bucket expiry. The endpoint is undocumented, requires a stable device-ID header, and may change.

### TRAE credential setup (experimental)

Run `pnpm trae:login` in an interactive terminal. It prints a personal login URL, accepts the resulting local callback URL with hidden terminal input, and stores the exchanged access token, rotated refresh token, device ID, and expiry in `server/.env`. It does not print or transmit these credentials beyond TRAE's own token-exchange endpoint. Restart `pnpm dev` afterwards. This setup is based on an undocumented TRAE SOLO client flow; it may not work with every TraeWork account or future client version.

### ZCode (GLM) credential setup (experimental)

Run `pnpm zcode:login` in an interactive terminal. It starts the official ZCode CLI OAuth flow: it prints a `zcode.z.ai` authorize URL, you sign in with your BigModel account in the browser, and the script polls until the server reports the flow ready. It then stores the start-plan plan token (`ZCODE_PLAN_JWT`) and a generated stable device ID (`ZCODE_DEVICE_MID`) in `server/.env` without printing them. Restart `pnpm dev` afterwards. If the ZCode card later shows a rejected token (HTTP 401/403), run `pnpm zcode:login` again. This setup relies on an undocumented ZCode client flow; it may not work with every account or future client version.

## Credential update behavior

### WorkBuddy

On your local computer, start the dashboard while the WorkBuddy desktop client is signed in. At the next WorkBuddy refresh, the Server reads the client login state and fills or updates these fields in `server/.env`:

```ini
WORKBUDDY_ACCESS_TOKEN=
WORKBUDDY_DOMAIN=
```

The Server never logs their values and does not write the desktop refresh token. A cloud Server has no local WorkBuddy client, so copy these two current values to the cloud server's protected `server/.env` by a secure admin channel. WorkBuddy token refresh is not implemented because its refresh protocol has not been verified; when it expires, refresh the local desktop login and synchronize the two fields again.

### TRAE Work

`pnpm trae:login` initially writes the following server-only values:

```ini
TRAE_WORK_ACCESS_TOKEN=
TRAE_WORK_REFRESH_TOKEN=
TRAE_WORK_DEVICE_ID=
TRAE_WORK_TOKEN_EXPIRES_AT=
```

Five minutes before the saved expiry, the Server exchanges the refresh token for a new access token and atomically updates `server/.env`. A `401` from the usage request also causes one refresh-and-retry. If either the refresh or retry fails, the TRAE card shows an error while retaining the last successful figures. The process must therefore be allowed to write its persistent `.env` file; do not place it in an immutable image or ephemeral filesystem.

### ZCode (GLM)

`pnpm zcode:login` writes the following server-only values:

```ini
ZCODE_PLAN_JWT=
ZCODE_DEVICE_MID=
```

The plan token carries no expiry claim, so the Server does not refresh it; on the first use it only fills in `ZCODE_DEVICE_MID` if missing. When the billing endpoint starts rejecting the token (HTTP 401/403), the ZCode card shows an error while other cards keep working, and rerunning `pnpm zcode:login` restores it. The first refresh also persists the generated device ID into `server/.env`, so the same write-permission requirement as TRAE applies.

The server uses a 10-second upstream timeout, refreshes the in-memory cache every five minutes, and retains the last successful provider values if a subsequent refresh fails. Manual refreshes are limited to one per 30 seconds.

## Security

Do not create any `VITE_OPENCODE_GO_API_KEY`, `VITE_WORKBUDDY_ACCESS_TOKEN`, `VITE_TRAE_WORK_ACCESS_TOKEN`, or `VITE_DASHBOARD_TOKEN` variables. For a public deployment, protect the dashboard at the reverse-proxy or access-gateway layer (for example Nginx/Caddy auth, Cloudflare Access, or Tailscale). Do not put `DASHBOARD_TOKEN` into the React app: the browser would expose it. Configure the reverse proxy to inject `Authorization: Bearer <DASHBOARD_TOKEN>` only on the localhost upstream connection.

## Deploy to a server

For a cloud-agent-ready deployment checklist, see [DEPLOYMENT_AGENT.md](DEPLOYMENT_AGENT.md). If the cloud agent receives only this GitHub repository, it must run `pnpm install --frozen-lockfile` and `pnpm build` on the server because Git does not contain generated `dist` artifacts. If you separately upload local artifacts over SSH/SCP, it can instead use the artifact-only mode.

The Web and Server should use one HTTPS origin:

```text
browser → HTTPS reverse proxy → web/dist
                             └→ /api → Node Server on 127.0.0.1:3000
```

1. Install Node.js 22+ and pnpm on the server.
2. Copy the project without `node_modules`; create a protected, persistent `server/.env` containing the required provider values.
3. Run `pnpm install --frozen-lockfile` and `pnpm build`.
4. Run `pnpm start` under a service manager such as systemd or PM2, with the process working directory set to `server` or through the provided root script.
5. Serve `web/dist` with Nginx or Caddy, and reverse-proxy `/api` to `http://127.0.0.1:3000`.
6. Enable HTTPS and gateway authentication. Do not expose port 3000 directly to the internet.
7. Ensure `server/.env` survives restarts and is writable by the Node service so TRAE token rotation is retained.

Provision credentials on the server itself: run `pnpm trae:login` / `pnpm zcode:login` there (both are headless-friendly — open the printed URL in a browser on your own machine), or copy values over SSH once. Do not copy the TRAE refresh-token lines between machines: each refresh rotates the token, so two live instances sharing one copy invalidate each other. Never sync `server/.env` to a cloud drive or WebDAV in plaintext; if you want an offsite backup, upload client-side ciphertext only (for example `age` or `restic`). See [DEPLOYMENT_AGENT.md](DEPLOYMENT_AGENT.md) for the full checklist, systemd and Caddy examples.

Before publishing, test `GET /api/health` through the proxy and check each provider card separately. A credential failure should affect only its own card.

## TODO (not part of MVP)

- iOS / Android widgets
- More providers, history, charts, database, Redis
- Multi-account support, user accounts, Docker, CI/CD
