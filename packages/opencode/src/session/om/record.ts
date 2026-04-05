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
   * Final canonical OM write path.
   *
   * Wraps addBuffer + trackObserved in a single DB transaction so neither
   * write is visible unless BOTH succeed. This eliminates the crash window
   * where addBuffer writes to ObservationBufferTable but the process dies
   * before trackObserved updates observed_message_ids — which would cause
   * those same messages to be re-observed on restart.
   *
   * The in-memory seal (OMBuf.seal) remains ephemeral by design: it is a
   * read-performance hint that avoids redundant DB queries on a live process.
   * On restart, the durable observed_message_ids (updated here inside the
   * transaction) are the authoritative deduplication source.
   *
   * Replace the three-step sequence in the hot path:
   *   OM.addBuffer({...}) + OMBuf.seal(sid, sealAt) + OM.trackObserved(sid, ids)
   * With:
   *   OM.addBufferSafe(buf, sid, ids) then OMBuf.seal(sid, sealAt)
   *
   * If the transaction fails, neither write succeeds. The messages will be
   * re-offered at the next Observer threshold crossing.
   */
  export function addBufferSafe(buf: ObservationBuffer, sid: SessionID, msgIds: string[]): void {
    Database.transaction(() => {
      // Step 1: persist the observation buffer chunk
      Database.use((db) => db.insert(ObservationBufferTable).values(buf).run())

      // Step 2: atomically merge msgIds into observed_message_ids
      // If a row exists in ObservationTable for this session, update it.
      // If not (very first observation for this session), insert a placeholder row.
      const rec = Database.use((db) =>
        db.select().from(ObservationTable).where(eq(ObservationTable.session_id, sid)).get(),
      )
      if (rec) {
        const merged = mergeIds(rec.observed_message_ids ?? null, msgIds)
        Database.use((db) =>
          db
            .update(ObservationTable)
            .set({ observed_message_ids: merged, time_updated: Date.now() })
            .where(eq(ObservationTable.session_id, sid))
            .run(),
        )
      } else {
        // No observation record yet — insert a minimal one with observed IDs set.
        // This will be overwritten by activate() when the first full observation fires.
        const placeholder: ObservationRecord = {
          id: Identifier.ascending("session") as SessionID,
          session_id: sid,
          observations: null,
          reflections: null,
          current_task: null,
          suggested_continuation: null,
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
