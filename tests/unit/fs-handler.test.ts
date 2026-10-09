import { describe, test, expect, spyOn, afterEach, mock } from 'bun:test'
import { FileSystemHandler } from '../../src/acp/handlers/FileSystemHandler'
import fs from 'fs/promises'
import * as paths from '../../src/utils/paths'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgenticServer } from '../../src/AgenticServer'

/**
 * Server stub for the handler. Defaults to a workspace rooted at `/`, so
 * every path counts as inside it and no write policy applies.
 */
function makeServer({
  cwd = '/',
  policy,
  answer = 'deny',
}: {
  cwd?: string
  policy?: 'ask' | 'allow' | 'deny'
  answer?: string
} = {}) {
  const question = mock(async () => answer)
  const server = {
    getState: () => ({
      agent: { cwd },
      config: policy ? { fs: { outsideWorkspaceWrites: policy } } : undefined,
    }),
    getCommsInterface: () => ({ question }),
  } as unknown as AgenticServer
  return Object.assign(server, { question })
}

describe('Handlers.FileSystemHandler', () => {
  afterEach(() => {
    // Restore all spies after each test
  })

  describe('readTextFile', () => {
    test('reads the entire file when no line/limit provided', async () => {
      const mockContent = 'line 1\nline 2\nline 3'
      const handler = new FileSystemHandler(makeServer())
      const readFileSpy = spyOn(handler, 'readTextFile')
      const resolvedPath = paths.resolvePath('tests/fixtures/path.txt')
      const result = await handler.readTextFile({
        path: resolvedPath,
        sessionId: 'test-session',
      })

      expect(readFileSpy).toHaveBeenCalledWith({
        path: resolvedPath,
        sessionId: 'test-session',
      })
      expect(result.content).toBe(mockContent)
      expect(result._meta?.sessionId).toBe('test-session')

      readFileSpy.mockRestore()
    })

    test('reads specific lines when line and limit are provided', async () => {
      const handler = new FileSystemHandler(makeServer())
      const readFileSpy = spyOn(handler, 'readTextFile')
      const resolvedPath = paths.resolvePath('tests/fixtures/path.txt')

      const result = await handler.readTextFile({
        path: resolvedPath,
        line: 2, // 1-based index, start at line 2
        limit: 2, // read 2 lines
        sessionId: 'test-session',
      })

      expect(readFileSpy).toHaveBeenCalledWith({
        path: resolvedPath,
        line: 2, // 1-based index, start at line 2
        limit: 2, // read 2 lines
        sessionId: 'test-session',
      })
      // line 2 and line 3
      expect(result.content).toBe('line 2\nline 3')
      expect(result._meta?.sessionId).toBe('test-session')

      readFileSpy.mockRestore()
    })

    test('throws an error if fs.readFile fails', async () => {
      const readFileSpy = spyOn(fs, 'readFile').mockRejectedValue(
        new Error('ENOENT') as any,
      )

      const handler = new FileSystemHandler(makeServer())

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
      const handler = new FileSystemHandler(makeServer())
      const writeFileSpy = spyOn(handler, 'writeTextFile')
      const result = await handler.writeTextFile({
        path: '/tmp/file.txt',
        content: 'hello world',
        sessionId: 'write-session',
      })

      expect(writeFileSpy).toHaveBeenCalledWith({
        path: '/tmp/file.txt',
        content: 'hello world',
        sessionId: 'write-session',
      })

      expect(result._meta?.sessionId).toBe('write-session')

      writeFileSpy.mockRestore()
    })

    test('throws an error if fs.writeFile fails', async () => {
      const mkdirSpy = spyOn(fs, 'mkdir').mockResolvedValue(undefined as any)
      const writeFileSpy = spyOn(fs, 'writeFile').mockRejectedValue(
        new Error('EACCES') as any,
      )
      const resolvePathSpy = spyOn(paths, 'resolvePath').mockImplementation(
        (p) => p,
      )

      const handler = new FileSystemHandler(makeServer())

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

  describe('partial reads', () => {
    const path = paths.resolvePath('tests/fixtures/path.txt')

    test('line alone reads to the end of the file', async () => {
      const handler = new FileSystemHandler(makeServer())
      const result = await handler.readTextFile({
        path,
        line: 2,
        sessionId: 's',
      })
      expect(result.content).toBe('line 2\nline 3')
    })

    test('limit alone reads from the first line', async () => {
      const handler = new FileSystemHandler(makeServer())
      const result = await handler.readTextFile({
        path,
        limit: 1,
        sessionId: 's',
      })
      expect(result.content).toBe('line 1')
    })
  })

  describe('writes outside the workspace', () => {
    let workspace: string
    let outside: string

    const setup = () => {
      workspace = mkdtempSync(join(tmpdir(), 'fs-ws-'))
      outside = mkdtempSync(join(tmpdir(), 'fs-out-'))
    }
    afterEach(() => {
      rmSync(workspace, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    })

    test('inside the workspace never asks', async () => {
      setup()
      const server = makeServer({ cwd: workspace, policy: 'ask' })
      const handler = new FileSystemHandler(server)

      await handler.writeTextFile({
        path: join(workspace, 'a.txt'),
        content: 'x',
        sessionId: 's',
      })

      expect(server.question).not.toHaveBeenCalled()
      expect(await Bun.file(join(workspace, 'a.txt')).text()).toBe('x')
    })

    test('deny refuses without writing', async () => {
      setup()
      const handler = new FileSystemHandler(
        makeServer({ cwd: workspace, policy: 'deny' }),
      )
      const target = join(outside, 'b.txt')

      await expect(
        handler.writeTextFile({ path: target, content: 'x', sessionId: 's' }),
      ).rejects.toThrow('Write outside the workspace was denied')
      expect(await Bun.file(target).exists()).toBe(false)
    })

    test('ask writes only when the user allows', async () => {
      setup()
      const target = join(outside, 'c.txt')

      const denied = makeServer({
        cwd: workspace,
        policy: 'ask',
        answer: 'deny',
      })
      await expect(
        new FileSystemHandler(denied).writeTextFile({
          path: target,
          content: 'x',
          sessionId: 's',
        }),
      ).rejects.toThrow('denied')
      expect(denied.question).toHaveBeenCalledTimes(1)
      expect(await Bun.file(target).exists()).toBe(false)

      const allowed = makeServer({
        cwd: workspace,
        policy: 'ask',
        answer: 'allow',
      })
      await new FileSystemHandler(allowed).writeTextFile({
        path: target,
        content: 'x',
        sessionId: 's',
      })
      expect(await Bun.file(target).text()).toBe('x')
    })

    test('allow writes without asking', async () => {
      setup()
      const server = makeServer({ cwd: workspace, policy: 'allow' })
      const target = join(outside, 'd.txt')

      await new FileSystemHandler(server).writeTextFile({
        path: target,
        content: 'x',
        sessionId: 's',
      })

      expect(server.question).not.toHaveBeenCalled()
      expect(await Bun.file(target).text()).toBe('x')
    })
  })

  describe('dispose', () => {
    test('dispose does not throw', () => {
      const handler = new FileSystemHandler(makeServer())
      expect(() => handler.dispose()).not.toThrow()
    })
  })
})
