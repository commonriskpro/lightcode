/**
 * LightCode Memory Core V1 — Handoff Service
 *
 * Durable parent → child agent handoff context and fork context persistence.
 *
 * Critical invariant: fork context is written to DB BEFORE the fork is
 * considered live. Both writeFork() and writeHandoff() are transactional
 * and blocking. If the DB write fails, the fork/handoff is NOT created.
 *
 * This replaces the in-memory fork map which was lost on process restart.
 */

import { createHash } from "crypto"
import { eq } from "drizzle-orm"
import { Database } from "../storage/db"
import { AgentHandoffTable, ForkContextTable } from "./schema.sql"
import type { AgentHandoff, ForkContext } from "./contracts"

function newId(prefix: string): string {
  const bytes = createHash("sha256")
    .update(prefix + String(Date.now()) + Math.random())
    .digest("hex")
    .slice(0, 20)
  return `${prefix}_${bytes}`
}

export namespace Handoff {
  /**
   * Write durable fork context.
   * Transactional — the fork is only live after this write succeeds.
   * Upsert on session_id: safe to call multiple times.
   */
  export async function writeFork(ctx: { sessionId: string; parentSessionId: string; context: string }): Promise<void> {
    const id = newId("fork")
    const now = Date.now()

    await Database.transaction(async () => {
      await Database.use((db) =>
        db
          .insert(ForkContextTable)
          .values({
            id,
            session_id: ctx.sessionId,
            parent_session_id: ctx.parentSessionId,
            context: ctx.context,
            time_created: now,
          })
          .onConflictDoUpdate({
            target: ForkContextTable.session_id,
            set: {
              parent_session_id: ctx.parentSessionId,
              context: ctx.context,
              time_created: now,
            },
          })
          .run(),
      )
    })
  }

  /**
   * Read fork context for a session. Returns undefined if not found.
   */
  export async function getFork(sessionId: string): Promise<ForkContext | undefined> {
    return (await Database.use((db) =>
      db.select().from(ForkContextTable).where(eq(ForkContextTable.session_id, sessionId)).get(),
    )) as ForkContext | undefined
  }

  /**
   * Write an agent handoff record (parent → child).
   * Transactional — the handoff is only live after this write succeeds.
   * Returns the handoff ID.
   */
  export async function writeHandoff(h: Omit<AgentHandoff, "id" | "time_created">): Promise<string> {
    const id = newId("handoff")
    const now = Date.now()

    await Database.transaction(async () => {
      await Database.use((db) =>
        db
          .insert(AgentHandoffTable)
          .values({
            id,
            parent_session_id: h.parent_session_id,
            child_session_id: h.child_session_id,
            context: h.context,
            working_memory_snap: h.working_memory_snap,
            observation_snap: h.observation_snap,
            metadata: h.metadata,
            time_created: now,
          })
          .onConflictDoUpdate({
            target: AgentHandoffTable.child_session_id,
            set: {
              parent_session_id: h.parent_session_id,
              context: h.context,
              working_memory_snap: h.working_memory_snap,
              observation_snap: h.observation_snap,
              metadata: h.metadata,
              time_created: now,
            },
          })
          .run(),
      )
    })

    return id
  }

  /**
   * Get an agent handoff for a child session. Returns undefined if not found.
   */
  export async function getHandoff(childSessionId: string): Promise<AgentHandoff | undefined> {
    return (await Database.use((db) =>
      db.select().from(AgentHandoffTable).where(eq(AgentHandoffTable.child_session_id, childSessionId)).get(),
    )) as AgentHandoff | undefined
  }
}
