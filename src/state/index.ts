import type { AppState, IStateManager } from './types'

type ObjectStateKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends object ? K : never
}[keyof T]

/** Manages the state of the application, handling state transitions and persistence. */
export class AppStateManager implements IStateManager {
  private state: AppState = {}

  /** Sets or updates an item in the application state using the specified key and value. */
  setItem<K extends keyof AppState>(key: K, value: AppState[K]): void {
    this.state[key] = value
  }

  /** Update the item in the application state corresponding to the given key with the provided value. */
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

  /** Delete an item from the application state using the specified key. */
  deleteItem<K extends keyof AppState>(key: K): void {
    delete this.state[key]
  }

  /** Retrieves a value from the AppState using the specified key. Returns the value if the key exists, otherwise returns undefined. */
  getItem<K extends keyof AppState>(key: K): AppState[K] | undefined {
    return this.state[key]
  }

  /** Retrieves the current application state. */
  getState(): AppState {
    return this.state
  }

  /** Releases resources and performs cleanup operations. */
  dispose() {
    this.state = {}
  }
}
