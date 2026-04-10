import { createHash } from "crypto"
import { eq, inArray } from "drizzle-orm"
import { Agent } from "@/agent/agent"
import { Memory } from "@/memory"
import { Handoff } from "@/memory/handoff"
import { Instance } from "@/project/instance"
import { ModelID, ProviderID } from "@/provider/schema"
import { Session } from "@/session"
import { MessageID, SessionID } from "@/session/schema"
import { OM } from "@/session/om"
import { SessionPrompt } from "@/session/prompt"
import { Database } from "@/storage/db"
import { Log } from "@/util/log"
import {
  SUBAGENT_LAUNCH_MODE,
  SUBAGENT_LAUNCH_STATE,
  SubagentLaunchTable,
  type SubagentLaunchRow,
  type SubagentLaunchState,
} from "./launch.sql"

const log = Log.create({ service: "subagent-launch" })

type Model = { modelID: string; providerID: string }

type Prepared = {
  launchId: string
  sessionId: SessionID
  model: Model
  agent: string
}

function abort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError")
}

function token() {
  return createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 20)
}

function mode(model: Model, parent: Model) {
  if (model.modelID === parent.modelID && model.providerID === parent.providerID) {
    return SUBAGENT_LAUNCH_MODE.FORK
  }
  return SUBAGENT_LAUNCH_MODE.HANDOFF
}

function snap(input: {
  mode: SubagentLaunchRow["mode"]
  description: string
  parentAgent: string
  projectId: string
  currentTask: string | null
  suggestedContinuation: string | null
  workingMemory: Array<{ key: string; value: string }>
}) {
  return JSON.stringify({
    mode: input.mode,
    taskDescription: input.description,
    parentAgent: input.parentAgent,
    projectId: input.projectId,
    currentTask: input.currentTask,
    suggestedContinuation: input.suggestedContinuation,
    workingMemorySnapshot: input.workingMemory,
  })
}

function err(err: unknown) {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}

function row(row: SubagentLaunchRow) {
  return {
    id: row.id,
    sessionId: SessionID.make(row.child_session_id),
    model: {
      modelID: ModelID.make(row.model_id),
      providerID: ProviderID.make(row.provider_id),
    },
    agent: row.agent,
    prompt: row.prompt,
    state: row.state,
    mode: row.mode,
  }
}

export namespace SubagentLaunch {
  export const STATE = SUBAGENT_LAUNCH_STATE

  export async function prepare(input: {
    parent_session_id: SessionID
    parent_message_id: MessageID
    agent: Agent.Info
    description: string
    prompt: string
    caller: string
    model: Model
    parentModel: Model
    abort: AbortSignal
    permission: Awaited<ReturnType<typeof Session.create>>["permission"]
  }): Promise<Prepared> {
    abort(input.abort)
    const id = `subagent_${token()}`
    const next = mode(input.model, input.parentModel)
    let session: Awaited<ReturnType<typeof Session.create>> | undefined

    try {
      abort(input.abort)
      const parent = SessionPrompt.getActiveContext(input.parent_session_id)
      const om = await OM.get(input.parent_session_id)
      const wm = (await Memory.getWorkingMemory({ type: "project", id: Instance.project.id })).map((item) => ({
        key: item.key,
        value: item.value,
      }))
      const json = snap({
        mode: next,
        description: input.description,
        parentAgent: input.caller,
        projectId: Instance.project.id,
        currentTask: om?.current_task ?? null,
        suggestedContinuation: om?.suggested_continuation ?? null,
        workingMemory: wm,
      })

      await Database.tx(async (db) => {
        const now = Date.now()
        session = await Session.create({
          parentID: input.parent_session_id,
          title: `${input.description} (@${input.agent.name} subagent)`,
          permission: input.permission,
        })

        await db
          .insert(SubagentLaunchTable)
          .values({
            id,
            parent_session_id: input.parent_session_id,
            parent_message_id: input.parent_message_id,
            child_session_id: session.id,
            agent: input.agent.name,
            mode: next,
            state: STATE.PREPARING,
            description: input.description,
            prompt: input.prompt,
            model_id: input.model.modelID,
            provider_id: input.model.providerID,
            time_created: now,
            time_updated: now,
          })
          .run()

        await db
          .update(SubagentLaunchTable)
          .set({
            snapshot_json: json,
            state: STATE.PREPARED,
            error: null,
            time_updated: Date.now(),
          })
          .where(eq(SubagentLaunchTable.id, id))
          .run()

        if (next === SUBAGENT_LAUNCH_MODE.FORK) {
          await Handoff.writeFork(
            {
              sessionId: session.id,
              parentSessionId: input.parent_session_id,
              context: json,
            },
            { db },
          )
          return
        }

        await Handoff.writeHandoff(
          {
            parent_session_id: input.parent_session_id,
            child_session_id: session.id,
            context: input.description,
            working_memory_snap: wm.length ? JSON.stringify(wm) : null,
            observation_snap: om?.current_task ?? om?.suggested_continuation ?? null,
            metadata: JSON.stringify({ parentAgent: input.caller, projectId: Instance.project.id }),
          },
          { db },
        )
      })

      if (!session) throw new Error("Subagent launch session was not created")

      if (next === SUBAGENT_LAUNCH_MODE.FORK && parent) {
        SessionPrompt.setForkContext(session.id, parent)
      }

      abort(input.abort)
      log.info("prepared", { launch: id, child: session.id, mode: next })
      return {
        launchId: id,
        sessionId: session.id,
        model: input.model,
        agent: input.agent.name,
      }
    } catch (cause) {
      const state: SubagentLaunchState = input.abort.aborted ? STATE.CANCELLED : STATE.FAILED
      await fail(id, cause, state).catch(() => {})
      throw cause
    }
  }

  export async function start(input: {
    launchId: string
    abort: AbortSignal
    tools: Record<string, boolean>
  }): Promise<Awaited<ReturnType<typeof SessionPrompt.prompt>>> {
    abort(input.abort)
    const found = await Database.read((db) =>
      db.select().from(SubagentLaunchTable).where(eq(SubagentLaunchTable.id, input.launchId)).get(),
    )
    if (!found) throw new Error(`Subagent launch not found: ${input.launchId}`)
    const launch = row(found)
    if (launch.state !== STATE.PREPARED) throw new Error(`Subagent launch is not prepared: ${input.launchId}`)

    try {
      await Database.write((db) =>
        db
          .update(SubagentLaunchTable)
          .set({ state: STATE.STARTING, time_updated: Date.now(), error: null })
          .where(eq(SubagentLaunchTable.id, input.launchId))
          .run(),
      )
      abort(input.abort)
      const parts = await SessionPrompt.resolvePromptParts(launch.prompt)
      abort(input.abort)
      await Database.write((db) =>
        db
          .update(SubagentLaunchTable)
          .set({ state: STATE.STARTED, time_updated: Date.now(), error: null })
          .where(eq(SubagentLaunchTable.id, input.launchId))
          .run(),
      )
      return SessionPrompt.prompt({
        messageID: MessageID.ascending(),
        sessionID: launch.sessionId,
        model: launch.model,
        agent: launch.agent,
        tools: input.tools,
        parts,
      })
    } catch (cause) {
      const state: SubagentLaunchState = input.abort.aborted ? STATE.CANCELLED : STATE.FAILED
      await fail(input.launchId, cause, state).catch(() => {})
      throw cause
    }
  }

  export async function fail(id: string, cause: unknown, state: SubagentLaunchState = STATE.FAILED) {
    await Database.write((db) =>
      db
        .update(SubagentLaunchTable)
        .set({ state, error: err(cause), time_updated: Date.now() })
        .where(eq(SubagentLaunchTable.id, id))
        .run(),
    )
  }

  export async function get(id: string) {
    const found = await Database.read((db) =>
      db.select().from(SubagentLaunchTable).where(eq(SubagentLaunchTable.id, id)).get(),
    )
    if (!found) return
    return row(found)
  }

  export async function listPending() {
    const rows = await Database.read((db) =>
      db
        .select()
        .from(SubagentLaunchTable)
        .where(inArray(SubagentLaunchTable.state, [STATE.PREPARING, STATE.PREPARED, STATE.STARTING]))
        .all(),
    )
    return rows.map(row)
  }

  export async function getBySession(sessionId: SessionID) {
    const found = await Database.read((db) =>
      db.select().from(SubagentLaunchTable).where(eq(SubagentLaunchTable.child_session_id, sessionId)).get(),
    )
    if (!found) return
    return row(found)
  }

  export async function cancel(id: string, cause?: unknown) {
    await fail(id, cause ?? new DOMException("Aborted", "AbortError"), STATE.CANCELLED)
  }
}
