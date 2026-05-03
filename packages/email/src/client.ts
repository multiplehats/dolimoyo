import { Autosend } from 'autosendjs'

export interface EmailClientOptions {
  apiKey: string
  fromEmail: string
  fromName?: string
}

export interface SendResult { id: string | null }

export function createEmailClient(options: EmailClientOptions) {
  if (!options.apiKey?.trim()) throw new Error('AutoSend api key is required')
  if (!options.fromEmail?.trim()) throw new Error('AutoSend fromEmail is required')

  const autosend = new Autosend(options.apiKey)

  return {
    async send(args: { to: string; subject: string; html: string; text: string }): Promise<SendResult> {
      const response = await autosend.emails.send({
        from: { email: options.fromEmail, name: options.fromName },
        to: { email: args.to },
        subject: args.subject,
        html: args.html,
        text: args.text,
      })
      const id = (response as { id?: string } | undefined)?.id ?? null
      return { id }
    },
  }
}
