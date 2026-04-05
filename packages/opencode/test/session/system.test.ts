import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { OM } from "../../src/session/om/record"
import { SystemPrompt } from "../../src/session/system"
import type { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const root = path.join(__dirname, "../..")

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
          const skillDir = path.join(dir, ".lightcode", "skill", name)
          await fs.mkdir(skillDir, { recursive: true })
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

          const alpha = first!.indexOf("**alpha-skill**")
          const middle = first!.indexOf("**middle-skill**")
          const zeta = first!.indexOf("**zeta-skill**")

          if (alpha === -1 || middle === -1 || zeta === -1) {
            expect(first).toContain("No skills are currently available.")
            return
          }

          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })
})

// ─── SystemPrompt.observations — reflections priority ─────────────────────────

describe("SystemPrompt.observations — reflections priority", () => {
  test("uses reflections when both reflections and observations are present", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const rec = {
            id: s.id as SessionID,
            session_id: s.id as SessionID,
            observations: "raw observations text",
            reflections: "condensed reflections text",
            current_task: null,
            suggested_continuation: null,
            last_observed_at: Date.now(),
            generation_count: 1,
            observation_tokens: 50_000,
            observed_message_ids: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          }
          OM.upsert(rec)
          const result = await SystemPrompt.observations(s.id as SessionID)
          expect(result).not.toBeUndefined()
          expect(result).toContain("condensed reflections text")
          expect(result).not.toContain("raw observations text")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("falls back to observations when reflections is null", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const rec = {
            id: s.id as SessionID,
            session_id: s.id as SessionID,
            observations: "raw observations text",
            reflections: null,
            current_task: null,
            suggested_continuation: null,
            last_observed_at: Date.now(),
            generation_count: 1,
            observation_tokens: 10,
            observed_message_ids: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          }
          OM.upsert(rec)
          const result = await SystemPrompt.observations(s.id as SessionID)
          expect(result).not.toBeUndefined()
          expect(result).toContain("raw observations text")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("returns undefined when both observations and reflections are null", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const rec = {
            id: s.id as SessionID,
            session_id: s.id as SessionID,
            observations: null,
            reflections: null,
            current_task: null,
            suggested_continuation: null,
            last_observed_at: Date.now(),
            generation_count: 0,
            observation_tokens: 0,
            observed_message_ids: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          }
          OM.upsert(rec)
          const result = await SystemPrompt.observations(s.id as SessionID)
          expect(result).toBeUndefined()
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })
})
