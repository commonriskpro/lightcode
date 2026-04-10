import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Permission } from "@/permission"
import { Log } from "@/util/log"
import { Memory } from "@/memory"
import { HandoffFallback } from "@/memory/handoff-fallback"
import { Instance } from "@/project/instance"
import { OM } from "@/session/om"

const log = Log.create({ service: "task" })

const waits = new Map<string, Promise<void>>()

async function retry(run: () => Promise<void>) {
  for (const wait of [0, 25, 100]) {
    if (wait > 0) await Bun.sleep(wait)
    try {
      await run()
      return
    } catch {
      // retry
    }
  }
  await run()
}

async function queue<T>(id: string, run: () => Promise<T>) {
  const prev = waits.get(id) ?? Promise.resolve()
  let release = () => {}
  const lock = new Promise<void>((resolve) => {
    release = resolve
  })
  waits.set(id, lock)
  await prev
  try {
    return await run()
  } finally {
    release()
    if (waits.get(id) === lock) waits.delete(id)
  }
}

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z.string().describe("Resume a previous task by passing its task_id").optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => Permission.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents
  const list = accessibleAgents.toSorted((a, b) => a.name.localeCompare(b.name))

  const description = DESCRIPTION.replace(
    "{agents}",
    list
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      await HandoffFallback.ensure()
      const config = await Config.get()

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")
      const hasTodoWritePermission = agent.permission.some((rule) => rule.permission === "todowrite")

      return queue(ctx.sessionID, async () => {
        const session = await iife(async () => {
          if (params.task_id) {
            const found = await Session.get(SessionID.make(params.task_id)).catch(() => {})
            if (found) return found
          }

          return await Session.create({
            parentID: ctx.sessionID,
            title: params.description + ` (@${agent.name} subagent)`,
            permission: [
              ...(hasTodoWritePermission
                ? []
                : [
                    {
                      permission: "todowrite" as const,
                      pattern: "*" as const,
                      action: "deny" as const,
                    },
                  ]),
              ...(hasTaskPermission
                ? []
                : [
                    {
                      permission: "task" as const,
                      pattern: "*" as const,
                      action: "deny" as const,
                    },
                  ]),
              ...(config.experimental?.primary_tools?.map((t) => ({
                pattern: "*",
                action: "allow" as const,
                permission: t,
              })) ?? []),
            ],
          })
        })
        const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
        if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

        let stop = false
        function cancel() {
          stop = true
          void SessionPrompt.cancel(session.id)
        }
        ctx.abort.addEventListener("abort", cancel)
        using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
        const check = () => {
          if (stop || ctx.abort.aborted) throw new DOMException("Aborted", "AbortError")
        }
        check()

        const model = agent.model ?? {
          modelID: msg.info.modelID,
          providerID: msg.info.providerID,
        }

        const sameModel = model.modelID === msg.info.modelID && model.providerID === msg.info.providerID
        const isFork = sameModel && !ctx.extra?.isFork
        if (isFork) {
          const parent = SessionPrompt.getActiveContext(ctx.sessionID)
          if (parent) {
            log.info("fork subagent", { parent: ctx.sessionID, child: session.id })
            SessionPrompt.setForkContext(session.id, parent)
            try {
              check()
              const parentOm = await OM.get(ctx.sessionID as SessionID)
              const wmSnapshot = (await Memory.getWorkingMemory({ type: "project", id: Instance.project.id })).map(
                (r) => ({
                  key: r.key,
                  value: r.value,
                }),
              )
              const data = {
                parentAgent: ctx.agent,
                projectId: Instance.project.id,
                taskDescription: params.description,
                currentTask: parentOm?.current_task ?? null,
                suggestedContinuation: parentOm?.suggested_continuation ?? null,
                workingMemorySnapshot: wmSnapshot,
              }
              const payload = {
                session_id: session.id,
                parent_session_id: ctx.sessionID,
                context: JSON.stringify(data),
              }
              await retry(() => Memory.writeForkContext(payload))
            } catch (err) {
              const payload = {
                session_id: session.id,
                parent_session_id: ctx.sessionID,
                context: JSON.stringify({ taskDescription: params.description }),
              }
              await HandoffFallback.append("fork", payload, err)
            }
          }
        }

        ctx.metadata({
          title: params.description,
          metadata: {
            sessionId: session.id,
            model,
          },
        })

        if (!isFork) {
          try {
            check()
            const parentOm = await OM.get(ctx.sessionID as SessionID)
            const wmRecords = await Memory.getWorkingMemory({ type: "project", id: Instance.project.id })
            const data = {
              context: params.description,
              workingMemory: wmRecords.map((r) => ({ key: r.key, value: r.value })),
              observation: parentOm?.current_task ?? parentOm?.suggested_continuation ?? null,
              metadata: { parentAgent: ctx.agent, projectId: Instance.project.id },
            }
            const payload = {
              parent_session_id: ctx.sessionID,
              child_session_id: session.id,
              context: data.context,
              working_memory_snap: data.workingMemory.length ? JSON.stringify(data.workingMemory) : null,
              observation_snap: data.observation,
              metadata: JSON.stringify(data.metadata),
            }
            await retry(() => Memory.writeHandoff(payload).then(() => {}))
          } catch (err) {
            await HandoffFallback.append(
              "handoff",
              {
                parent_session_id: ctx.sessionID,
                child_session_id: session.id,
                context: params.description,
                working_memory_snap: null,
                observation_snap: null,
                metadata: JSON.stringify({ parentAgent: ctx.agent, projectId: Instance.project.id }),
              },
              err,
            )
          }
        }

        const messageID = MessageID.ascending()
        check()
        const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)
        check()

        const result = await SessionPrompt.prompt({
          messageID,
          sessionID: session.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: agent.name,
          tools: {
            ...(hasTodoWritePermission ? {} : { todowrite: false }),
            ...(hasTaskPermission ? {} : { task: false }),
            ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
          },
          parts: promptParts,
        })

        const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

        const output = [
          `task_id: ${session.id} (for resuming to continue this task if needed)`,
          "",
          "<task_result>",
          text,
          "</task_result>",
        ].join("\n")

        return {
          title: params.description,
          metadata: {
            sessionId: session.id,
            model,
          },
          output,
        }
      })
    },
  }
})
