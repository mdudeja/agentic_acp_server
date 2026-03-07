/**
 * Utility function to wrap any async function in a try-catch block.
 * Logs any errors that occur and rethrows them.
 */

import type { ICommsInterface } from 'src/comms/ICommsInterface'
import { logError, logTraffic } from './logger'
import type {
  Annotations,
  EmbeddedResource,
  Stream,
} from '@agentclientprotocol/sdk'
import { extname } from 'node:path'
import { readFile } from 'node:fs/promises'

export function generateCatchblock(
  commsInterface: ICommsInterface | null,
  error: unknown,
  failureMessage: string | null,
) {
  const errObj = error as Error
  const failMessage =
    failureMessage ??
    `Error thrown in ${generateCatchblock.caller?.name || 'unknown function'}`
  logError(failMessage, errObj)
  commsInterface?.notify({
    method: 'agentic/log',
    data: {
      level: 'error',
      message: `${failMessage}: ${errObj.message || String(errObj)}`,
    },
  })
}

export function tapStream(stream: Stream): Stream {
  const sendTap = new TransformStream({
    transform(chunk: unknown, controller: TransformStreamDefaultController) {
      logTraffic('send', '', chunk)
      controller.enqueue(chunk)
    },
  })

  const receiveTap = new TransformStream({
    transform(chunk: unknown, controller: TransformStreamDefaultController) {
      logTraffic('receive', '', chunk)
      controller.enqueue(chunk)
    },
  })

  sendTap.readable.pipeTo(stream.writable).catch((err) => {
    logError('Error piping sendTap', err)
  })
  stream.readable.pipeTo(receiveTap.writable).catch((err) => {
    logError('Error piping receiveTap', err)
  })

  return {
    readable: receiveTap.readable,
    writable: sendTap.writable,
  }
}

const EXT_TO_MIME: Record<string, string> = {
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  // Documents / binary
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  // Plain text
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/x-typescript',
}

/** MIME types whose content is readable as UTF-8 text rather than raw bytes. */
const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml']

function mimeFromPath(filePath: string): string {
  return (
    EXT_TO_MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  )
}

function isTextMime(mime: string): boolean {
  return TEXT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
}

/**
 * Strips a leading `file://` (or `file:///`) scheme from a URI, returning a
 * plain file-system path.  Non-`file:` URIs are returned unchanged so callers
 * can detect remote URIs and handle them separately.
 */
function uriToFsPath(uri: string): string {
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri
}

/**
 * Reads the file identified by `uri` from the local file system and wraps it
 * in an ACP `EmbeddedResource` ContentBlock (`type: "resource"`).
 *
 * - Text files (MIME prefix `text/`, JSON, XML …) use `TextResourceContents`.
 * - Everything else is base64-encoded into `BlobResourceContents`.
 *
 * The `uri` field on the resource contents is kept as-is so the agent can
 * reference it back to the original source.
 */
export async function uriToEmbeddedResource(
  uri: string,
  mimeOverride?: string,
  annotations?: Annotations,
): Promise<EmbeddedResource & { type: 'resource' }> {
  const fsPath = uriToFsPath(uri)
  const mimeType = mimeOverride ?? mimeFromPath(fsPath)

  if (isTextMime(mimeType)) {
    const text = await readFile(fsPath, 'utf-8')
    return {
      type: 'resource',
      resource: { uri, mimeType, text },
      ...(annotations ? { annotations } : {}),
    }
  }

  const blob = (await readFile(fsPath)).toString('base64')
  return {
    type: 'resource',
    resource: { uri, mimeType, blob },
    ...(annotations ? { annotations } : {}),
  }
}
