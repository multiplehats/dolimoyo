import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { SourceActor } from '../src/actors/source-actor'
import type { SubscriptionActor } from '../src/actors/subscription-actor'

describe('SourceActor', () => {
  it('bootstrap is idempotent — second call does not change phase', async () => {
    const id = env.SOURCE_ACTOR.idFromName('test-source-1')
    const stub = env.SOURCE_ACTOR.get(id)

    await stub.bootstrap('source-uuid-1')
    await runInDurableObject<SourceActor, void>(stub, async (_instance, ctx) => {
      const phaseAfterFirst = await ctx.storage.get<string>('phase')
      expect(phaseAfterFirst).toBe('generate')
      const sourceIdAfterFirst = await ctx.storage.get<string>('sourceId')
      expect(sourceIdAfterFirst).toBe('source-uuid-1')
    })

    await stub.bootstrap('source-uuid-1') // second call
    await runInDurableObject<SourceActor, void>(stub, async (_instance, ctx) => {
      const phase = await ctx.storage.get<string>('phase')
      const sourceId = await ctx.storage.get<string>('sourceId')
      // phase still 'generate' or whatever it was — not reset by second bootstrap
      expect(['generate', 'refresh', 'regen']).toContain(phase)
      expect(sourceId).toBe('source-uuid-1')
    })
  })

  it('bootstrap rejects rebinding to a different sourceId', async () => {
    const id = env.SOURCE_ACTOR.idFromName('test-source-2')
    const stub = env.SOURCE_ACTOR.get(id)
    await stub.bootstrap('source-uuid-A')
    // Wrap in try/catch rather than .rejects.toThrow() to prevent the DO runtime
    // from also propagating the rejection as an uncaught error (miniflare behaviour).
    let caught: unknown
    try {
      await stub.bootstrap('source-uuid-B')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toMatch(/refusing rebind/)
  })

  it('bootstrap schedules an alarm', async () => {
    const id = env.SOURCE_ACTOR.idFromName('test-source-3')
    const stub = env.SOURCE_ACTOR.get(id)
    await stub.bootstrap('source-uuid-3')
    await runInDurableObject<SourceActor, void>(stub, async (_instance, ctx) => {
      const alarm = await ctx.storage.getAlarm()
      expect(alarm).not.toBeNull()
      expect(alarm).toBeLessThan(Date.now() + 5000)
    })
  })
})

describe('SubscriptionActor', () => {
  it('bootstrap is idempotent and schedules an alarm', async () => {
    const id = env.SUBSCRIPTION_ACTOR.idFromName('test-sub-1')
    const stub = env.SUBSCRIPTION_ACTOR.get(id)
    await stub.bootstrap('sub-uuid-1')
    await runInDurableObject<SubscriptionActor, void>(stub, async (_instance, ctx) => {
      expect(await ctx.storage.get<string>('subscriptionId')).toBe('sub-uuid-1')
      expect(await ctx.storage.get<string>('phase')).toBe('discover')
      const alarm = await ctx.storage.getAlarm()
      expect(alarm).not.toBeNull()
    })

    await stub.bootstrap('sub-uuid-1')
    await runInDurableObject<SubscriptionActor, void>(stub, async (_instance, ctx) => {
      expect(await ctx.storage.get<string>('subscriptionId')).toBe('sub-uuid-1')
    })
  })
})
