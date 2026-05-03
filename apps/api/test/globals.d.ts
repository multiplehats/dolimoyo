/// <reference path="../node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts" />
/// <reference path="../worker-configuration.d.ts" />

// ADMIN_SECRET is set via .dev.vars (gitignored); declare it here for test type-checking.
declare namespace Cloudflare {
  interface Env {
    ADMIN_SECRET: string
    PARSEW_API_KEY: string
    OPENROUTER_API_KEY: string
    AUTOSEND_API_KEY: string
    AUTOSEND_DEFAULT_FROM_EMAIL: string
    AUTOSEND_DEFAULT_FROM_NAME: string
    AUTOSEND_REPLY_TO: string
  }
}
