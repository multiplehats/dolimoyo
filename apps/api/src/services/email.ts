import { createEmailClient } from '@uitagenda/email'
import type { Env } from '../env'

export function createEmailForEnv(env: Env) {
  return createEmailClient({
    apiKey: env.AUTOSEND_API_KEY,
    fromEmail: env.FROM_EMAIL,
    fromName: env.FROM_NAME,
  })
}
