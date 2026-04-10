import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Permission } from "@/permission"
import { HandoffFallback } from "@/memory/handoff-fallback"
import { SubagentLaunch } from "@/subagent/launch"

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

      const permission = [
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
      ]

      const session = params.task_id ? await Session.get(SessionID.make(params.task_id)).catch(() => {}) : undefined
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      let child = session?.id
      let stop = false
      let launchId: string | undefined
      function cancel() {
        stop = true
        if (launchId) void SubagentLaunch.cancel(launchId)
        if (child) void SessionPrompt.cancel(child)
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

      const next = session
        ? { sessionId: session.id, launchId: undefined }
        : await SubagentLaunch.prepare({
            parent_session_id: ctx.sessionID,
            parent_message_id: ctx.messageID,
            agent,
            description: params.description,
            prompt: params.prompt,
            caller: ctx.agent,
            model,
            parentModel: {
              modelID: msg.info.modelID,
              providerID: msg.info.providerID,
            },
            abort: ctx.abort,
            permission,
          })
      child = next.sessionId
      launchId = next.launchId

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: next.sessionId,
          model,
        },
      })

      const tools = {
        ...(hasTodoWritePermission ? {} : { todowrite: false }),
        ...(hasTaskPermission ? {} : { task: false }),
        ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
      }

      check()
      const result = launchId
        ? await SubagentLaunch.start({
            launchId,
            abort: ctx.abort,
            tools,
          })
        : await SessionPrompt.prompt({
            messageID: MessageID.ascending(),
            sessionID: next.sessionId,
            model: {
              modelID: model.modelID,
              providerID: model.providerID,
            },
            agent: agent.name,
            tools,
            parts: await SessionPrompt.resolvePromptParts(params.prompt),
          })

      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      const output = [
        `task_id: ${next.sessionId} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        text,
        "</task_result>",
      ].join("\n")

      return {
        title: params.description,
        metadata: {
          sessionId: next.sessionId,
          model,
        },
        output,
      }
    },
  }
})
