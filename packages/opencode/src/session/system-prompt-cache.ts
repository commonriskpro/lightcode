import type { Agent } from "@/agent/agent"
import type { Provider } from "@/provider/provider"
import { Instance } from "@/project/instance"
import { InstructionPrompt } from "./instruction"
import { SystemPrompt } from "./system"

const TTL_MS = (() => {
  const n = Number(process.env.OPENCODE_SYSTEM_PROMPT_CACHE_MS)
  return Number.isFinite(n) && n > 0 ? n : 30_000
})()
const store = new Map<string, { at: number; parts: string[] }>()

const INSTRUCTIONS_DEFERRED = [
  "Project instructions from AGENTS.md, CLAUDE.md, config URLs, and other instruction sources are not inlined on this request (same policy as initial_tool_tier minimal).",
  "Use the read tool to load AGENTS.md or CONTEXT.md from the workspace root when you need them; use the skill tool for named skills.",
].join("\n")

function key(agent: Agent.Info, model: Provider.Model, instructions: boolean) {
  return `${agent.name}\0${model.id}\0${Instance.worktree}\0${instructions ? "1" : "0"}`
}

export namespace SystemPromptCache {
  /**
   * Cached system prompt parts (environment + skills + optional instruction file bodies).
   * When `instructions` is false, merged instruction files are omitted (first turn under `initial_tool_tier: minimal`).
   */
  export async function getParts(input: { agent: Agent.Info; model: Provider.Model; instructions?: boolean }) {
    const instructions = input.instructions !== false
    const k = key(input.agent, input.model, instructions)
    const now = Date.now()
    const hit = store.get(k)
    if (hit && now - hit.at < TTL_MS) return [...hit.parts]

    const skills = await SystemPrompt.skills(input.agent)
    const merged = instructions ? await InstructionPrompt.system() : [INSTRUCTIONS_DEFERRED]
    const parts = [...(await SystemPrompt.environment(input.model)), ...(skills ? [skills] : []), ...merged]
    store.set(k, { at: now, parts })
    return parts
  }

  export function clear() {
    store.clear()
  }
}
