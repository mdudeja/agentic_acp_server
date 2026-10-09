import type { Annotations, ContentBlock } from '@agentclientprotocol/sdk'
import type { EditorContext } from 'src/openrpc/schemas'
import { uriToEmbeddedResource } from 'src/utils/helpers'

/**
 * Converts a user prompt and a single EditorContext into an array of ACP
 * ContentBlocks ready to be sent to the agent.
 *
 * **Block layout**
 * 1. The prompt is always the first `"text"` block.
 * 2. A single context block follows, chosen by `context.type`:
 *
 * | context.type | data present | uri present | result block |
 * |---|---|---|---|
 * | selection / file / workspace / keymaps / diagnostics | — | — | `"text"` with `[Label]` prefix |
 * | image | ✓ | — | `"image"` (inline base64) |
 * | image | ✗ | ✓ | `"resource"` (`EmbeddedResource` read from disk) |
 * | audio | ✓ | — | `"audio"` (inline base64) |
 * | audio | ✗ | ✓ | `"resource"` read from disk |
 * | link | — | ✓ | `"resource_link"` |
 * | any binary type | ✗ | ✓ | `"resource"` read from disk |
 */
export async function createContentBlocks(
  context: EditorContext,
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = []

  const annotations: Annotations | undefined = context.annotations
    ? {
        audience: context.annotations.audience as
          | ('user' | 'assistant')[]
          | undefined,
        priority: context.annotations.priority ?? undefined,
      }
    : undefined

  switch (context.type) {
    case 'text':
    case 'selection':
    case 'file':
    case 'workspace':
    case 'keymaps':
    case 'diagnostics': {
      const label = context.type.charAt(0).toUpperCase() + context.type.slice(1)
      blocks.push({
        type: 'text',
        text: `[${label}]\n${context.text}`,
        ...(annotations ? { annotations } : {}),
      })
      break
    }

    case 'image': {
      const { data, mimetype, uri } = context.metadata ?? {}
      if (data) {
        blocks.push({
          type: 'image',
          data,
          mimeType: mimetype ?? 'image/png',
          uri: uri ?? undefined,
          ...(annotations ? { annotations } : {}),
        })
      } else if (uri) {
        blocks.push(await uriToEmbeddedResource(uri, mimetype, annotations))
      } else {
        // No data and no URI — degrade to plain text.
        blocks.push({ type: 'text', text: context.text })
      }
      break
    }

    case 'audio': {
      const { data, mimetype, uri } = context.metadata ?? {}
      if (data) {
        blocks.push({
          type: 'audio',
          data,
          mimeType: mimetype ?? 'audio/wav',
          ...(annotations ? { annotations } : {}),
        })
      } else if (uri) {
        blocks.push(await uriToEmbeddedResource(uri, mimetype, annotations))
      } else {
        blocks.push({ type: 'text', text: context.text })
      }
      break
    }

    case 'link': {
      const { uri, name, title, description, mimetype, size } =
        context.metadata ?? {}
      if (!uri) {
        blocks.push({ type: 'text', text: context.text })
        break
      }

      if (uri.startsWith('file://') || uri.startsWith('/')) {
        blocks.push(await uriToEmbeddedResource(uri, mimetype, annotations))
      } else {
        blocks.push({
          type: 'resource_link',
          uri,
          name: name ?? uri,
          title: title ?? undefined,
          description: description ?? undefined,
          mimeType: mimetype ?? undefined,
          size: size ?? undefined,
          ...(annotations ? { annotations } : {}),
        })
      }
      break
    }
  }

  return blocks
}
