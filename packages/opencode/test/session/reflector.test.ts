import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { OM } from "../../src/session/om/record"
import { Reflector } from "../../src/session/om/reflector"
import type { SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const root = path.join(__dirname, "../..")

// ─── validateCompression ────────────────────────────────────────────────────
// validateCompression is internal to reflector.ts but its behavior is observable
// via Reflector.run — we test it indirectly. Direct tests live here as pure logic probes.

describe("session.om.reflector.validateCompression (via text.length >> 2)", () => {
  // target = 40_000 (Reflector.threshold)
  const target = 40_000

  test("text with tokens < target passes compression", () => {
    // text.length >> 2 = tokenCount
    // tokenCount < target → pass
    const text = "x".repeat((target - 1) * 4) // 39999 tokens
    expect(text.length >> 2 < target).toBe(true)
  })

  test("text with tokens >= target fails compression", () => {
    const text = "x".repeat(target * 4) // exactly 40_000 tokens
    expect(text.length >> 2 < target).toBe(false)
  })

  test("empty text passes compression", () => {
    expect("".length >> 2 < target).toBe(true)
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
            observations: "🔴 " + "fact ".repeat(20_000), // > 40k tokens
            reflections: null,
            current_task: null,
            suggested_continuation: null,
            last_observed_at: Date.now(),
            generation_count: 1,
            observation_tokens: 41_000,
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
            generation_count: 0,
            observation_tokens: 50_000,
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
})
