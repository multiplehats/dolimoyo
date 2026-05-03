// OpenRouter model IDs use dots, not dashes (verified 2026-05-03 via openrouter.ai docs).
// Example: anthropic/claude-haiku-4.5, NOT anthropic/claude-haiku-4-5.
export const MODELS = {
  scoring: 'anthropic/claude-haiku-4.5',
  scraperGen: 'anthropic/claude-sonnet-4.6',
  scraperRegen: 'anthropic/claude-sonnet-4.6',
  tagging: 'anthropic/claude-haiku-4.5',
} as const

export type Task = keyof typeof MODELS

// Hard ceiling on output tokens per task. Caps runaway generations and
// caps cost-per-call regardless of provider behavior. Override per-call
// via the `maxOutputTokens` arg if a specific call needs more headroom.
export const MAX_OUTPUT_TOKENS: Record<Task, number> = {
  scoring: 1024,
  scraperGen: 4096,
  scraperRegen: 4096,
  tagging: 2048,
}
