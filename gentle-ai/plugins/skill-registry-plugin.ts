import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { writeRegistry } from "../lib/skill-registry.ts"

/** One injection per session for the orchestrator primary agent (token-aware). */
const sessions = new Set<string>()

const SkillRegistryPlugin: Plugin = async (ctx) => {
  const { directory } = ctx
  const file = path.join(directory, ".atl", "skill-registry.md")

  return {
    "experimental.chat.system.transform": async (input, output) => {
      if (input.small) return
      if (input.agent?.name !== "sdd-orchestrator") return
      const sid = input.sessionID
      if (!sid) return
      if (sessions.has(sid)) return
      sessions.add(sid)

      try {
        let f = Bun.file(file)
        if (!(await f.exists())) await writeRegistry(directory)
        f = Bun.file(file)
        const text = (await f.text()).trim()
        if (!text) return
        output.system.push(`<skill-registry>\n${text}\n</skill-registry>`)
      } catch {
        /* registry optional */
      }
    },
  }
}

export { SkillRegistryPlugin }
export default SkillRegistryPlugin
