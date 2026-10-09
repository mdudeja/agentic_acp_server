import type {
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk'
import { isAbsolute, relative } from 'node:path'
import type { AgenticServer } from 'src/AgenticServer'
import { resolveOptionAnswer } from 'src/utils/helpers'
import { logDebug, logError } from 'src/utils/logger'
import { resolvePath } from 'src/utils/paths'

/**
 * Handler for file system operations.
 * Provides methods for reading and writing text files with support for
 * line-based partial reads and automatic directory creation.
 */
export class FileSystemHandler {
  constructor(private readonly server_instance: AgenticServer) {}

  /**
   * Reads the contents of a text file.
   * Supports reading the entire file or a specific range of lines.
   *
   * @param params - ReadTextFileRequest parameters
   * @returns A promise that resolves to ReadTextFileResponse
   * @throws {Error} If the file cannot be read
   */
  async readTextFile(
    params: ReadTextFileRequest,
  ): Promise<ReadTextFileResponse> {
    logDebug('Reading text file with params:', params)
    const { path, limit, line, sessionId } = params

    try {
      const fileContent = await Bun.file(resolvePath(path)).text()
      let result = fileContent

      // Either bound may be given on its own: `line` alone reads to the end,
      // `limit` alone reads from the first line.
      if (line != null || limit != null) {
        const lines = fileContent.split('\n')
        const start = Math.max((line ?? 1) - 1, 0) // Convert to 0-based index
        const end = start + (limit ?? lines.length)
        result = lines.slice(start, end).join('\n')
      }

      return {
        _meta: {
          sessionId,
        },
        content: result,
      }
    } catch (error) {
      logError('Error reading file:', error)
      throw new Error(`Failed to read file at path: ${path}`)
    }
  }

  /**
   * Writes content to a text file.
   * Creates the parent directory if it doesn't exist.
   *
   * @param params - WriteTextFileRequest parameters
   * @returns A promise that resolves to WriteTextFileResponse
   * @throws {Error} If the file cannot be written
   */
  async writeTextFile(
    params: WriteTextFileRequest,
  ): Promise<WriteTextFileResponse> {
    logDebug('Writing text file with params:', params)
    const { path, content, sessionId } = params
    const resolvedPath = resolvePath(path)

    // Policy errors are thrown as-is (not as a generic write failure).
    await this._checkWriteAllowed(resolvedPath)

    try {
      await Bun.write(resolvedPath, content)
      return {
        _meta: {
          sessionId,
        },
      }
    } catch (error) {
      logError('Error writing file:', error)
      throw new Error(`Failed to write file at path: ${path}`)
    }
  }

  /**
   * Applies `config.fs.outsideWorkspaceWrites` to writes outside the agent's
   * working directory: `allow` writes, `deny` refuses, and `ask` (the
   * default) asks the user in the editor. Writes inside the workspace are
   * always allowed.
   */
  private async _checkWriteAllowed(resolvedPath: string): Promise<void> {
    const state = this.server_instance.getState()
    const root = state.agent?.cwd ?? state.workspaceRoot

    if (!root) {
      return
    }

    const rel = relative(resolvePath(root), resolvedPath)
    const insideWorkspace =
      rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))

    if (insideWorkspace) {
      return
    }

    const policy = state.config?.fs?.outsideWorkspaceWrites ?? 'ask'

    if (policy === 'allow') {
      return
    }

    if (policy === 'ask') {
      const options = [
        { id: 'allow', label: 'Allow' },
        { id: 'deny', label: 'Deny' },
      ]
      const answer = await this.server_instance.getCommsInterface().question({
        questionId: 'fs_outside_workspace_write',
        question: `The agent wants to write outside the workspace (${root}):\n${resolvedPath}\n\nAllow this write?`,
        options,
      })

      if (resolveOptionAnswer(answer, options) === 'allow') {
        return
      }
    }

    throw new Error(
      `Write outside the workspace was denied: ${resolvedPath} (see config fs.outsideWorkspaceWrites)`,
    )
  }

  dispose(): void {
    // No resources to clean up in this handler, but method provided for interface consistency
  }
}
