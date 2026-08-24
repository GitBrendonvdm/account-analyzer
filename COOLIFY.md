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

## Two things that bit the first server deploy

1. **The in-container health probe talks to `localhost`**, which alpine resolves to `::1` first. A
   server bound to `0.0.0.0` refuses it, Coolify marks the new container unhealthy and rolls back —
   with the app perfectly fine. The server binds `::` (dual-stack) for that reason, and the Coolify
   health check host is set to `127.0.0.1` as well.
2. **Changing "Ports Exposes" through the API does not regenerate the Traefik labels.** They are
   stored in `custom_labels` and kept the old `loadbalancer.server.port=80`, so the proxy returned
   502 while the container was healthy on 8080. If the port ever changes again, check the labels
   (Settings → Advanced → Container Labels in the UI) and fix the two `server.port` lines.

## Never let git remove a worktree that has junctions in it

Agent worktrees and release checks link `node_modules` and `test-data` in with
`cmd /c mklink /J`. `git worktree remove --force` follows those junctions and deletes the files
they point at — the real `node_modules` and the real, gitignored bank exports, from the main tree.
It has happened twice. Unlink first, verify the link is gone, and only then remove the worktree:

```bash
cmd //c "rmdir C:\path\to\worktree\node_modules"    # unlink, do not rm -rf
ls worktree/node_modules >/dev/null 2>&1 && echo ABORT || git worktree remove --force worktree
```

Quoting matters: a `cmd //c` whose path is wrapped in escaped quotes inside a bash string fails
silently with "The filename, directory name, or volume label syntax is incorrect", and the removal
then eats the originals. Check the exit status, not just the absence of a crash.

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
