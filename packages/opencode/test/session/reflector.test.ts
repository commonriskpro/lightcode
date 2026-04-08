import { describe, expect, test, mock, beforeEach, afterEach, beforeAll, afterAll } from "bun:test"
import { REFLECTOR_PROMPT } from "../../src/session/om/reflector"
import path from "path"
import os from "os"
import { rm } from "fs/promises"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { OM } from "../../src/session/om/record"
import { Reflector } from "../../src/session/om/reflector"
import type { SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const root = path.join(__dirname, "../..")

// ─── Isolated DB fixture ──────────────────────────────────────────────────────

let testDbPath: string

beforeAll(async () => {
  testDbPath = path.join(os.tmpdir(), `reflector-test-${Math.random().toString(36).slice(2)}.db`)
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

// ─── REFLECTOR_PROMPT content ────────────────────────────────────────────────

describe("session.om.reflector.REFLECTOR_PROMPT", () => {
  // T-1: thread attribution — el Reflector debe saber que el input tiene secciones estructuradas
  test("PROMPT mentions observation groups / thread sections", () => {
    expect(REFLECTOR_PROMPT).toContain("observation group")
  })

  // T-2: user assertions framing fuerte — autoridad del usuario sobre su propio contexto
  test("PROMPT states user is authority on their own context", () => {
    expect(REFLECTOR_PROMPT).toContain("authority")
  })
})

// ─── validateCompression ────────────────────────────────────────────────────
// validateCompression is internal to reflector.ts but its behavior is observable
// via Reflector.run — we test it indirectly via Token.estimate (tokenx) logic probes.

import { Token } from "../../src/util/token"

describe("session.om.reflector.validateCompression (via Token.estimate)", () => {
  const target = 40_000

  test("text with tokens < target passes compression", () => {
    // Build a text whose tokenx estimate is clearly below 40k
    // tokenx default: ~6 chars/token for ASCII. 100k chars ≈ ~16k tokens < 40k.
    const text = "word ".repeat(20_000) // 100k chars, ~16k tokens
    expect(Token.estimate(text) < target).toBe(true)
  })

  test("text with tokens >= target fails compression", () => {
    // 300k chars of ASCII ≈ ~50k tokens > 40k
    const text = "x".repeat(300_000)
    expect(Token.estimate(text) < target).toBe(false)
  })

  test("empty text passes compression", () => {
    expect(Token.estimate("") < target).toBe(true)
  })

  test("Token.estimate returns 0 for empty string", () => {
    expect(Token.estimate("")).toBe(0)
  })

  test("Token.estimate handles CJK correctly (chars/4 would massively undercount)", () => {
    // CJK characters tokenize at ~1 char/token (not 1/4).
    // tokenx knows this; chars/4 does not.
    const cjk = "用户正在构建认证系统，使用JWT令牌进行身份验证。"
    const tokenxEst = Token.estimate(cjk)
    const naiveEst = Math.round(cjk.length / 4)
    // tokenx should give a much higher count (closer to reality)
    expect(tokenxEst).toBeGreaterThan(naiveEst * 2)
  })
})

// ─── Reflector retry loop — integration ─────────────────────────────────────

describe("session.om.reflector retry loop", () => {
  // We test retry behavior by inserting a large observation record and verifying
  // that when Reflector.run can't get a model (no provider configured in test env),
  // it exits gracefully without throwing and without writing reflections.

  test("Reflector.run exits gracefully with no model configured", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          // Insert record above threshold so Reflector would fire
          OM.upsert({
            id: s.id as SessionID,
            session_id: s.id as SessionID,
            observations: "🔴 " + "fact ".repeat(60_000),
            reflections: null,
            current_task: null,
            suggested_continuation: null,
            last_observed_at: Date.now(),
            retention_floor_at: null,
            generation_count: 1,
            observation_tokens: 121_000,
            observed_message_ids: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          // No model configured in test → should resolve without throwing
          await expect(Reflector.run(s.id as SessionID)).resolves.toBeUndefined()
          // reflections must remain null — no model to run
          const got = OM.get(s.id as SessionID)
          expect(got?.reflections).toBeNull()
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("Reflector.run skips when no observation record exists", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          // No OM record → should resolve immediately
          await expect(Reflector.run(s.id as SessionID)).resolves.toBeUndefined()
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("Reflector.run skips when observations is null", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          OM.upsert({
            id: s.id as SessionID,
            session_id: s.id as SessionID,
            observations: null,
            reflections: null,
            current_task: null,
            suggested_continuation: null,
            last_observed_at: Date.now(),
            retention_floor_at: null,
            generation_count: 0,
            observation_tokens: 50_000,
            observed_message_ids: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          await expect(Reflector.run(s.id as SessionID)).resolves.toBeUndefined()
          const got = OM.get(s.id as SessionID)
          expect(got?.reflections).toBeNull()
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("Reflector.threshold is exported and equals 40_000", () => {
    expect(Reflector.threshold).toBe(40_000)
  })

  test("T-5.6: Reflector.run skips when observation_tokens < default 40_000", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          OM.upsert({
            id: s.id as SessionID,
            session_id: s.id as SessionID,
            observations: "🔴 short observation",
            reflections: null,
            current_task: null,
            suggested_continuation: null,
            last_observed_at: Date.now(),
            retention_floor_at: null,
            generation_count: 1,
            observation_tokens: 39_999,
            observed_message_ids: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          await expect(Reflector.run(s.id as SessionID)).resolves.toBeUndefined()
          // reflections must remain null — threshold not reached
          const got = OM.get(s.id as SessionID)
          expect(got?.reflections).toBeNull()
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  // T-5.7: Reflector fires when observation_tokens >= 40_000 (new default, aligned with Mastra)
  // Integration-level note: config is read from disk; in test env no provider is configured
  // so the model fetch fails gracefully — we verify run() resolves without throw.
  test("T-5.7: Reflector.run fires (attempts) above threshold, exits gracefully with no model", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          OM.upsert({
            id: s.id as SessionID,
            session_id: s.id as SessionID,
            observations: "🔴 " + "fact ".repeat(60_000),
            reflections: null,
            current_task: null,
            suggested_continuation: null,
            last_observed_at: Date.now(),
            retention_floor_at: null,
            generation_count: 1,
            observation_tokens: 41_000,
            observed_message_ids: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          // No provider → resolves without throw, reflections stay null
          await expect(Reflector.run(s.id as SessionID)).resolves.toBeUndefined()
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })
})
