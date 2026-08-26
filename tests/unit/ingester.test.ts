import { describe, test, expect } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createContentBlocks } from '../../src/ingester'

describe('ingester.createContentBlocks', () => {
  test('always puts the prompt first as a text block', async () => {
    const blocks = await createContentBlocks('hello', {
      type: 'selection',
      text: 'selected',
    })
    expect(blocks[0]).toEqual({ type: 'text', text: 'hello' })
  })

  describe('text-like contexts', () => {
    const textTypes = [
      'selection',
      'file',
      'workspace',
      'keymaps',
      'diagnostics',
    ] as const
    for (const type of textTypes) {
      test(`${type} produces a labelled text block`, async () => {
        const blocks = await createContentBlocks('p', { type, text: 'ctx' })
        const label = type.charAt(0).toUpperCase() + type.slice(1)
        expect(blocks[1]).toEqual({ type: 'text', text: `[${label}]\nctx` })
      })
    }
  })

  describe('image context', () => {
    test('inline base64 data -> image block', async () => {
      const blocks = await createContentBlocks('p', {
        type: 'image',
        text: '',
        metadata: { data: 'abc', mimetype: 'image/jpeg' },
      })
      expect(blocks[1]).toEqual({
        type: 'image',
        data: 'abc',
        mimeType: 'image/jpeg',
        uri: undefined,
      })
    })

    test('uri -> embedded resource block (text file)', async () => {
      const dir = join(tmpdir(), `ingest-${Date.now()}`)
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'note.txt')
      writeFileSync(file, 'file contents')
      try {
        const blocks = await createContentBlocks('p', {
          type: 'image',
          text: '',
          metadata: { uri: `file://${file}`, mimetype: 'text/plain' },
        })
        const block = blocks[1] as any
        expect(block.type).toBe('resource')
        expect(block.resource.text).toBe('file contents')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    test('no data and no uri -> plain text fallback', async () => {
      const blocks = await createContentBlocks('p', {
        type: 'image',
        text: 'fallback',
      })
      expect(blocks[1]).toEqual({ type: 'text', text: 'fallback' })
    })
  })

  describe('audio context', () => {
    test('inline base64 data -> audio block', async () => {
      const blocks = await createContentBlocks('p', {
        type: 'audio',
        text: '',
        metadata: { data: 'xyz', mimetype: 'audio/mpeg' },
      })
      expect(blocks[1]).toEqual({
        type: 'audio',
        data: 'xyz',
        mimeType: 'audio/mpeg',
      })
    })

    test('no data and no uri -> text fallback', async () => {
      const blocks = await createContentBlocks('p', {
        type: 'audio',
        text: 'audio-fallback',
      })
      expect(blocks[1]).toEqual({ type: 'text', text: 'audio-fallback' })
    })
  })

  describe('link context', () => {
    test('no uri -> text block', async () => {
      const blocks = await createContentBlocks('p', { type: 'link', text: 'x' })
      expect(blocks[1]).toEqual({ type: 'text', text: 'x' })
    })

    test('remote uri -> resource_link block', async () => {
      const blocks = await createContentBlocks('p', {
        type: 'link',
        text: '',
        metadata: {
          uri: 'https://example.com/doc',
          name: 'doc',
          title: 'Doc',
          description: 'A doc',
          mimetype: 'text/html',
          size: 10,
        },
      })
      expect(blocks[1]).toMatchObject({
        type: 'resource_link',
        uri: 'https://example.com/doc',
        name: 'doc',
        title: 'Doc',
        description: 'A doc',
        mimeType: 'text/html',
        size: 10,
      })
    })

    test('local file uri -> resource block', async () => {
      const dir = join(tmpdir(), `ingest-link-${Date.now()}`)
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'f.txt')
      writeFileSync(file, 'content')
      try {
        const blocks = await createContentBlocks('p', {
          type: 'link',
          text: '',
          metadata: { uri: `file://${file}` },
        })
        const block = blocks[1] as any
        expect(block.type).toBe('resource')
        expect(block.resource.text).toBe('content')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  test('attaches annotations when provided', async () => {
    const blocks = await createContentBlocks('p', {
      type: 'selection',
      text: 'ctx',
      annotations: { audience: ['user'], priority: 0.5 },
    })
    expect(blocks[1]).toMatchObject({
      annotations: { audience: ['user'], priority: 0.5 },
    })
  })
})
