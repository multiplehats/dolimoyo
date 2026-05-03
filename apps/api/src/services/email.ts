import { createEmailClient } from '@uitagenda/email'
import type { Env } from '../env'

export function createEmailForEnv(env: Env) {
  return createEmailClient({
    apiKey: env.AUTOSEND_API_KEY,
    fromEmail: env.AUTOSEND_DEFAULT_FROM_EMAIL,
    fromName: env.AUTOSEND_DEFAULT_FROM_NAME,
    replyTo: env.AUTOSEND_REPLY_TO,
  })
}
