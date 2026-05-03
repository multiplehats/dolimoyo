import type { ScrapedEvent } from './types'

export function looksPlausible(events: ScrapedEvent[]): boolean {
  if (events.length < 3) return false
  const withDate = events.filter((e) => e.startsAt !== null).length
  if (withDate / events.length < 0.5) return false
  const titles = new Set(events.map((e) => e.title.trim().toLowerCase()))
  if (titles.size / events.length < 0.6) return false
  return true
}
