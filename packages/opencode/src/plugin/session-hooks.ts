import { Effect, Layer, ServiceMap } from "effect"
import { Log } from "@/util/log"
import { InstanceState } from "@/effect/instance-state"

const log = Log.create({ service: "session-hooks" })

/**
 * Session-scoped ephemeral hooks that live only for a single session.
 * These are added via tool calls and cleared when the session ends.
 */

export interface SessionHook {
  id: string
  sessionId: string
  event: string
  matcher: string
  hook: SessionHookDefinition
  createdAt: number
}

export type SessionHookDefinition =
  | { type: "command"; command: string; if?: string }
  | { type: "http"; url: string; method: string; headers?: Record<string, string> }
  | { type: "prompt"; prompt: string; model?: string }
  | { type: "agent"; agent: string }
  | { type: "callback"; fn: Function }

export namespace SessionHooks {
  type State = {
    hooks: Map<string, SessionHook[]>
  }

  export interface Interface {
    add(sessionId: string, hook: Omit<SessionHook, "id" | "createdAt">): Effect.Effect<string>
    remove(sessionId: string, hookId: string): Effect.Effect<boolean>
    get(sessionId: string, event?: string): Effect.Effect<SessionHook[]>
    clear(sessionId: string): Effect.Effect<void>
    clearAll(): Effect.Effect<void>
  }

  class SessionHooksService extends ServiceMap.Service<SessionHooksService, Interface>()("@opencode/SessionHooks") {}

  export const layer = Layer.effect(
    SessionHooksService,
    Effect.gen(function* () {
      const cache = yield* InstanceState.make<State>(
        Effect.fn("SessionHooks.state")(function* () {
          return { hooks: new Map() }
        }),
      )

      const add = Effect.fn("SessionHooks.add")(function* (
        sessionId: string,
        hook: Omit<SessionHook, "id" | "createdAt">,
      ) {
        const state = yield* InstanceState.get(cache)
        const hooks = state.hooks.get(sessionId) ?? []
        const id = `hook_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
        hooks.push({ ...hook, id, createdAt: Date.now() })
        state.hooks.set(sessionId, hooks)
        log.debug("hook added", { sessionId, hookId: id, event: hook.event })
        return id
      })

      const remove = Effect.fn("SessionHooks.remove")(function* (sessionId: string, hookId: string) {
        const state = yield* InstanceState.get(cache)
        const hooks = state.hooks.get(sessionId)
        if (!hooks) return false
        const idx = hooks.findIndex((h) => h.id === hookId)
        if (idx >= 0) {
          hooks.splice(idx, 1)
          log.debug("hook removed", { sessionId, hookId })
          return true
        }
        return false
      })

      const get = Effect.fn("SessionHooks.get")(function* (sessionId: string, event?: string) {
        const state = yield* InstanceState.get(cache)
        const hooks = state.hooks.get(sessionId) ?? []
        if (event) {
          return hooks.filter((h) => h.event === event)
        }
        return hooks
      })

      const clear = Effect.fn("SessionHooks.clear")(function* (sessionId: string) {
        const state = yield* InstanceState.get(cache)
        state.hooks.delete(sessionId)
        log.debug("session hooks cleared", { sessionId })
      })

      const clearAll = Effect.fn("SessionHooks.clearAll")(function* () {
        const state = yield* InstanceState.get(cache)
        state.hooks.clear()
        log.debug("all session hooks cleared")
      })

      return SessionHooksService.of({ add, remove, get, clear, clearAll })
    }),
  )
}

/**
 * Execute a session hook by making an HTTP request
 */
export async function executeHttpHook(
  hook: { url: string; method: string; headers?: Record<string, string> },
  input: any,
): Promise<any> {
  const response = await fetch(hook.url, {
    method: hook.method,
    headers: {
      "Content-Type": "application/json",
      ...hook.headers,
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw new Error(`HTTP hook failed: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

/**
 * Tool for managing session hooks via @session_hook hook type
 */
export const SessionHookTool = {
  id: "session_hook",
  description: "Add or remove session-scoped hooks that respond to events",
  parameters: {
    add: async (input: { sessionId: string; event: string; matcher: string; type: string; config: any }) => {
      return { success: true, hookId: "mock-hook-id" }
    },
    remove: async (input: { sessionId: string; hookId: string }) => {
      return { success: true }
    },
    list: async (input: { sessionId: string }) => {
      return { hooks: [] }
    },
  },
}
