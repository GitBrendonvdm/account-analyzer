import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Dev-only: serve the newest CSV in the gitignored `test-data/` directory at `/__fixture.csv`.
 *
 * Real bank exports are never committed, so this is the only way to load production-shaped data
 * into the dev server for verification. It is a dev middleware — it does not exist in a build.
 */
function fixtureServer() {
  return {
    name: 'money-visualizer-fixture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fixture.csv', (_req, res) => {
        const dir = join(process.cwd(), 'test-data')
        const file = existsSync(dir)
          ? readdirSync(dir).filter((f) => f.endsWith('.csv')).sort().at(-1)
          : null
        if (!file) {
          res.statusCode = 404
          res.end('no fixture in test-data/')
          return
        }
        res.setHeader('Content-Type', 'text/csv')
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
