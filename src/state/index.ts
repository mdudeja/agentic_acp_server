import type { ASMState, IASMState } from './IASMState'

export class ASMStateManager implements IASMState {
  private state: ASMState = {}

  setItem<K extends keyof ASMState>(key: K, value: ASMState[K]): void {
    this.state[key] = value
  }

  updateItem<K extends keyof ASMState>(
    key: K,
    value: Partial<ASMState[K]>,
  ): void {
    if (!this.state[key]) {
      throw new Error(`Cannot update non-existent key: ${key}`)
    }
    this.state[key] = { ...this.state[key], ...value }
  }

  deleteItem<K extends keyof ASMState>(key: K): void {
    delete this.state[key]
  }

  getItem<K extends keyof ASMState>(key: K): ASMState[K] | undefined {
    return this.state[key]
  }

  getState(): ASMState {
    return this.state
  }

  dispose() {
    this.state = {}
  }
}
