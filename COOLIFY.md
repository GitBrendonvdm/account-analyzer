# Coolify — accountAnalyzer.upshft.app

Deploy under Coolify project **upshft** → environment **production**.

- DNS `accountAnalyzer.upshft.app` → VPS (`102.211.205.157`)
- GitHub: `git@github.com:GitBrendonvdm/account-analyzer.git` (branch `main`)
- Build pack: Dockerfile at repo root, exposes port **80**
- Health check: `GET /` on port 80

## Redeploy

Push to `main` on GitHub, then trigger deploy in Coolify or:

```text
GET https://coolify.upshft.app/api/v1/deploy?uuid=o108dqy996z0a944ytg9q5zp
Authorization: Bearer <COOLIFY_API_TOKEN>
```
