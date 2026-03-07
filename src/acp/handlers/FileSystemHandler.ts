import type {
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk'
import fs from 'fs/promises'
import { dirname } from 'path'
import { logDebug, logError } from 'src/utils/logger'
import { resolvePath } from 'src/utils/paths'

/**
 * Handler for file system operations.
 * Provides methods for reading and writing text files with support for
 * line-based partial reads and automatic directory creation.
 */
export class FileSystemHandler {
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
      const fileContent = await fs.readFile(path, 'utf-8')
      let result = fileContent

      if (
        line !== undefined &&
        line !== null &&
        limit !== undefined &&
        limit !== null
      ) {
        const lines = fileContent.split('\n')
        const start = (line ?? 1) - 1 // Convert to 0-based index
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

    try {
      const resolvedPath = resolvePath(path)
      const dir = dirname(resolvedPath)

      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(resolvedPath, content, 'utf-8')
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

  dispose(): void {
    // No resources to clean up in this handler, but method provided for interface consistency
  }
}
