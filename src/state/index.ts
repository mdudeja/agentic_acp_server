import type { ASMState, IASMState } from './IASMState'

type ObjectStateKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends object ? K : never
}[keyof T]

export class ASMStateManager implements IASMState {
  private state: ASMState = {}

  setItem<K extends keyof ASMState>(key: K, value: ASMState[K]): void {
    this.state[key] = value
  }

  updateItem<K extends ObjectStateKeys<ASMState>>(
    key: K,
    value: Partial<NonNullable<ASMState[K]>>,
  ): void {
    const current = this.state[key]
    if (current == null) {
      throw new Error(`Cannot update non-existent key: ${key}`)
    }
    this.state[key] = {
      ...(current as NonNullable<ASMState[K]>),
      ...value,
    } as ASMState[K]
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
