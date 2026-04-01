import { GlobalBus } from "@/bus/global"
import { Event } from "@/server/event"

const skip = () => process.env.OPENCODE_ROUTER_EMBED_WORKER === "1"

export function emitRouterEmbedStatus(input: {
  phase: "idle" | "loading" | "ready" | "error"
  model?: string
  message?: string
}) {
  if (skip()) return
  GlobalBus.emit("event", {
    directory: undefined,
    payload: {
      type: Event.RouterEmbedStatus.type,
      properties: input,
    },
  })
}
