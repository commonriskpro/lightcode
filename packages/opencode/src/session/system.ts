import { Ripgrep } from "../file/ripgrep"

import { Instance } from "../project/instance"

import PROMPT_LIGHTCODE from "./prompt/lightcode.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { MCP } from "@/mcp"
import { Token } from "@/util/token"
import { OM } from "./om"
import type { SessionID } from "./schema"

export namespace SystemPrompt {
  export function provider(_model: Provider.Model) {
    return [PROMPT_LIGHTCODE]
  }

  export async function environment(_model: Provider.Model) {
    const project = Instance.project
    return [
      [
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Workspace root folder: ${Instance.worktree}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `</env>`,
        `<directories>`,
        `  ${
          project.vcs === "git" && false
            ? await Ripgrep.tree({
                cwd: Instance.directory,
                limit: 50,
              })
            : ""
        }`,
        `</directories>`,
      ].join("\n"),
    ]
  }

  // Volatile data — changes between turns (date, model identity).
  // Injected as uncached system[2] to avoid invalidating cache on system[0] and system[1].
  export function volatile(model: Provider.Model) {
    return [
      `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
      `Today's date: ${new Date().toDateString()}`,
    ].join("\n")
  }

  export async function skills(agent: Agent.Info) {
    if (Permission.disabled(["skill"], agent.permission).has("skill")) return

    const list = await Skill.available(agent)

    return [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
      Skill.fmt(list, { verbose: false }),
    ].join("\n")
  }

  export function capRecallBody(txt: string): string {
    const cap = 2000
    return Token.estimate(txt) > cap ? txt.slice(0, cap * 4) : txt
  }

  export function wrapRecall(body: string): string {
    return `<engram-recall>\n${body}\n</engram-recall>`
  }

  // Instructions injected after every observations block. Tells the model how to
  // resolve temporal conflicts, handle planned actions, and continue naturally
  // without mentioning the memory system.
  export const OBSERVATION_CONTEXT_INSTRUCTIONS = `IMPORTANT: When responding, use the observations above as background context.
- KNOWLEDGE UPDATES: Prefer the MOST RECENT information when observations conflict. Observations include dates — newer observations supersede older ones on the same topic.
- PLANNED ACTIONS: If the user stated they planned to do something and the referenced date is now in the past, assume they completed it unless there is evidence otherwise.
- MOST RECENT USER INPUT: Treat the most recent user message as the highest-priority signal for what to do next.
- Do not mention the memory system, summarization, or missing messages.`

  export function wrapObservations(body: string, hint?: string): string {
    let out = `<local-observations>\n${capRecallBody(body)}\n</local-observations>\n\n${OBSERVATION_CONTEXT_INSTRUCTIONS}`
    if (hint) out += `\n\n<system-reminder>\n${hint}\n</system-reminder>`
    return out
  }

  export async function observations(sid: SessionID): Promise<string | undefined> {
    const rec = OM.get(sid)
    if (!rec) return undefined
    const body = rec.reflections ?? rec.observations
    if (!body) return undefined
    return wrapObservations(body, rec.suggested_continuation ?? undefined)
  }

  export async function recall(pid: string): Promise<string | undefined> {
    try {
      const all = await MCP.tools()
      const key = Object.keys(all).find((k) => k.includes("engram") && k.includes("mem_context"))
      if (!key) return undefined
      const tool = all[key]
      if (!tool.execute) return undefined
      const res = await tool.execute({ limit: 30, project: pid } as any, {
        toolCallId: "recall",
        messages: [],
        abortSignal: new AbortController().signal,
      })
      const parts = (res as any)?.content
      if (!Array.isArray(parts) || parts.length === 0) return undefined
      const txt = parts
        .filter((p: any) => p.type === "text" && p.text)
        .map((p: any) => p.text as string)
        .join("\n")
      if (!txt.trim()) return undefined
      return wrapRecall(capRecallBody(txt))
    } catch {
      return undefined
    }
  }
}
