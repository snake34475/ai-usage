# Cloud deployment instructions for AI Usage Dashboard

You are deploying a small personal dashboard. Prefer a **local-build, cloud-run** release. Do not compile the React application on the cloud server unless the supplied artifacts are missing.

## Required release artifacts

The release source machine runs `pnpm build` first. Receive these artifacts over a secure channel:

```text
web/dist/                 Static website only
server/dist/              Compiled Node.js server only
server/package.json       Server runtime dependency manifest
server/.env               Private persistent runtime credentials (never log or commit)
```

`web/src`, `server/src`, repository `.git`, and local `node_modules` are not needed by the running server.

## Target layout

Use fixed directories, adjusting only if the existing server conventions require another safe location:

```text
/var/www/ai-usage/        contents of web/dist/
/opt/ai-usage/server/     contents of server/dist/ as ./dist/
                           package.json
                           node_modules/ (installed on cloud)
                           .env (private, persistent, writable)
```

Do not put `.env` under `/var/www`. Do not serve it through the web server.

## Before making changes

1. Inspect the current web server (Nginx or Caddy), service manager, existing virtual hosts, and occupied ports.
2. Preserve unrelated sites, certificates, firewall rules, and configuration.
3. Confirm Node.js is version 22 or later and pnpm is available.
4. Never print the content of `.env`, access tokens, refresh tokens, or full request headers.

## Server runtime setup

1. Create the directories with a dedicated non-root deployment user.
2. Upload the release artifacts securely. Set `.env` to mode `0600` and make it owned by the Node service user.
3. From `/opt/ai-usage/server`, install only runtime dependencies:

   ```bash
   pnpm install --prod
   ```

   Do not install frontend dependencies on the cloud server.

4. Run the compiled process with the working directory set to `/opt/ai-usage/server`:

   ```bash
   node dist/index.js
   ```

5. Create a systemd (or existing service-manager) unit that restarts on failure. Its `WorkingDirectory` must be `/opt/ai-usage/server` because the server persists rotated TRAE credentials into `.env`.
6. Bind the Node service only to private/local access where possible. Do not expose port 3000 directly to the public internet.

## Reverse proxy and static files

Configure the existing HTTPS virtual host so that:

```text
/       → /var/www/ai-usage/ (SPA static files)
/api/*  → http://127.0.0.1:3000/api/*
```

Include an SPA fallback to `index.html` only if the host has client-side routes in the future. Keep all existing TLS configuration intact. Add access protection at the reverse-proxy or gateway layer (for example Basic Auth, Cloudflare Access, or Tailscale); never add a secret to the Vite client bundle.

## Provider credential behavior

- OpenCode uses `OPENCODE_GO_API_KEY` from `.env`.
- WorkBuddy cloud deployments use `WORKBUDDY_ACCESS_TOKEN` and `WORKBUDDY_DOMAIN` that were synchronized from the local signed-in desktop client. The cloud host cannot refresh these itself. When they expire, securely update the two values from the local machine and restart the service.
- TRAE uses its access token, refresh token, device ID, and expiry from `.env`. The server can rotate TRAE credentials automatically, so `.env` must be persistent and writable by the service user.

## Verification and handoff

After deployment, perform only these safe checks:

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS https://YOUR_DOMAIN/api/health
```

Then open the HTTPS page and check the three provider cards. A single provider may report an error while the dashboard and other providers remain healthy. Do not use curl output that could include provider details in public logs.

Report back with the chosen directories, service name, proxy location, health-check result, and any user action required. Do not report secrets.
