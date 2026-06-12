# Coolify — accountAnalyzer.upshft.app

Deploy under Coolify project **upshft** → environment **production**.

- DNS `accountAnalyzer.upshft.app` → VPS (`102.211.205.157`)
- GitHub: `git@github.com:GitBrendonvdm/account-analyzer.git` (branch `main`)
- Build pack: Dockerfile at repo root, exposes port **80**
- Health check: `GET /` on port 80

## Auto deploy

Pushes to `main` trigger a GitHub Actions workflow (`.github/workflows/deploy.yml`) that calls the Coolify deploy API.

Repo secrets: `COOLIFY_URL`, `COOLIFY_APP_UUID`, `COOLIFY_TOKEN`.

## Manual redeploy

```text
GET https://coolify.upshft.app/api/v1/deploy?uuid=o108dqy996z0a944ytg9q5zp
Authorization: Bearer <COOLIFY_API_TOKEN>
```
