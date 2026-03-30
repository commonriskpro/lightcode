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

function key(agent: Agent.Info, model: Provider.Model) {
  return `${agent.name}\0${model.id}\0${Instance.worktree}`
}

export namespace SystemPromptCache {
  /** Cached system prompt parts (environment + skills + instruction files); short TTL to avoid stale AGENTS.md. */
  export async function getParts(input: { agent: Agent.Info; model: Provider.Model }) {
    const k = key(input.agent, input.model)
    const now = Date.now()
    const hit = store.get(k)
    if (hit && now - hit.at < TTL_MS) return [...hit.parts]

    const skills = await SystemPrompt.skills(input.agent)
    const parts = [
      ...(await SystemPrompt.environment(input.model)),
      ...(skills ? [skills] : []),
      ...(await InstructionPrompt.system()),
    ]
    store.set(k, { at: now, parts })
    return parts
  }

  export function clear() {
    store.clear()
  }
}
