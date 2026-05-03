// OpenRouter model IDs use dots, not dashes (verified 2026-05-03 via openrouter.ai docs).
// Example: anthropic/claude-haiku-4.5, NOT anthropic/claude-haiku-4-5.
export const MODELS = {
  scoring: 'anthropic/claude-haiku-4.5',
  scraperGen: 'anthropic/claude-sonnet-4.6',
  scraperRegen: 'anthropic/claude-sonnet-4.6',
  tagging: 'anthropic/claude-haiku-4.5',
} as const

export type Task = keyof typeof MODELS
