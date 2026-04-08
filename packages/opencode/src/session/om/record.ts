import { Database, eq, asc } from "../../storage/db"
import { ObservationTable, ObservationBufferTable } from "../session.sql"
import type { SessionID } from "../schema"
import { Identifier } from "@/id/id"
import { Observer } from "./observer"
import { Token } from "@/util/token"
import { wrapInObservationGroup } from "./groups"

export type ObservationRecord = typeof ObservationTable.$inferSelect
export type ObservationBuffer = typeof ObservationBufferTable.$inferSelect

function mergeIds(existing: string | null, next: string[]): string {
  const set = new Set<string>(existing ? (JSON.parse(existing) as string[]) : [])
  for (const id of next) set.add(id)
  return JSON.stringify([...set])
}

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

  // addBuffer + activate implement the Mastra-style async pre-compute pattern.
  // addBuffer() is called from the main runLoop (prompt.ts) after each Observer.run() cycle.
  // addBufferSafe() is the canonical write path — prefer it over addBuffer() in production.
  // activate() is called when the "activate" or "block" signal fires to condense buffers.
  export function addBuffer(buf: ObservationBuffer): void {
    Database.use((db) => db.insert(ObservationBufferTable).values(buf).run())
  }

  /**
   * Canonical OM write path — fully atomic.
   *
   * Persists the buffer chunk, observed_message_ids, current_task, and
   * suggested_continuation in a single DB transaction. All four writes
   * succeed or none do — no crash window where partial state is visible.
   *
   * current_task and suggested_continuation live on ObservationRecord, not
   * on ObservationBufferTable (no schema change needed). They are written
   * here so activate() sees them via ...rec spread when it condenses buffers.
   * With multiple buffers, the last writer wins — which is correct because
   * the most recent Observer run has the freshest task context.
   */
  export function addBufferSafe(
    buf: ObservationBuffer,
    sid: SessionID,
    msgIds: string[],
    task?: string | null,
    continuation?: string | null,
  ): void {
    Database.transaction(() => {
      Database.use((db) => db.insert(ObservationBufferTable).values(buf).run())

      const rec = Database.use((db) =>
        db.select().from(ObservationTable).where(eq(ObservationTable.session_id, sid)).get(),
      )
      if (rec) {
        const patch: Partial<ObservationRecord> = {
          observed_message_ids: mergeIds(rec.observed_message_ids ?? null, msgIds),
          time_updated: Date.now(),
        }
        if (task != null) patch.current_task = task
        if (continuation != null) patch.suggested_continuation = continuation
        Database.use((db) => db.update(ObservationTable).set(patch).where(eq(ObservationTable.session_id, sid)).run())
      } else {
        // First observation for this session — insert placeholder.
        // activate() will overwrite observations/tokens; current_task persists via ...rec spread.
        const placeholder: ObservationRecord = {
          id: Identifier.ascending("session") as SessionID,
          session_id: sid,
          observations: null,
          reflections: null,
          current_task: task ?? null,
          suggested_continuation: continuation ?? null,
          last_observed_at: null,
          generation_count: 0,
          observation_tokens: 0,
          observed_message_ids: JSON.stringify(msgIds),
          time_created: Date.now(),
          time_updated: Date.now(),
        }
        Database.use((db) => db.insert(ObservationTable).values(placeholder).run())
      }
    })
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
    const ids = bufs.flatMap((b) => [b.first_msg_id, b.last_msg_id]).filter((id) => id !== null) as string[]

    if (rec) {
      const updated: ObservationRecord = {
        ...rec,
        observations: obs,
        last_observed_at: latest.ends_at,
        generation_count: rec.generation_count + bufs.length,
        observation_tokens: tok,
        observed_message_ids: mergeIds(rec.observed_message_ids ?? null, ids),
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
        observed_message_ids: mergeIds(null, ids),
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

  export function trackObserved(sid: SessionID, ids: string[]): void {
    const rec = get(sid)
    if (!rec) return
    const merged = mergeIds(rec.observed_message_ids ?? null, ids)
    Database.use((db) =>
      db
        .update(ObservationTable)
        .set({ observed_message_ids: merged, time_updated: Date.now() })
        .where(eq(ObservationTable.session_id, sid))
        .run(),
    )
  }

  // V3: observeSafe() removed — targeted obsolete direct-upsert+seal pattern.
  // Final: addBufferSafe() above is now the canonical OM write path used by the hot path.
}
