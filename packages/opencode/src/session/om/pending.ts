import { Token } from "@/util/token"
import { MessageV2 } from "../message-v2"
import type { SessionID } from "../schema"
import type { ObservationRecord } from "./record"
import { OMBuf } from "./buffer"

export namespace OMPending {
  export async function messages(
    sid: SessionID,
    rec?: Pick<ObservationRecord, "last_observed_at" | "observed_message_ids">,
  ) {
    const boundary = rec?.last_observed_at ?? 0
    const ids = new Set<string>(rec?.observed_message_ids ? (JSON.parse(rec.observed_message_ids) as string[]) : [])
    const sealed = OMBuf.sealedAt(sid)
    return (await Array.fromAsync(MessageV2.stream(sid))).filter(
      (msg) =>
        (msg.info.time?.created ?? 0) > boundary &&
        !ids.has(msg.info.id) &&
        (sealed === 0 || (msg.info.time?.created ?? 0) > sealed),
    )
  }

  export function tokens(msgs: Awaited<ReturnType<typeof messages>>) {
    return msgs.reduce((sum, msg) => sum + Token.estimate(JSON.stringify(msg)), 0)
  }
}
