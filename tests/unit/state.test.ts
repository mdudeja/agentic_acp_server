import { describe, test, expect, beforeEach } from 'bun:test'
import { AppStateManager } from '../../src/state'

describe('AppStateManager', () => {
  let state: AppStateManager

  beforeEach(() => {
    state = new AppStateManager()
  })

  test('setItem and getItem round-trip', () => {
    state.setItem('workspaceRoot', '/tmp')
    expect(state.getItem('workspaceRoot')).toBe('/tmp')
  })

  test('getItem returns undefined for unknown key', () => {
    expect(state.getItem('session')).toBeUndefined()
  })

  test('getState returns the full state object', () => {
    state.setItem('workspaceRoot', '/tmp')
    expect(state.getState()).toEqual({ workspaceRoot: '/tmp' })
  })

  test('updateItem merges into an existing object', () => {
    state.setItem('config', { indexer: { enabled: true } } as any)
    ;(state as any).updateItem('config', { gitignore: true })
    expect((state as any).getItem('config')).toEqual({
      indexer: { enabled: true },
      gitignore: true,
    })
  })

  test('updateItem throws when the key does not exist', () => {
    expect(() => state.updateItem('config', {} as any)).toThrow(
      'Cannot update non-existent key: config',
    )
  })

  test('updateItem throws when the value is null/undefined', () => {
    state.setItem('agent', null)
    expect(() => state.updateItem('agent', {} as any)).toThrow(
      'Cannot update non-existent key: agent',
    )
  })

  test('deleteItem removes a key', () => {
    state.setItem('workspaceRoot', '/tmp')
    state.deleteItem('workspaceRoot')
    expect(state.getItem('workspaceRoot')).toBeUndefined()
  })

  test('dispose clears the state', () => {
    state.setItem('workspaceRoot', '/tmp')
    state.dispose()
    expect(state.getState()).toEqual({})
  })
})
