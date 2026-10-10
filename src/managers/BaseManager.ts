import EventEmitter from 'node:events'

/** Provides a base class for managing application resources and components, centralizing event handling and communication. */
export class BaseManager<
  T extends Record<string | symbol, any>,
> extends EventEmitter {
  /** Emits an event, optionally with a payload. */
  public override emit<K extends keyof T & (string | symbol)>(
    event: K,
    payload?: T[K],
  ) {
    return super.emit(event, payload)
  }

  /** Adds a listener for a specific event. The listener can optionally receive a payload when the event is triggered. */
  public override on<K extends keyof T & (string | symbol)>(
    event: K,
    listener: (payload?: T[K]) => void,
  ) {
    return super.on(event, listener)
  }

  /** Removes a listener from an event, allowing cleanup or unsubscribing from event handling. */
  public override off<K extends keyof T & (string | symbol)>(
    event: K,
    listener: (payload?: T[K]) => void,
  ) {
    return super.off(event, listener)
  }
}
