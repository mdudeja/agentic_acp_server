import { describe, test, expect, spyOn } from 'bun:test'
import * as helpers from '../../src/utils/helpers'
import * as logger from '../../src/utils/logger'
import * as fs from 'node:fs/promises'
import { afterEach } from 'node:test'
import { InMemoryCommsInterface } from 'tests/helpers/InMemoryCommsInterface'

describe('Utils.Helpers', () => {
  describe('generateCatchblock', () => {
    const comms = new InMemoryCommsInterface()

    test('logs error and notifies via comms if available', () => {
      const logErrorSpy = spyOn(logger, 'logError')
      const notifySpy = spyOn(comms, 'notify')
      const error = new Error('Test Failure')
      helpers.generateCatchblock(comms, error, 'Custom wrapper')

      expect(logErrorSpy).toHaveBeenCalledWith('Custom wrapper', error)
      expect(notifySpy).toHaveBeenCalledWith({
        method: 'agentic/log',
        data: {
          level: 'error',
          message: 'Custom wrapper: Test Failure',
        },
      })
      logErrorSpy.mockClear()
      notifySpy.mockClear()
    })

    test('handles fallback failure message when none is provided', () => {
      const error = new Error('Test Failure')
      const logErrorSpy = spyOn(logger, 'logError')
      helpers.generateCatchblock(null, error, null)

      // It falls back to some string containing 'Error thrown'
      const msg = logErrorSpy.mock.calls[0]?.[0] as string
      expect(msg).toContain('Error thrown')
    })
  })

  describe('tapStream', () => {
    test('wraps source stream and pipelines successfully (basic flow check)', async () => {
      // Create a basic identity stream to tap
      const source = new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk)
        },
      })

      const tapped = helpers.tapStream(source)
      expect(tapped.readable).toBeInstanceOf(ReadableStream)
      expect(tapped.writable).toBeInstanceOf(WritableStream)

      // Send data through writable
      const writer = tapped.writable.getWriter()
      await writer.write({
        jsonrpc: '2.0',
        id: 1,
        result: 'test-chunk',
      })
      await writer.close()

      // Read from readable
      const reader = tapped.readable.getReader()
      const { value } = await reader.read()
      expect(value).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: 'test-chunk',
      })

      const { done: end } = await reader.read()
      expect(end).toBe(true)
    })
  })

  describe('uriToEmbeddedResource', () => {
    let readFileSpy: ReturnType<typeof spyOn>
    afterEach(() => {
      readFileSpy.mockRestore()
    })

    test('loads text mime files correctly', async () => {
      readFileSpy = spyOn(fs, 'readFile').mockResolvedValue(
        'text content' as any,
      )
      const result = await helpers.uriToEmbeddedResource(
        'file:///test/mock.txt',
      )

      expect(readFileSpy).toHaveBeenCalledWith('/test/mock.txt', 'utf-8')
      expect(result.type).toBe('resource')
      expect(result.resource.mimeType).toBe('text/plain')
      expect((result.resource as any).text).toBe('text content')
      expect((result.resource as any).blob).toBeUndefined()
    })

    test('loads non-text mime files correctly as base64', async () => {
      // Mock returning a Buffer
      readFileSpy = spyOn(fs, 'readFile').mockResolvedValue(
        Buffer.from('binary data') as any,
      )

      const result = await helpers.uriToEmbeddedResource(
        'file:///test/mock.png',
      )

      expect(readFileSpy).toHaveBeenCalledWith('/test/mock.png')
      expect(result.type).toBe('resource')
      expect(result.resource.mimeType).toBe('image/png')
      expect((result.resource as any).blob).toBe(
        Buffer.from('binary data').toString('base64'),
      )
      expect((result.resource as any).text).toBeUndefined()
    })

    test('respects mimeOverride', async () => {
      readFileSpy = spyOn(fs, 'readFile').mockResolvedValue('xyz' as any)
      const result = await helpers.uriToEmbeddedResource(
        'file:///test/mock.unknown',
        'text/custom',
      )

      expect(result.resource.mimeType).toBe('text/custom')
      expect((result.resource as any).text).toBe('xyz')
    })

    test('handles non-file uris without modification to fs path', async () => {
      readFileSpy = spyOn(fs, 'readFile').mockResolvedValue('xyz' as any)
      const result = await helpers.uriToEmbeddedResource(
        'https://example.com/mock.txt',
        'text/plain',
      )

      expect(readFileSpy).toHaveBeenCalledWith(
        'https://example.com/mock.txt',
        'utf-8',
      )
      expect(result.resource.uri).toBe('https://example.com/mock.txt')
    })
  })

  describe('deepMerge', () => {
    test('merges simple fields without mutating original', () => {
      const d = { a: 1, b: 2 }
      const o = { b: 3 }
      const r = helpers.deepMerge(d, o)
      expect(r).toEqual({ a: 1, b: 3 })
      expect(d).toEqual({ a: 1, b: 2 })
    })

    test('merges deeply nested objects', () => {
      const d: any = { a: { b: { c: 1 } }, d: 2 }
      const o = { a: { b: { c: 2, e: 3 } } }
      const r = helpers.deepMerge(d, o)
      expect(r).toEqual({ a: { b: { c: 2, e: 3 } }, d: 2 })
    })

    test('does not merge arrays, replaces them', () => {
      const d = { arr: [1, 2] }
      const o = { arr: [3] }
      const r = helpers.deepMerge(d, o)
      expect(r.arr).toEqual([3])
    })

    test('handles undefined overrides by ignoring them', () => {
      const d = { a: 1 }
      const o = { a: undefined as any }
      const r = helpers.deepMerge(d, o)
      expect(r).toEqual({ a: 1 })
    })
  })
})
