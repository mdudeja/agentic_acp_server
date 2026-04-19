import type { AppState, IStateManager } from './types'

type ObjectStateKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends object ? K : never
}[keyof T]

export class AppStateManager implements IStateManager {
  private state: AppState = {}

  setItem<K extends keyof AppState>(key: K, value: AppState[K]): void {
    this.state[key] = value
  }

  updateItem<K extends ObjectStateKeys<AppState>>(
    key: K,
    value: Partial<NonNullable<AppState[K]>>,
  ): void {
    const current = this.state[key]
    if (current == null) {
      throw new Error(`Cannot update non-existent key: ${key}`)
    }
    this.state[key] = {
      ...(current as NonNullable<AppState[K]>),
      ...value,
    } as AppState[K]
  }

  deleteItem<K extends keyof AppState>(key: K): void {
    delete this.state[key]
  }

  getItem<K extends keyof AppState>(key: K): AppState[K] | undefined {
    return this.state[key]
  }

  getState(): AppState {
    return this.state
  }

  dispose() {
    this.state = {}
  }
}
