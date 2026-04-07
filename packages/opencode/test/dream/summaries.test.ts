import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import path from "path"
import os from "os"
import { rm } from "fs/promises"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { AutoDream } from "../../src/dream"
import { OM } from "../../src/session/om/record"
import type { SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { Token } from "../../src/util/token"

const root = path.join(__dirname, "../..")
Log.init({ print: false })

// ─── Isolated DB fixture ──────────────────────────────────────────────────────

let testDbPath: string

beforeAll(async () => {
  testDbPath = path.join(os.tmpdir(), `summaries-test-${Math.random().toString(36).slice(2)}.db`)
  try {
    Database.close()
  } catch {}
  Database.Client.reset()
  process.env["OPENCODE_DB"] = testDbPath
  Database.Client()
  await Instance.reload({ directory: root }).catch(() => {})
})

afterAll(async () => {
  try {
    Database.close()
  } catch {}
  Database.Client.reset()
  await rm(testDbPath, { force: true }).catch(() => undefined)
  await rm(`${testDbPath}-wal`, { force: true }).catch(() => undefined)
  await rm(`${testDbPath}-shm`, { force: true }).catch(() => undefined)
  delete process.env["OPENCODE_DB"]
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedOM(
  sid: SessionID,
  opts: {
    observations?: string | null
    reflections?: string | null
    current_task?: string | null
    observation_tokens?: number
  },
) {
  OM.upsert({
    id: sid,
    session_id: sid,
    observations: opts.observations ?? null,
    reflections: opts.reflections ?? null,
    current_task: opts.current_task ?? null,
    suggested_continuation: null,
    last_observed_at: Date.now(),
    generation_count: 1,
    observation_tokens: opts.observation_tokens ?? Token.estimate(opts.observations ?? opts.reflections ?? ""),
    observed_message_ids: null,
    time_created: Date.now(),
    time_updated: Date.now(),
  })
}

// ─── summaries() reads from OM record ────────────────────────────────────────

describe("dream.summaries", () => {
  test("returns observations from OM record", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          seedOM(s.id as SessionID, { observations: "🔴 user builds auth system", observation_tokens: 200 })
          const result = await AutoDream.summaries(s.id as any)
          expect(result).toContain("auth system")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("uses reflections when present", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          seedOM(s.id as SessionID, {
            observations: "raw obs",
            reflections: "condensed reflection",
            observation_tokens: 300,
          })
          const result = await AutoDream.summaries(s.id as any)
          expect(result).toContain("condensed reflection")
          expect(result).toContain("raw obs") // both are included in summaries (unlike collectForDir)
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("includes current_task when present", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          seedOM(s.id as SessionID, {
            observations: "obs",
            current_task: "migrating auth to JWT",
            observation_tokens: 150,
          })
          const result = await AutoDream.summaries(s.id as any)
          expect(result).toContain("migrating auth to JWT")
          expect(result).toContain("<current-task>")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("returns empty string when session has no OM record", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const result = await AutoDream.summaries(s.id as any)
          expect(result).toBe("")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("caps output at 4000 tokens (16000 chars)", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          // 30k chars of "x" → tokenx estimates ~5000 tokens (at 6 chars/token)
          // which exceeds the 4000-token cap, triggering the slice to 4000*4=16000 chars
          const big = "x".repeat(30_000)
          seedOM(s.id as SessionID, { observations: big, observation_tokens: 5000 })
          const result = await AutoDream.summaries(s.id as any)
          // Cap is 4000 * 4 = 16000 chars
          expect(result.length).toBeLessThanOrEqual(16_000)
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("returns full text when within 4000 tokens", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const small = "🔴 user works at Acme"
          seedOM(s.id as SessionID, { observations: small, observation_tokens: 5 })
          const result = await AutoDream.summaries(s.id as any)
          expect(result).toContain(small)
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })
})

// ─── buildSpawnPrompt ────────────────────────────────────────────────────────

describe("dream.buildSpawnPrompt", () => {
  test("includes Session Observations section when obs is non-empty", () => {
    const result = AutoDream.buildSpawnPrompt("base prompt", undefined, "some session insight")
    expect(result).toContain("## Session Observations")
    expect(result).toContain("some session insight")
  })

  test("excludes Session Observations section when obs is empty string", () => {
    const result = AutoDream.buildSpawnPrompt("base prompt", undefined, "")
    expect(result).not.toContain("## Session Observations")
    expect(result).toBe("base prompt")
  })

  test("excludes Session Observations section when obs is undefined", () => {
    const result = AutoDream.buildSpawnPrompt("base prompt", undefined, undefined)
    expect(result).not.toContain("## Session Observations")
    expect(result).toBe("base prompt")
  })

  test("includes Focus section when focus is provided", () => {
    const result = AutoDream.buildSpawnPrompt("base prompt", "auth system", undefined)
    expect(result).toContain("## Focus")
    expect(result).toContain("auth system")
  })

  test("includes both Focus and Session Observations when both provided", () => {
    const result = AutoDream.buildSpawnPrompt("base prompt", "auth", "some obs")
    expect(result).toContain("## Focus")
    expect(result).toContain("## Session Observations")
    expect(result).toContain("some obs")
  })

  test("base prompt unchanged when focus and obs are absent", () => {
    expect(AutoDream.buildSpawnPrompt("base prompt")).toBe("base prompt")
  })
})

// ─── dream.idle.graceful ──────────────────────────────────────────────────────

describe("dream.idle.graceful", () => {
  test("summaries returns empty string for session with no OM record", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const obs = await AutoDream.summaries(s.id as any)
          expect(obs).toBe("")
          const prompt = AutoDream.buildSpawnPrompt("base", undefined, obs)
          expect(prompt).not.toContain("## Session Observations")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("manual dream path always throws when dir is missing", async () => {
    await expect(AutoDream.run()).rejects.toThrow()
    // Flag must always reset after any code path
    expect(AutoDream.dreaming()).toBe(false)
  })
})
