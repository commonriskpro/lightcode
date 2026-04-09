import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { SessionID } from "../schema"

export namespace OMEvent {
  export const Updated = BusEvent.define(
    "session.om.updated",
    z.object({
      sessionID: SessionID.zod,
      observations: z.string().nullable(),
      reflections: z.string().nullable(),
      current_task: z.string().nullable(),
      observation_tokens: z.number(),
      generation_count: z.number(),
      last_observed_at: z.number().nullable(),
    }),
  )

  export const ObserverUpdated = BusEvent.define(
    "session.observer.updated",
    z.object({
      sessionID: SessionID.zod,
      active: z.boolean(),
    }),
  )

  export const ReflectorUpdated = BusEvent.define(
    "session.reflector.updated",
    z.object({
      sessionID: SessionID.zod,
      active: z.boolean(),
    }),
  )
}
