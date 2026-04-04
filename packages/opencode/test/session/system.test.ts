import { describe, expect, test } from "bun:test"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { tmpdir } from "../fixture/fixture"

describe("session.system.volatile", () => {
  test("volatile returns date and model name", () => {
    const model = { api: { id: "claude-sonnet-4" }, providerID: "anthropic" } as any
    const result = SystemPrompt.volatile(model)
    expect(result).toContain("claude-sonnet-4")
    expect(result).toContain("anthropic/claude-sonnet-4")
    expect(result).toContain("Today's date:")
  })

  test("volatile changes when model changes", () => {
    const a = SystemPrompt.volatile({ api: { id: "claude-sonnet-4" }, providerID: "anthropic" } as any)
    const b = SystemPrompt.volatile({ api: { id: "gpt-5.4" }, providerID: "openai" } as any)
    expect(a).not.toBe(b)
    expect(a).toContain("claude-sonnet-4")
    expect(b).toContain("gpt-5.4")
  })

  test("environment does NOT contain date or model name", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = { api: { id: "claude-sonnet-4" }, providerID: "anthropic" } as any
        const env = await SystemPrompt.environment(model)
        const text = env.join("\n")
        expect(text).not.toContain("Today's date")
        expect(text).not.toContain("claude-sonnet-4")
        expect(text).not.toContain("You are powered by")
        expect(text).toContain("<env>")
        expect(text).toContain("Working directory")
        expect(text).toContain("Platform:")
      },
    })
  })
})

describe("session.system", () => {
  test("skills output is sorted by name and stable across calls", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const [name, description] of [
          ["zeta-skill", "Zeta skill."],
          ["alpha-skill", "Alpha skill."],
          ["middle-skill", "Middle skill."],
        ]) {
          const skillDir = path.join(dir, ".opencode", "skill", name)
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            `---
name: ${name}
description: ${description}
---

# ${name}
`,
          )
        }
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          const first = await SystemPrompt.skills(build!)
          const second = await SystemPrompt.skills(build!)

          expect(first).toBe(second)

          const alpha = first!.indexOf("<name>alpha-skill</name>")
          const middle = first!.indexOf("<name>middle-skill</name>")
          const zeta = first!.indexOf("<name>zeta-skill</name>")

          expect(alpha).toBeGreaterThan(-1)
          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })
})
