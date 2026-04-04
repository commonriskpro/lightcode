import { Database, eq, asc } from "../../storage/db"
import { ObservationTable, ObservationBufferTable } from "../session.sql"
import type { SessionID } from "../schema"
import { Identifier } from "@/id/id"

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

  export function addBuffer(buf: ObservationBuffer): void {
    Database.use((db) => db.insert(ObservationBufferTable).values(buf).run())
  }

  export function activate(sid: SessionID): void {
    const bufs = buffers(sid)
    if (!bufs.length) return

    const rec = get(sid)
    const merged = bufs.map((b) => b.observations).join("\n")
    const totalObs = bufs.reduce((s, b) => s + b.observation_tokens, 0)
    const latest = bufs[bufs.length - 1]

    if (rec) {
      const updated: ObservationRecord = {
        ...rec,
        observations: rec.observations ? rec.observations + "\n" + merged : merged,
        last_observed_at: latest.ends_at,
        generation_count: rec.generation_count + bufs.length,
        observation_tokens: rec.observation_tokens + totalObs,
        time_updated: Date.now(),
      }
      Database.use((db) => db.update(ObservationTable).set(updated).where(eq(ObservationTable.id, rec.id)).run())
    } else {
      const next: ObservationRecord = {
        id: Identifier.ascending("session") as SessionID,
        session_id: sid,
        observations: merged,
        reflections: null,
        last_observed_at: latest.ends_at,
        generation_count: bufs.length,
        observation_tokens: totalObs,
        time_created: Date.now(),
        time_updated: Date.now(),
      }
      Database.use((db) => db.insert(ObservationTable).values(next).run())
    }

    Database.use((db) => db.delete(ObservationBufferTable).where(eq(ObservationBufferTable.session_id, sid)).run())
  }
}
