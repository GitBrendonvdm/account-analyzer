# Deployment

Coolify watches `main` and deploys itself. There is no CI step in this repo — pushing is deploying.

- App: https://accountAnalyzer.upshft.app
- Coolify: https://coolify.upshft.app → project `upshft` → environment `production`
- Build: Dockerfile, exposes port **8080** (one Node process serving the app and `/api`).
  Health check: `GET /api/health` on port 8080 — returns `{ ok, db, backend }`, 503 if the database
  query fails.
- Database: the `analyzer` Postgres 16 service in the same project. The app needs
  `DATABASE_URL=postgres://analyzer:…@<internal host>:5432/analyzer` in its environment; without it
  the container falls back to PGlite inside the container and **data does not survive a redeploy**
  (the health check says `backend: "pglite"` when that has happened).
- First visit after a fresh database asks for a passphrase. To reset a lost one, add
  `RESET_PASSPHRASE=1` to the environment, redeploy once, then remove it.

## How the trigger is wired

In the Coolify application, under **Settings**:

1. **Automatic Deployment** — on.
2. **Webhooks** → copy the *GitHub* webhook URL Coolify shows, and its secret.
3. In the GitHub repo → Settings → Webhooks → Add webhook:
   - Payload URL: the URL from step 2
   - Content type: `application/json`
   - Secret: the secret from step 2
   - Events: *Just the push event*

GitHub then calls Coolify directly on every push to `main`.

## Why not GitHub Actions

There was a workflow here that called Coolify's deploy API on push. It was removed because it
added a second place for the deploy to break without adding anything — and it did break, returning
500 on one run and timing out on the next while Coolify itself was healthy and serving. A webhook
straight from GitHub to Coolify has no third party in the middle and no token stored in repo
secrets to rotate.

## Manual redeploy

From the Coolify UI: open the application and press **Redeploy**. That is the only path that needs
no credentials stored anywhere.
