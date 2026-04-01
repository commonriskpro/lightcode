import type { Agent } from "@/agent/agent"
import type { Provider } from "@/provider/provider"
import { Instance } from "@/project/instance"
import { InstructionPrompt } from "./instruction"
import { SystemPrompt } from "./system"

const TTL_MS = (() => {
  const n = Number(process.env.OPENCODE_SYSTEM_PROMPT_CACHE_MS)
  return Number.isFinite(n) && n > 0 ? n : 3_600_000
})()
const store = new Map<string, { at: number; parts: string[] }>()

const INSTRUCTIONS_DEFERRED = [
  "Project instructions from AGENTS.md, CLAUDE.md, config URLs, and other instruction sources are not inlined on this request (same policy as initial_tool_tier minimal).",
  "Use the read tool to load AGENTS.md or CONTEXT.md from the workspace root when you need them; use the skill tool for named skills.",
].join("\n")

/**
 * Instruction index injected after the first turn — lists available instruction sources
 * without inlining their full content. The model uses `read` to load any of these on demand.
 */
function instructionIndex(paths: Set<string>): string {
  if (paths.size === 0) return ""
  const lines = [
    "## Available instruction sources (use the read tool to load any of these when needed):",
    ...[...paths].map((p) => `- ${p}`),
  ]
  return lines.join("\n")
}

function key(agent: Agent.Info, model: Provider.Model, instructions: "full" | "deferred" | "index") {
  return `${agent.name}\0${model.id}\0${Instance.worktree}\0${instructions}`
}

export namespace SystemPromptCache {
  /**
   * Cached system prompt parts (environment + skills + optional instruction file bodies).
   * `instructions` modes:
   * - `"full"`: inline all instruction file contents (first turn with router + full tier, or JSON schema mode)
   * - `"deferred"`: short note telling the model to read on demand (first turn with minimal tier)
   * - `"index"`: list available instruction source paths without inlining contents (subsequent turns)
   */
  export async function getParts(input: {
    agent: Agent.Info
    model: Provider.Model
    instructions?: "full" | "deferred" | "index"
  }) {
    const instructions = input.instructions ?? "full"
    const k = key(input.agent, input.model, instructions)
    const now = Date.now()
    const hit = store.get(k)
    if (hit && now - hit.at < TTL_MS) return [...hit.parts]

    const skills = await SystemPrompt.skills(input.agent)
    let merged: string[]
    if (instructions === "full") {
      merged = await InstructionPrompt.system()
    } else if (instructions === "deferred") {
      merged = [INSTRUCTIONS_DEFERRED]
    } else {
      // "index" — list paths without content
      const paths = await InstructionPrompt.systemPaths()
      const idx = instructionIndex(paths)
      merged = idx ? [idx] : []
    }
    const parts = [...(await SystemPrompt.environment(input.model)), ...(skills ? [skills] : []), ...merged]
    store.set(k, { at: now, parts })
    return parts
  }

  export function clear() {
    store.clear()
  }
}
