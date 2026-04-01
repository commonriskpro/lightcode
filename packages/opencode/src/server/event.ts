import { BusEvent } from "@/bus/bus-event"
import z from "zod"

export const Event = {
  Connected: BusEvent.define("server.connected", z.object({})),
  Disposed: BusEvent.define("global.disposed", z.object({})),
  RouterEmbedStatus: BusEvent.define(
    "router.embed.status",
    z.object({
      phase: z.enum(["idle", "loading", "ready", "error"]),
      model: z.string().optional(),
      message: z.string().optional(),
    }),
  ),
}
