import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        // Pipeline unit tests — pure Node, no Cloudflare bindings needed
        test: {
          name: 'pipeline',
          include: ['test/discover.test.ts', 'test/generate-scraper.test.ts'],
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
        test: {
          name: 'worker',
          include: ['test/**/*.test.ts'],
          exclude: ['test/discover.test.ts', 'test/generate-scraper.test.ts'],
        },
      },
    ],
  },
})
