// OpenRouter model slugs (verified via openrouter.ai/api/v1/models 2026-05-03).
// gpt-5-nano: $0.05/M input, $0.40/M output — used for cheap structured-output
// tasks (scoring URLs, tagging perennials, parsing localized dates).
// claude-sonnet-4.6: $3/M input, $15/M output — reserved for the harder CSS
// scraper-generation task that benefits from stronger reasoning.
export const MODELS = {
  scoring: 'openai/gpt-5-nano',
  scraperGen: 'anthropic/claude-sonnet-4.6',
  scraperRegen: 'anthropic/claude-sonnet-4.6',
  tagging: 'openai/gpt-5-nano',
  dateRescue: 'openai/gpt-5-nano',
  // Per-digest curation: pick + order + write intro/blurbs/closer for one
  // recipient. mini > nano here — nano was crossing blurbs with the wrong
  // eventId (observed: blurb said "Bas Kosters" while title was a flea
  // market). Still well under $0.001 per digest with our typical input size.
  digestCuration: 'openai/gpt-5-mini',
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
  dateRescue: 2048,
  // Headroom for intro + ~12 picks each with a blurb + closer.
  digestCuration: 3072,
}
