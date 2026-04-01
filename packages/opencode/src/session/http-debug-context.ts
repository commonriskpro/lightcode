import { AsyncLocalStorage } from "node:async_hooks"

type Store = { sessionID: string }

const storage = new AsyncLocalStorage<Store>()

export namespace HttpDebugContext {
  export function run<T>(sessionID: string, fn: () => Promise<T>): Promise<T> {
    return storage.run({ sessionID }, fn)
  }

  export function get(): Store | undefined {
    return storage.getStore()
  }
}
