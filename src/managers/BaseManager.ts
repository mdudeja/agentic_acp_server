import EventEmitter from 'node:events'

export class BaseManager<
  T extends Record<string | symbol, any>,
> extends EventEmitter {
  public override emit<K extends keyof T & (string | symbol)>(
    event: K,
    payload?: T[K],
  ) {
    return super.emit(event, payload)
  }

  public override on<K extends keyof T & (string | symbol)>(
    event: K,
    listener: (payload?: T[K]) => void,
  ) {
    return super.on(event, listener)
  }

  public override off<K extends keyof T & (string | symbol)>(
    event: K,
    listener: (payload?: T[K]) => void,
  ) {
    return super.off(event, listener)
  }
}
