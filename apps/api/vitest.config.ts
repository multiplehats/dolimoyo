import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        // Pipeline unit tests — pure Node, no Cloudflare bindings needed
        test: {
          name: 'pipeline',
          include: ['test/discover.test.ts', 'test/generate-scraper.test.ts', 'test/refresh.test.ts', 'test/digest.test.ts'],
          environment: 'node',
        },
      },
      {
        // Worker integration tests — Cloudflare miniflare pool
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
          }),
        ],
        resolve: {
          alias: {
            // @react-email/render uses react-dom/server.edge which is unavailable under
            // Cloudflare Workers conditions. These tests don't exercise email rendering;
            // stub out the package so the worker bundle compiles without a node-only dep.
            '@react-email/render': new URL('./test/__stubs__/react-email-render.ts', import.meta.url).pathname,
          },
        },
        test: {
          name: 'worker',
          include: ['test/**/*.test.ts'],
          exclude: ['test/discover.test.ts', 'test/generate-scraper.test.ts', 'test/refresh.test.ts', 'test/digest.test.ts'],
        },
      },
    ],
  },
})
