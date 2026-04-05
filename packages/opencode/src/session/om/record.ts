import { Database, eq, asc } from "../../storage/db"
import { ObservationTable, ObservationBufferTable } from "../session.sql"
import type { SessionID } from "../schema"
import { Identifier } from "@/id/id"
import { Observer } from "./observer"
import { Token } from "@/util/token"
import { wrapInObservationGroup } from "./groups"

export type ObservationRecord = typeof ObservationTable.$inferSelect
export type ObservationBuffer = typeof ObservationBufferTable.$inferSelect

export namespace OM {
  export function get(sid: SessionID): ObservationRecord | undefined {
    return Database.use((db) => db.select().from(ObservationTable).where(eq(ObservationTable.session_id, sid)).get())
  }

  export function upsert(rec: ObservationRecord): void {
    Database.use((db) =>
      db.insert(ObservationTable).values(rec).onConflictDoUpdate({ target: ObservationTable.id, set: rec }).run(),
    )
  }

  export function buffers(sid: SessionID): ObservationBuffer[] {
    return Database.use((db) =>
      db
        .select()
        .from(ObservationBufferTable)
        .where(eq(ObservationBufferTable.session_id, sid))
        .orderBy(asc(ObservationBufferTable.starts_at))
        .all(),
    )
  }

  // NOTE: addBuffer + activate implement the Mastra-style async pre-compute pattern.
  // Currently runLoop writes directly via OM.upsert() — these exist for a future
  // async buffering upgrade but are not called from the main observation path.
  export function addBuffer(buf: ObservationBuffer): void {
    Database.use((db) => db.insert(ObservationBufferTable).values(buf).run())
  }

  export async function activate(sid: SessionID): Promise<void> {
    const bufs = buffers(sid)
    if (!bufs.length) return

    const rec = get(sid)
    const chunks = bufs.map((b) => b.observations)
    // Use LLM to condense chunks into a coherent observation log.
    // Falls back to naive join if observer_model is not configured or LLM fails.
    const merged = await Observer.condense(chunks, rec?.observations ?? undefined)
    const first = bufs[0]
    const last = bufs[bufs.length - 1]
    const range = first?.first_msg_id && last?.last_msg_id ? `${first.first_msg_id}:${last.last_msg_id}` : ""
    const obs = range ? wrapInObservationGroup(merged, range) : merged
    const latest = bufs[bufs.length - 1]
    const tok = Token.estimate(obs)

    if (rec) {
      const updated: ObservationRecord = {
        ...rec,
        observations: obs,
        last_observed_at: latest.ends_at,
        generation_count: rec.generation_count + bufs.length,
        observation_tokens: tok,
        time_updated: Date.now(),
      }
      Database.use((db) => db.update(ObservationTable).set(updated).where(eq(ObservationTable.id, rec.id)).run())
    } else {
      const next: ObservationRecord = {
        id: Identifier.ascending("session") as SessionID,
        session_id: sid,
        observations: obs,
        reflections: null,
        current_task: null,
        suggested_continuation: null,
        last_observed_at: latest.ends_at,
        generation_count: bufs.length,
        observation_tokens: tok,
        time_created: Date.now(),
        time_updated: Date.now(),
      }
      Database.use((db) => db.insert(ObservationTable).values(next).run())
    }

    Database.use((db) => db.delete(ObservationBufferTable).where(eq(ObservationBufferTable.session_id, sid)).run())
  }

  export function reflect(sid: SessionID, txt: string): void {
    Database.use((db) =>
      db
        .update(ObservationTable)
        .set({ reflections: txt, time_updated: Date.now() })
        .where(eq(ObservationTable.session_id, sid))
        .run(),
    )
  }
}
