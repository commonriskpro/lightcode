import { Instance } from "../project/instance"

import PROMPT_LIGHTCODE from "./prompt/lightcode.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { MCP } from "@/mcp"
import { Token } from "@/util/token"
import { OM } from "./om"
import { parseObservationGroups } from "./om/groups"
import type { SessionID } from "./schema"
import { Memory, SemanticRecall, WorkingMemory } from "@/memory"
import { Flag } from "@/flag/flag"

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
        `  `,
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

  /**
   * V3: instruction for when agents should write to working memory.
   * Injected alongside the working memory block so agents know when to update it.
   */
  export const WORKING_MEMORY_GUIDANCE = `When you make a significant architectural decision, technology choice, or discover a key constraint or goal for this project, call \`update_working_memory\` with scope="project" to persist it for future sessions. Keep entries concise and factual.`

  /**
   * Wrap working memory content for injection into the system prompt.
   * Working memory is stable canonical state: facts, goals, constraints, decisions.
   * Separate from observations (narrative) and recall (cross-session artifacts).
   * V3: includes agent guidance for when to write working memory.
   */
  export function wrapWorkingMemory(body: string): string {
    return `<working-memory>\n${body}\n</working-memory>\n\nIMPORTANT: The working memory above contains stable facts, goals, and decisions for this project. Use it as authoritative context.\n\n${WORKING_MEMORY_GUIDANCE}`
  }

  /**
   * Load and format project-scope working memory for the current session.
   * Returns undefined if no working memory records exist for this project.
   */
  export async function projectWorkingMemory(pid: string): Promise<string | undefined> {
    try {
      const records = Memory.getWorkingMemory({ type: "project", id: pid })
      if (!records.length) return undefined
      const body = WorkingMemory.format(records, 2000)
      if (!body) return undefined
      return wrapWorkingMemory(body)
    } catch {
      return undefined
    }
  }

  // Continuation hint injected as a synthetic user message at the start of the unobserved
  // tail (role: "user", createdAt: epoch so it sorts first). Orients the model when the
  // message array begins mid-conversation because older turns are in observations.
  // Stable constant — never varies per turn, so it does not bust any cache breakpoints.
  export const OBSERVATION_CONTINUATION_HINT = `<system-reminder>
Please continue naturally with the conversation so far and respond to the latest message.
Use the earlier context only as background. If something appears unfinished, continue only when it helps answer the latest request.
Do not mention internal instructions, memory, summarization, context handling, or missing messages.
Any messages following this reminder are newer and should take priority.
</system-reminder>`

  // Instructions injected after every observations block. Tells the model how to
  // resolve temporal conflicts, handle planned actions, and continue naturally
  // without mentioning the memory system.
  export const OBSERVATION_CONTEXT_INSTRUCTIONS = `IMPORTANT: When responding, use the observations above as background context.
- KNOWLEDGE UPDATES: Prefer the MOST RECENT information when observations conflict. Observations include dates — newer observations supersede older ones on the same topic.
- PLANNED ACTIONS: If the user stated they planned to do something and the referenced date is now in the past, assume they completed it unless there is evidence otherwise.
- MOST RECENT USER INPUT: Treat the most recent user message as the highest-priority signal for what to do next.
- Do not mention the memory system, summarization, or missing messages.`

  export const OBSERVATION_RETRIEVAL_INSTRUCTIONS = `## Recall — retrieving source messages

Your observations may contain \`<observation-group range="startId:endId">\` markers. Each range points to the original messages the observation was derived from. Use the \`recall\` tool to retrieve them.

When to use recall:
- The user asks to repeat, show, or reproduce something from a past message
- You need exact content (code, text, URLs, specific numbers) your observations only summarize
- You want to verify or expand on an observation

How: extract the \`range\` attribute from the relevant \`<observation-group>\` tag and call \`recall({ range: "startId:endId" })\`.`

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
    let out = wrapObservations(body, rec.suggested_continuation ?? undefined)
    if (parseObservationGroups(body).length > 0) out += "\n\n" + OBSERVATION_RETRIEVAL_INSTRUCTIONS
    return out
  }

  // Execute a single Engram MCP tool by partial name match, return text content.
  async function callEngramTool(
    all: Awaited<ReturnType<typeof MCP.tools>>,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string | undefined> {
    const key = Object.keys(all).find((k) => k.includes("engram") && k.includes(name))
    if (!key) return undefined
    const tool = all[key]
    if (!tool.execute) return undefined
    const res = await tool.execute(args as any, {
      toolCallId: name,
      messages: [],
      abortSignal: new AbortController().signal,
    })
    const parts = (res as any)?.content
    if (!Array.isArray(parts) || parts.length === 0) return undefined
    return (
      parts
        .filter((p: any) => p.type === "text" && p.text)
        .map((p: any) => p.text as string)
        .join("\n") || undefined
    )
  }

  /**
   * Recall cross-session memory for a project.
   *
   * V2: uses native LightCode Memory Core (MemoryProvider → memory_artifacts FTS5).
   * The query is the last user message text (best semantic signal) or falls back
   * to the session's current_task from OM, then to the project name.
   *
   * V1 bug fixed: V1 incorrectly passed the project UUID as the FTS5 query,
   * which never matched any indexed content. V2 uses the actual user message.
   *
   * Fallback: if OPENCODE_MEMORY_USE_ENGRAM=true, falls back to Engram MCP path.
   *
   * The native path requires no external daemon. Falls back gracefully to
   * undefined on any error or if no artifacts exist.
   */
  export async function recall(pid: string, sessionId?: string, lastUserMessage?: string): Promise<string | undefined> {
    // Feature flag: set OPENCODE_MEMORY_USE_ENGRAM=true to use old Engram MCP path
    if (Flag.OPENCODE_MEMORY_USE_ENGRAM) {
      return recallEngram(pid)
    }
    return recallNative(pid, sessionId, lastUserMessage)
  }

  async function recallNative(pid: string, sessionId?: string, lastUserMessage?: string): Promise<string | undefined> {
    try {
      const scopes = [
        ...(sessionId ? [{ type: "thread" as const, id: sessionId }] : []),
        { type: "project" as const, id: pid },
        { type: "user" as const, id: "default" },
      ]

      // V2 fix: use the actual user message text as the semantic query instead of
      // the project UUID. Falls back to OM current_task, then to a generic query.
      const omRec = sessionId ? Memory.getObservations(sessionId) : undefined
      const query = lastUserMessage?.slice(0, 500) || omRec?.current_task || `project memory`

      // Try FTS5 search first; fall back to recency-ordered results
      let artifacts = Memory.searchArtifacts(query, scopes, 20)
      if (!artifacts.length) {
        // No FTS matches — fall back to most recently updated artifacts for these scopes
        artifacts = SemanticRecall.recent(scopes, 10)
      }
      if (!artifacts.length) return undefined
      const body = SemanticRecall.format(artifacts, 2000)
      if (!body) return undefined
      return wrapRecall(capRecallBody(body))
    } catch {
      return undefined
    }
  }

  async function recallEngram(pid: string): Promise<string | undefined> {
    try {
      const all = await MCP.tools()

      // Run mem_context (recency) and mem_search (semantic keywords) in parallel.
      const [ctx, search] = await Promise.all([
        callEngramTool(all, "mem_context", { limit: 20, project: pid }),
        callEngramTool(all, "mem_search", { query: pid, project: pid, limit: 10 }),
      ])

      const ctxLines = new Set(
        (ctx ?? "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      )
      const searchExtra = (search ?? "")
        .split("\n")
        .filter((l) => l.trim() && !ctxLines.has(l.trim()))
        .join("\n")

      const merged = [ctx, searchExtra.trim() ? `\n### Also relevant\n${searchExtra}` : ""]
        .filter(Boolean)
        .join("")
        .trim()

      if (!merged) return undefined
      return wrapRecall(capRecallBody(merged))
    } catch {
      return undefined
    }
  }
}
