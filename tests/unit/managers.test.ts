import { describe, expect, it, mock } from 'bun:test'
import { BaseManager } from '../../src/managers/BaseManager'

interface TestEvents {
  'test.event': { id: string; value: number }
  'test.empty': undefined
}

class TestManager extends BaseManager<TestEvents> {}

describe('BaseManager', () => {
  it('should emit events correctly', () => {
    const manager = new TestManager()
    const listener = mock((_payload) => {})

    manager.on('test.event', listener)
    manager.emit('test.event', { id: '1', value: 42 })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ id: '1', value: 42 })
  })

  it('should allow emitting events without payload if defined as undefined', () => {
    const manager = new TestManager()
    const listener = mock(() => {})

    manager.on('test.empty', listener)
    manager.emit('test.empty')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(undefined)
  })

  it('should remove listeners correctly', () => {
    const manager = new TestManager()
    const listener = mock((_payload) => {})

    manager.on('test.event', listener)
    manager.off('test.event', listener)
    manager.emit('test.event', { id: '1', value: 42 })

    expect(listener).toHaveBeenCalledTimes(0)
  })

  it('EventEmitter methods still work normally', () => {
    const manager = new TestManager()

    manager.setMaxListeners(5)
    expect(manager.getMaxListeners()).toBe(5)

    const listener = mock(() => {})
    manager.once('test.empty', listener)

    manager.emit('test.empty')
    manager.emit('test.empty')

    expect(listener).toHaveBeenCalledTimes(1)
  })
})
