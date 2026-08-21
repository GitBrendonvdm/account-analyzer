import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Dev-only: serve CSVs from the gitignored `test-data/` directory at `/__fixture.csv`.
 *
 * Real bank exports are never committed, so this is the only way to load production-shaped data
 * into the dev server for verification. It is a dev middleware — it does not exist in a build.
 *
 * `?index=N` picks the Nth newest export (0 = newest, the default). Successive exports overlap and
 * slide, so importing an older one on top of a newer one is the thing worth being able to test:
 * that is exactly the case that used to destroy history.
 */
function fixtureServer() {
  return {
    name: 'money-visualizer-fixture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fixture.csv', (req, res) => {
        const dir = join(process.cwd(), 'test-data')
        const files = existsSync(dir)
          ? readdirSync(dir).filter((f) => f.endsWith('.csv')).sort().reverse()
          : []
        const index = Number(new URL(req.url, 'http://x').searchParams.get('index') ?? 0)
        const file = files[Number.isFinite(index) ? index : 0]
        if (!file) {
          res.statusCode = 404
          res.end('no fixture in test-data/')
          return
        }
        res.setHeader('Content-Type', 'text/csv')
        res.setHeader('X-Fixture-Name', file)
        res.end(readFileSync(join(dir, file)))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), fixtureServer()],
  server: {
    port: 3000,
  },
})
