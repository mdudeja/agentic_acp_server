import { describe, test, expect, spyOn, afterEach } from 'bun:test'
import { FileSystemHandler } from '../../src/acp/handlers/FileSystemHandler'
import fs from 'fs/promises'
import * as paths from '../../src/utils/paths'

describe('Handlers.FileSystemHandler', () => {
  afterEach(() => {
    // Restore all spies after each test
  })

  describe('readTextFile', () => {
    test('reads the entire file when no line/limit provided', async () => {
      const mockContent = 'line 1\nline 2\nline 3'
      const readFileSpy = spyOn(fs, 'readFile').mockResolvedValue(
        mockContent as any,
      )

      const handler = new FileSystemHandler()
      const result = await handler.readTextFile({
        path: '/test/path.txt',
        sessionId: 'test-session',
      })

      expect(readFileSpy).toHaveBeenCalledWith('/test/path.txt', 'utf-8')
      expect(result.content).toBe(mockContent)
      expect(result._meta?.sessionId).toBe('test-session')

      readFileSpy.mockRestore()
    })

    test('reads specific lines when line and limit are provided', async () => {
      const mockContent = 'line 1\nline 2\nline 3\nline 4\nline 5'
      const readFileSpy = spyOn(fs, 'readFile').mockResolvedValue(
        mockContent as any,
      )

      const handler = new FileSystemHandler()
      const result = await handler.readTextFile({
        path: '/test/path.txt',
        line: 2, // 1-based index, start at line 2
        limit: 2, // read 2 lines
        sessionId: 'test-session',
      })

      expect(readFileSpy).toHaveBeenCalledWith('/test/path.txt', 'utf-8')
      // line 2 and line 3
      expect(result.content).toBe('line 2\nline 3')
      expect(result._meta?.sessionId).toBe('test-session')

      readFileSpy.mockRestore()
    })

    test('throws an error if fs.readFile fails', async () => {
      const readFileSpy = spyOn(fs, 'readFile').mockRejectedValue(
        new Error('ENOENT') as any,
      )

      const handler = new FileSystemHandler()

      try {
        await handler.readTextFile({
          path: '/test/missing.txt',
        } as any)
        expect(false).toBe(true) // Should not reach here
      } catch (err: any) {
        expect(err.message).toBe(
          'Failed to read file at path: /test/missing.txt',
        )
      }

      readFileSpy.mockRestore()
    })
  })

  describe('writeTextFile', () => {
    test('creates directory and writes file successfully', async () => {
      const mkdirSpy = spyOn(fs, 'mkdir').mockResolvedValue(undefined as any)
      const writeFileSpy = spyOn(fs, 'writeFile').mockResolvedValue(
        undefined as any,
      )
      const resolvePathSpy = spyOn(paths, 'resolvePath').mockImplementation(
        (p) => p,
      )

      const handler = new FileSystemHandler()
      const result = await handler.writeTextFile({
        path: '/test/dir/file.txt',
        content: 'hello world',
        sessionId: 'write-session',
      })

      expect(resolvePathSpy).toHaveBeenCalledWith('/test/dir/file.txt')
      expect(mkdirSpy).toHaveBeenCalledWith('/test/dir', { recursive: true })
      expect(writeFileSpy).toHaveBeenCalledWith(
        '/test/dir/file.txt',
        'hello world',
        'utf-8',
      )
      expect(result._meta?.sessionId).toBe('write-session')

      mkdirSpy.mockRestore()
      writeFileSpy.mockRestore()
      resolvePathSpy.mockRestore()
    })

    test('throws an error if fs.writeFile fails', async () => {
      const mkdirSpy = spyOn(fs, 'mkdir').mockResolvedValue(undefined as any)
      const writeFileSpy = spyOn(fs, 'writeFile').mockRejectedValue(
        new Error('EACCES') as any,
      )
      const resolvePathSpy = spyOn(paths, 'resolvePath').mockImplementation(
        (p) => p,
      )

      const handler = new FileSystemHandler()

      try {
        await handler.writeTextFile({
          path: '/test/dir/readonly.txt',
          content: 'hello world',
        } as any)
        expect(false).toBe(true)
      } catch (err: any) {
        expect(err.message).toBe(
          'Failed to write file at path: /test/dir/readonly.txt',
        )
      }

      mkdirSpy.mockRestore()
      writeFileSpy.mockRestore()
      resolvePathSpy.mockRestore()
    })
  })

  describe('dispose', () => {
    test('dispose does not throw', () => {
      const handler = new FileSystemHandler()
      expect(() => handler.dispose()).not.toThrow()
    })
  })
})
