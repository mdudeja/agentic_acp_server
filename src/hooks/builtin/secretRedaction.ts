import type { ContentBlock } from '@agentclientprotocol/sdk'
import type { BuiltinHooksConfig } from 'src/config/schemas'
import { logWarning } from 'src/utils/logger'
import { defineHook } from '../public'

/** Well-known secret formats, redacted from user prompts. */
const BUILTIN_PATTERNS: Array<[string, RegExp]> = [
  [
    'private key',
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  ],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['GitHub token', /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g],
  ['API key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
]

/**
 * Replaces secrets in user prompts (text blocks and embedded text
 * resources) with `[REDACTED <kind>]`, and tells the user it did.
 */
export function secretRedaction(
  options: BuiltinHooksConfig['secretRedaction'],
) {
  const patterns: Array<[string, RegExp]> = [
    ...BUILTIN_PATTERNS,
    ...options.patterns.flatMap((pattern): Array<[string, RegExp]> => {
      try {
        return [['secret', new RegExp(pattern, 'g')]]
      } catch (error) {
        logWarning(
          `[hooks] secretRedaction: ignoring invalid regex ${pattern}: ${error}`,
        )
        return []
      }
    }),
  ]

  const redact = (text: string): { text: string; count: number } => {
    let count = 0
    for (const [kind, regex] of patterns) {
      text = text.replace(regex, () => {
        count += 1
        return `[REDACTED ${kind}]`
      })
    }
    return { text, count }
  }

  return [
    defineHook({
      name: 'secretRedaction',
      event: 'prompt.before',
      description: 'Redacts secrets from user prompts',
      match: { origin: 'user' },
      // After context injection, so injected files are redacted too.
      priority: 60,
      handler(input, ctx) {
        let total = 0

        const prompt = input.prompt.map((block): ContentBlock => {
          if (block.type === 'text') {
            const { text, count } = redact(block.text)
            total += count
            return count ? { ...block, text } : block
          }
          if (block.type === 'resource' && 'text' in block.resource) {
            const { text, count } = redact(block.resource.text)
            total += count
            return count
              ? { ...block, resource: { ...block.resource, text } }
              : block
          }
          return block
        })

        if (total === 0) {
          return
        }

        ctx.notify(`Redacted ${total} secret(s) from the prompt`, 'warn')
        return { prompt }
      },
    }),
  ]
}
