import { createOpencodeClient, type Event } from "@opencode-ai/sdk/v2"
import type { TuiBusEvent } from "@opencode-ai/plugin/tui"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, onCleanup, onMount } from "solid-js"

export type { TuiBusEvent }

type TuiEventMap = {
  [K in TuiBusEvent["type"]]: Extract<TuiBusEvent, { type: K }>
}

export type EventSource = {
  on: (handler: (event: TuiBusEvent) => void) => () => void
  setWorkspace?: (workspaceID?: string) => void
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const abort = new AbortController()
    let workspaceID: string | undefined
    let sse: AbortController | undefined

    function createSDK() {
      return createOpencodeClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: props.directory,
        fetch: props.fetch,
        headers: props.headers,
        experimental_workspaceID: workspaceID,
      })
    }

    let sdk = createSDK()

    const emitter = createGlobalEmitter<TuiEventMap>()

    let queue: TuiBusEvent[] = []
    let timer: Timer | undefined
    let last = 0

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit(event.type, event)
        }
      })
    }

    const handleEvent = (event: TuiBusEvent) => {
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      const loop = async (fn: () => Promise<void>) => {
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break
          await fn()
          if (timer) clearTimeout(timer)
          if (queue.length > 0) flush()
        }
      }
      // Only `global.event`: every `Bus.publish` also emits `GlobalBus` (see bus/index.ts),
      // so subscribing to both `event` and `global.event` duplicates every message (e.g. double deltas).
      // `global.event` still covers GlobalBus-only emits (dispose, upgrade) that skip `Bus`.
      ;(async () => {
        await loop(async () => {
          const res = await sdk.global.event({ signal: ctrl.signal })
          for await (const row of res.stream) {
            if (ctrl.signal.aborted) break
            handleEvent(row.payload as TuiBusEvent)
          }
        })
      })().catch(() => {})
    }

    onMount(() => {
      if (props.events) {
        const unsub = props.events.on(handleEvent)
        onCleanup(unsub)
      } else {
        startSSE()
      }
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      if (timer) clearTimeout(timer)
    })

    return {
      get client() {
        return sdk
      },
      get workspaceID() {
        return workspaceID
      },
      directory: props.directory,
      event: emitter,
      fetch: props.fetch ?? fetch,
      setWorkspace(next?: string) {
        if (workspaceID === next) return
        workspaceID = next
        sdk = createSDK()
        props.events?.setWorkspace?.(next)
        if (!props.events) startSSE()
      },
      url: props.url,
    }
  },
})
