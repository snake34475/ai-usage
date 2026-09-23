# AI Usage Dashboard

A deliberately small personal dashboard for OpenCode Go, WorkBuddy, and TRAE Work usage. Third-party credentials are read only by the Fastify server; the React app only calls `/api/usage`.

## Run locally

1. Copy `server/.env.example` to `server/.env` and enter the credentials that are available to you.
2. Install dependencies with `pnpm install`.
3. Run `pnpm dev`.

Open the dashboard at http://localhost:5173. The API listens at http://localhost:3000.

## Providers

- OpenCode Go: `GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <API key>`. It returns and the dashboard displays all three actual quota windows: rolling 5 hours, weekly, and monthly. It does not expose a natural-day window.
- WorkBuddy AI quota: on the same computer as a signed-in WorkBuddy desktop client, the Server reads its current local login state and synchronizes `WORKBUDDY_ACCESS_TOKEN` and `WORKBUDDY_DOMAIN` to `server/.env`. On a cloud server, it instead uses those synced env values. It aggregates active resource packages into Used, Total, and Remaining values. This is a non-public endpoint and may change.
- TRAE Work: `POST https://api.trae.cn/trae/api/v2/pay/ide_user_ent_usage` with `Cloud-IDE-JWT` access-token and device-ID headers. When `TRAE_WORK_TOKEN_EXPIRES_AT` is within five minutes, the Server exchanges `TRAE_WORK_REFRESH_TOKEN` for a new access token and atomically updates `server/.env`. A 401 response also triggers one refresh-and-retry. If refreshing fails, only the TRAE card becomes stale/error. This is an undocumented client endpoint and may change.

### TRAE credential setup (experimental)

Run `pnpm trae:login` in an interactive terminal. It prints a personal login URL, accepts the resulting local callback URL with hidden terminal input, and stores the exchanged access token, rotated refresh token, device ID, and expiry in `server/.env`. It does not print or transmit these credentials beyond TRAE's own token-exchange endpoint. Restart `pnpm dev` afterwards. This setup is based on an undocumented TRAE SOLO client flow; it may not work with every TraeWork account or future client version.

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

The server uses a 10-second upstream timeout, refreshes the in-memory cache every five minutes, and retains the last successful provider values if a subsequent refresh fails. Manual refreshes are limited to one per 30 seconds.

## Security

Do not create any `VITE_OPENCODE_GO_API_KEY`, `VITE_WORKBUDDY_ACCESS_TOKEN`, or `VITE_TRAE_WORK_ACCESS_TOKEN` variables. For a public deployment, protect the dashboard at the reverse-proxy or access-gateway layer (for example Nginx/Caddy auth, Cloudflare Access, or Tailscale). Do not put `DASHBOARD_TOKEN` into the React app: the browser would expose it.

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

Before publishing, test `GET /api/health` through the proxy and check each provider card separately. A credential failure should affect only its own card.

## TODO (not part of MVP)

- iOS / Android widgets
- More providers, history, charts, database, Redis
- Multi-account support, user accounts, Docker, CI/CD
