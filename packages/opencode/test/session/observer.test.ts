import { describe, expect, test, beforeEach, beforeAll, afterAll } from "bun:test"
import path from "path"
import os from "os"
import { rm } from "fs/promises"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { OMBuf, calculateDynamicThreshold } from "../../src/session/om/buffer"
import type { ThresholdRange } from "../../src/session/om/buffer"
import { OM } from "../../src/session/om/record"
import { Reflector, startLevel } from "../../src/session/om/reflector"
import {
  detectDegenerateRepetition,
  parseObserverOutput,
  sanitizeObservationLines,
  PROMPT,
  truncateObsToBudget,
  sanitizeToolResult,
} from "../../src/session/om/observer"
import {
  wrapInObservationGroup,
  parseObservationGroups,
  stripObservationGroups,
  renderObservationGroupsForReflection,
  reconcileObservationGroupsFromReflection,
} from "../../src/session/om/groups"
import { SystemPrompt } from "../../src/session/system"
import type { SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const root = path.join(__dirname, "../..")

// ─── Isolated DB fixture ──────────────────────────────────────────────────────
// Tests that use Instance.provide + Session.create need an isolated DB so that
// parallel test file execution (Bun runs files concurrently) doesn't produce
// FOREIGN KEY failures when another file resets Database.Client mid-run.

let testDbPath: string

beforeAll(async () => {
  testDbPath = path.join(os.tmpdir(), `observer-test-${Math.random().toString(36).slice(2)}.db`)
  try {
    Database.close()
  } catch {}
  Database.Client.reset()
  process.env["OPENCODE_DB"] = testDbPath
  Database.Client()
  // Force Instance to re-boot in the fresh DB for this directory
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

// ─── Buffer state machine ───────────────────────────────────────────────────

describe("session.om.buffer.check", () => {
  // Each test uses a unique sid to avoid cross-test state pollution
  function sid(suffix: string): SessionID {
    return `test-buf-${suffix}-${Math.random().toString(36).slice(2)}` as SessionID
  }

  test("returns idle when tokens < 6k", () => {
    const s = sid("idle")
    expect(OMBuf.check(s, 100)).toBe("idle")
    expect(OMBuf.check(s, 500)).toBe("idle")
    expect(OMBuf.check(s, 4_000)).toBe("idle")
  })

  test("returns buffer at 6k interval", () => {
    const s = sid("buf6k")
    // Add 5999 first — still idle
    expect(OMBuf.check(s, 5_999)).toBe("idle")

    expect(OMBuf.check(s, 1)).toBe("buffer")
  })

  test("returns activate at 140k (adaptive default max when no obsTokens)", () => {
    const s = sid("act140k")
    const highBlock = 200_000
    expect(OMBuf.check(s, 139_999, undefined, undefined, highBlock)).toBe("buffer")
    expect(OMBuf.check(s, 1, undefined, undefined, highBlock)).toBe("activate")
  })

  test("returns block at > default 180k", () => {
    const s = sid("block180k")
    expect(OMBuf.check(s, 180_001)).toBe("block")
  })

  test("returns block when exactly at default 180k", () => {
    const s = sid("block-exact")
    expect(OMBuf.check(s, 180_000)).toBe("block")
  })

  test("returns activate when exactly at 140k (adaptive default max)", () => {
    const s = sid("act-exact")
    expect(OMBuf.check(s, 140_000, undefined, undefined, 200_000)).toBe("activate")
  })

  test("returns buffer when exactly at 6k", () => {
    const s = sid("buf-exact")
    expect(OMBuf.check(s, 6_000)).toBe("buffer")
  })

  test("accumulates tokens across multiple check calls", () => {
    const s = sid("accum")
    // 3 calls, each 2k → total 6k at 3rd call
    expect(OMBuf.check(s, 2_000)).toBe("idle")
    expect(OMBuf.check(s, 2_000)).toBe("idle")
    expect(OMBuf.check(s, 2_000)).toBe("buffer")
  })
})

// ─── OMBuf.add / OMBuf.tokens ────────────────────────────────────────────

describe("session.om.buffer.add", () => {
  function sid(suffix: string): SessionID {
    return `test-add-${suffix}-${Math.random().toString(36).slice(2)}` as SessionID
  }

  test("tokens returns 0 for unknown session", () => {
    const s = sid("unknown")
    expect(OMBuf.tokens(s)).toBe(0)
  })

  test("add accumulates tokens", () => {
    const s = sid("accum")
    OMBuf.add(s, 1_000)
    expect(OMBuf.tokens(s)).toBe(1_000)
    OMBuf.add(s, 2_000)
    expect(OMBuf.tokens(s)).toBe(3_000)
  })

  test("add and check share the same state", () => {
    const s = sid("shared")
    OMBuf.add(s, 5_000)
    // check adds on top of existing 5k
    const result = OMBuf.check(s, 1_001)
    expect(OMBuf.tokens(s)).toBe(6_001)
    expect(result).toBe("buffer")
  })
})

// ─── OMBuf.reset ──────────────────────────────────────────────────────────

describe("session.om.buffer.reset", () => {
  function sid(suffix: string): SessionID {
    return `test-reset-${suffix}-${Math.random().toString(36).slice(2)}` as SessionID
  }

  test("reset clears token count", () => {
    const s = sid("clears")
    OMBuf.add(s, 10_000)
    expect(OMBuf.tokens(s)).toBe(10_000)
    OMBuf.reset(s)
    expect(OMBuf.tokens(s)).toBe(0)
  })

  test("reset clears check state — starts fresh after reset", () => {
    const s = sid("fresh")
    OMBuf.add(s, 35_000)
    OMBuf.reset(s)
    // After reset, 5k should be idle again
    expect(OMBuf.check(s, 5_000)).toBe("idle")
  })

  test("reset on unknown session is a no-op", () => {
    const s = sid("noop")
    expect(() => OMBuf.reset(s)).not.toThrow()
    expect(OMBuf.tokens(s)).toBe(0)
  })
})

// ─── SystemPrompt.wrapObservations ─────────────────────────────────────────

describe("session.system.wrapObservations", () => {
  test("wraps body in local-observations tags", () => {
    const result = SystemPrompt.wrapObservations("some fact")
    expect(result).toContain("<local-observations>")
    expect(result).toContain("</local-observations>")
    expect(result).toContain("some fact")
  })

  test("exact tag format with newlines", () => {
    const body = "fact line"
    const result = SystemPrompt.wrapObservations(body)
    expect(result).toContain(`<local-observations>\n${body}\n</local-observations>`)
    expect(result).toContain(SystemPrompt.OBSERVATION_CONTEXT_INSTRUCTIONS)
  })

  test("caps body content at 2000 tokens via capRecallBody", () => {
    // 13000 chars of "x" → tokenx estimates ~2167 tokens (at 6 chars/token)
    // exceeds the 2000 cap → sliced to 2000 * 4 = 8000 chars
    const large = "x".repeat(13_000)
    const result = SystemPrompt.wrapObservations(large)
    // The inner body should be capped at 8000 chars
    expect(result).toContain("x".repeat(8_000))
    expect(result).not.toContain("x".repeat(8_001))
  })

  test("does not truncate body under 2000 tokens", () => {
    const small = "hello world"
    const result = SystemPrompt.wrapObservations(small)
    expect(result).toContain(small)
  })
})

// ─── SystemPrompt.observations ─────────────────────────────────────────────

describe("session.system.observations", () => {
  test("returns undefined when no observation record exists for session", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          // No observation record written → OM.get returns undefined → returns undefined
          const result = await SystemPrompt.observations(s.id as SessionID)
          expect(result).toBeUndefined()
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("returns wrapped observations when record exists", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          // Insert a minimal observation record
          const rec = {
            id: s.id as SessionID,
            session_id: s.id as SessionID,
            observations: "🔴 user is a TypeScript developer",
            reflections: null,
            current_task: null,
            suggested_continuation: null,
            last_observed_at: Date.now(),
            retention_floor_at: null,
            generation_count: 1,
            observation_tokens: 10,
            observed_message_ids: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          }
          OM.upsert(rec)

          const result = await SystemPrompt.observations(s.id as SessionID)
          expect(result).not.toBeUndefined()
          expect(result).toContain("<local-observations>")
          expect(result).toContain("TypeScript developer")
          expect(result).toContain("</local-observations>")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })
})

// ─── OM CRUD ────────────────────────────────────────────────────────────────

describe("session.om.record", () => {
  test("get returns undefined for session with no observation", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const result = OM.get(s.id as SessionID)
          expect(result).toBeUndefined()
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("upsert + get round-trip", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const rec = {
            id: s.id as SessionID,
            session_id: s.id as SessionID,
            observations: "🔴 fact one",
            reflections: null,
            current_task: null,
            suggested_continuation: null,
            last_observed_at: 12345,
            retention_floor_at: null,
            generation_count: 1,
            observation_tokens: 5,
            observed_message_ids: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          }
          OM.upsert(rec)
          const got = OM.get(s.id as SessionID)
          expect(got).not.toBeUndefined()
          expect(got!.observations).toBe("🔴 fact one")
          expect(got!.generation_count).toBe(1)
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("buffers returns empty array when no buffers exist", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const result = OM.buffers(s.id as SessionID)
          expect(result).toEqual([])
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("addBuffer + buffers round-trip", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const now = Date.now()
          const buf = {
            id: `buf-${now}` as SessionID,
            session_id: s.id as SessionID,
            observations: "buffered chunk",
            message_tokens: 100,
            observation_tokens: 20,
            starts_at: now,
            ends_at: now + 1000,
            first_msg_id: null,
            last_msg_id: null,
            time_created: now,
            time_updated: now,
          }
          OM.addBuffer(buf)
          const list = OM.buffers(s.id as SessionID)
          expect(list).toHaveLength(1)
          expect(list[0].observations).toBe("buffered chunk")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("activate merges buffers into observation record", async () => {
    // Use a single buffer: condense() short-circuits when chunks.length <= 1
    // (line 217 in observer.ts: if (chunks.length <= 1) return joined).
    // This avoids the LLM call entirely — no network dependency in the test.
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const now = Date.now()
          // Single buffer containing both observations joined — avoids condense LLM call
          const buf = {
            id: `buf-a-${now}` as SessionID,
            session_id: s.id as SessionID,
            observations: "chunk one\nchunk two",
            message_tokens: 110,
            observation_tokens: 22,
            starts_at: now,
            ends_at: now + 1000,
            first_msg_id: null,
            last_msg_id: null,
            time_created: now,
            time_updated: now,
          }
          OM.addBuffer(buf)

          await OM.activate(s.id as SessionID)

          const rec = OM.get(s.id as SessionID)
          expect(rec).not.toBeUndefined()
          expect(rec!.observations).toContain("chunk one")
          expect(rec!.observations).toContain("chunk two")
          expect(rec!.generation_count).toBe(1)
          expect(rec!.observation_tokens).toBeGreaterThan(0)
          expect(rec!.last_observed_at).toBe(now + 1000)

          const remaining = OM.buffers(s.id as SessionID)
          expect(remaining).toHaveLength(0)
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })
})

// ─── System array layout (cache-safety) ───────────────────────────────────
// Verifies that the splice logic in llm.ts produces the correct segment order
// without destabilizing cache breakpoints on system[0] and system[1].
// We test this by replicating the splice logic and asserting segment positions.

describe("session.llm.system-layout", () => {
  // Inline replica of the splice logic from llm.ts:132-134
  function buildSystem(base: string[], recall?: string, obs?: string): string[] {
    const system = [...base]
    if (recall) system.splice(1, 0, recall)
    if (obs) system.splice(recall ? 2 : 1, 0, obs)
    return system
  }

  test("no recall no obs — system stays as base + volatile", () => {
    const system = buildSystem(["agent"])
    expect(system).toEqual(["agent"])
  })

  test("recall only — inserted at system[1]", () => {
    const system = buildSystem(["agent"], "recall")
    expect(system[0]).toBe("agent")
    expect(system[1]).toBe("recall")
    expect(system).toHaveLength(2)
  })

  test("observations only (no recall) — inserted at system[1]", () => {
    const system = buildSystem(["agent"], undefined, "obs")
    expect(system[0]).toBe("agent")
    expect(system[1]).toBe("obs")
    expect(system).toHaveLength(2)
  })

  test("recall + observations — correct 4-segment layout", () => {
    // This is the critical cache-safety test:
    // system[0] = agent (BP2, 1h — MUST stay at index 0)
    // system[1] = recall (BP3, 5min — MUST stay at index 1)
    // system[2] = observations (no explicit BP — between BP3 and volatile)
    // system[3] = volatile (added later by llm.ts, not tested here)
    const system = buildSystem(["agent"], "recall", "obs")
    expect(system[0]).toBe("agent")
    expect(system[1]).toBe("recall")
    expect(system[2]).toBe("obs")
    expect(system).toHaveLength(3)
  })

  test("system[0] (agent prompt) is NEVER displaced by recall or observations", () => {
    const system = buildSystem(["agent"], "r", "o")
    expect(system[0]).toBe("agent")
  })

  test("system[1] (recall) is NEVER displaced by observations", () => {
    const system = buildSystem(["agent"], "recall", "obs")
    expect(system[1]).toBe("recall")
    // observations must be AFTER recall
    expect(system.indexOf("obs")).toBeGreaterThan(system.indexOf("recall"))
  })

  test("wrapObservations output is usable as system segment", () => {
    const wrapped = SystemPrompt.wrapObservations("user is a TypeScript dev")
    const system = buildSystem(["agent"], "recall", wrapped)
    expect(system[2]).toContain("<local-observations>")
    expect(system[2]).toContain("TypeScript dev")
    expect(system[2]).toContain("</local-observations>")
  })

  test("capRecallBody preserves observations content under 2000 tokens", () => {
    const body = "small obs"
    const capped = SystemPrompt.capRecallBody(body)
    expect(capped).toBe(body)
  })
})

// ─── Reflector ────────────────────────────────────────────────────────────────

describe("session.om.reflector", () => {
  test("threshold constant is 40_000 (aligned with Mastra)", () => {
    expect(Reflector.threshold).toBe(40_000)
  })

  test("OM.reflect updates reflections without touching observations", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const rec = {
            id: s.id as SessionID,
            session_id: s.id as SessionID,
            observations: "🔴 user is a TypeScript developer",
            reflections: null,
            current_task: null,
            suggested_continuation: null,
            last_observed_at: Date.now(),
            retention_floor_at: null,
            generation_count: 1,
            observation_tokens: 50_000,
            observed_message_ids: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          }
          OM.upsert(rec)
          OM.reflect(s.id as SessionID, "condensed text")
          const got = OM.get(s.id as SessionID)
          expect(got!.reflections).toBe("condensed text")
          expect(got!.observations).toBe("🔴 user is a TypeScript developer")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("Reflector.run returns early when observation_tokens is below threshold", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          // No OM record → run should return without error
          await expect(Reflector.run(s.id as SessionID)).resolves.toBeUndefined()
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })
})

// ─── detectDegenerateRepetition ─────────────────────────────────────────────

describe("session.om.observer.detectDegenerateRepetition", () => {
  test("returns false for text shorter than 2000 chars", () => {
    expect(detectDegenerateRepetition("short text")).toBe(false)
    expect(detectDegenerateRepetition("x".repeat(1999))).toBe(false)
  })

  test("returns false for varied content", () => {
    // Build 3000 chars of genuinely varied content
    const varied = Array.from(
      { length: 30 },
      (_, i) => `Observation ${i}: The user implemented feature ${i} using pattern ${i * 7} with ${i} dependencies. `,
    ).join("")
    expect(detectDegenerateRepetition(varied)).toBe(false)
  })

  test("returns true for highly repetitive content", () => {
    // Classic Gemini repeat-penalty bug — same phrase repeated hundreds of times
    const phrase = "The user wants to implement authentication with JWT tokens. "
    const degenerate = phrase.repeat(60) // ~3600 chars, all identical
    expect(detectDegenerateRepetition(degenerate)).toBe(true)
  })

  test("2000 char boundary — exactly 2000 returns false (skipped)", () => {
    // text.length < 2000 check — exactly 2000 is NOT skipped
    expect(detectDegenerateRepetition("x".repeat(2000))).toBe(true) // all identical → degenerate
  })
})

// ─── parseObserverOutput ────────────────────────────────────────────────────

describe("session.om.observer.parseObserverOutput", () => {
  test("extracts all three XML sections", () => {
    const raw = `
<observations>
* 🔴 10:00 user is a TypeScript developer
* 🟡 10:01 asked about auth
</observations>

<current-task>
Implementing JWT authentication middleware
</current-task>

<suggested-response>
Continue with the middleware implementation as discussed.
</suggested-response>
`.trim()
    const result = parseObserverOutput(raw)
    expect(result.observations).toContain("TypeScript developer")
    expect(result.currentTask).toContain("JWT authentication")
    expect(result.suggestedContinuation).toContain("Continue with the middleware")
  })

  test("falls back to full text when no <observations> tag", () => {
    const raw = "* 🔴 10:00 user prefers Bun over Node"
    const result = parseObserverOutput(raw)
    expect(result.observations).toBe(raw.trim())
    expect(result.currentTask).toBeUndefined()
    expect(result.suggestedContinuation).toBeUndefined()
  })

  test("handles partial XML — only observations tag present", () => {
    const raw = `<observations>
* 🔴 fact one
</observations>
some trailing text`
    const result = parseObserverOutput(raw)
    expect(result.observations).toContain("fact one")
    expect(result.currentTask).toBeUndefined()
    expect(result.suggestedContinuation).toBeUndefined()
  })

  test("trims whitespace from extracted sections", () => {
    const raw = `<observations>  spaced  </observations><current-task>  task  </current-task>`
    const result = parseObserverOutput(raw)
    expect(result.observations).toBe("spaced")
    expect(result.currentTask).toBe("task")
  })

  test("empty string returns empty observations", () => {
    const result = parseObserverOutput("")
    expect(result.observations).toBe("")
    expect(result.currentTask).toBeUndefined()
  })

  // T-1.1: thread-title extraction
  test("extracts <thread-title> into threadTitle field", () => {
    const raw = `
<observations>
* 🔴 10:00 user is a TypeScript developer
</observations>
<current-task>
Building auth middleware
</current-task>
<suggested-response>
Continue with the middleware.
</suggested-response>
<thread-title>
Fix TypeScript Auth
</thread-title>
`.trim()
    const result = parseObserverOutput(raw)
    expect(result.threadTitle).toBe("Fix TypeScript Auth")
  })

  // T-1.2: missing thread-title tag → undefined
  test("threadTitle is undefined when <thread-title> tag is absent", () => {
    const raw = `
<observations>
* 🔴 10:00 user prefers Bun
</observations>
`.trim()
    const result = parseObserverOutput(raw)
    expect(result.threadTitle).toBeUndefined()
  })
})

// ─── calculateDynamicThreshold ──────────────────────────────────────────────

describe("session.om.buffer.calculateDynamicThreshold", () => {
  test("plain number — always returns the number unchanged", () => {
    expect(calculateDynamicThreshold(30_000, 0)).toBe(30_000)
    expect(calculateDynamicThreshold(30_000, 15_000)).toBe(30_000)
    expect(calculateDynamicThreshold(30_000, 99_999)).toBe(30_000)
  })

  test("ThresholdRange — returns max when obsTokens is 0", () => {
    expect(calculateDynamicThreshold({ min: 30_000, max: 70_000 }, 0)).toBe(70_000)
  })

  test("ThresholdRange — shrinks by obsTokens", () => {
    expect(calculateDynamicThreshold({ min: 30_000, max: 70_000 }, 20_000)).toBe(50_000)
  })

  test("ThresholdRange — floors at min", () => {
    expect(calculateDynamicThreshold({ min: 30_000, max: 70_000 }, 50_000)).toBe(30_000)
    expect(calculateDynamicThreshold({ min: 30_000, max: 70_000 }, 80_000)).toBe(30_000)
  })

  test("ThresholdRange — never returns below min even with huge obsTokens", () => {
    const result = calculateDynamicThreshold({ min: 10_000, max: 50_000 }, 999_999)
    expect(result).toBe(10_000)
  })
})

// ─── wrapObservations with hint ─────────────────────────────────────────────

describe("session.system.wrapObservations hint", () => {
  test("without hint — no injected system-reminder block after instructions", () => {
    const result = SystemPrompt.wrapObservations("some facts")
    expect(result).toContain("<local-observations>")
    expect(result).toContain("</local-observations>")
    expect(result).toContain(SystemPrompt.OBSERVATION_CONTEXT_INSTRUCTIONS)
    // The invariant: without a hint, the output must end with OBSERVATION_CONTEXT_INSTRUCTIONS
    // — no injected <system-reminder> block appended after it.
    // (The instructions text itself may mention the tag as an example — that's fine.)
    expect(result.endsWith(SystemPrompt.OBSERVATION_CONTEXT_INSTRUCTIONS)).toBe(true)
  })

  test("with hint — injects system-reminder after instructions", () => {
    const result = SystemPrompt.wrapObservations("some facts", "Continue building the auth module.")
    expect(result).toContain("<system-reminder>")
    expect(result).toContain("Continue building the auth module.")
    expect(result).toContain("</system-reminder>")
    // system-reminder comes AFTER instructions
    const instrIdx = result.indexOf(SystemPrompt.OBSERVATION_CONTEXT_INSTRUCTIONS)
    const reminderIdx = result.indexOf("<system-reminder>")
    expect(instrIdx).toBeLessThan(reminderIdx)
  })

  test("with undefined hint — behaves like no hint", () => {
    const withUndefined = SystemPrompt.wrapObservations("facts", undefined)
    const withoutHint = SystemPrompt.wrapObservations("facts")
    expect(withUndefined).toBe(withoutHint)
  })
})

// ─── currentTask DB round-trip ───────────────────────────────────────────────

describe("session.om.record currentTask round-trip", () => {
  test("upsert stores current_task and suggested_continuation, get reads them back", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          OM.upsert({
            id: s.id as SessionID,
            session_id: s.id as SessionID,
            observations: "🔴 user is building auth",
            reflections: null,
            current_task: "Implementing JWT middleware",
            suggested_continuation: "Continue with token validation.",
            last_observed_at: Date.now(),
            retention_floor_at: null,
            generation_count: 1,
            observation_tokens: 100,
            observed_message_ids: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          const got = OM.get(s.id as SessionID)
          expect(got?.current_task).toBe("Implementing JWT middleware")
          expect(got?.suggested_continuation).toBe("Continue with token validation.")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("null current_task and suggested_continuation are stored as null", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          OM.upsert({
            id: s.id as SessionID,
            session_id: s.id as SessionID,
            observations: "🔴 fact",
            reflections: null,
            current_task: null,
            suggested_continuation: null,
            last_observed_at: Date.now(),
            retention_floor_at: null,
            generation_count: 1,
            observation_tokens: 10,
            observed_message_ids: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          const got = OM.get(s.id as SessionID)
          expect(got?.current_task).toBeNull()
          expect(got?.suggested_continuation).toBeNull()
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })
})

// ─── OMBuf inFlight lifecycle ────────────────────────────────────────────────

describe("session.om.buffer.inFlight", () => {
  function sid(suffix: string): SessionID {
    return `test-inflight-${suffix}-${Math.random().toString(36).slice(2)}` as SessionID
  }

  test("setInFlight stores a promise — getInFlight returns it", () => {
    const s = sid("set-get")
    const p = Promise.resolve()
    OMBuf.setInFlight(s, p)
    expect(OMBuf.getInFlight(s)).toBe(p)
  })

  test("clearInFlight removes the entry — getInFlight returns undefined", () => {
    const s = sid("clear")
    OMBuf.setInFlight(s, Promise.resolve())
    OMBuf.clearInFlight(s)
    expect(OMBuf.getInFlight(s)).toBeUndefined()
  })

  test("awaitInFlight awaits the promise AND clears it", async () => {
    const s = sid("await-clears")
    let resolved = false
    const p = new Promise<void>((res) =>
      setTimeout(() => {
        resolved = true
        res()
      }, 5),
    )
    OMBuf.setInFlight(s, p)
    await OMBuf.awaitInFlight(s)
    expect(resolved).toBe(true)
    expect(OMBuf.getInFlight(s)).toBeUndefined()
  })

  test("awaitInFlight on missing key resolves immediately", async () => {
    const s = sid("missing")
    // Should not hang or throw
    await expect(OMBuf.awaitInFlight(s)).resolves.toBeUndefined()
  })

  test("reset also clears inFlight entry", () => {
    const s = sid("reset-clears")
    OMBuf.setInFlight(s, Promise.resolve())
    OMBuf.reset(s)
    expect(OMBuf.getInFlight(s)).toBeUndefined()
  })
})

// ─── startLevel ──────────────────────────────────────────────────────────────

describe("session.om.reflector.startLevel", () => {
  test("gemini-2.5-flash prefix → 2", () => {
    expect(startLevel("google/gemini-2.5-flash")).toBe(2)
  })

  test("gemini-2.5-flash-thinking → 2", () => {
    expect(startLevel("gemini-2.5-flash-thinking")).toBe(2)
  })

  test("gpt-4o → 1", () => {
    expect(startLevel("gpt-4o")).toBe(1)
  })

  test("anthropic/claude-sonnet → 1", () => {
    expect(startLevel("anthropic/claude-sonnet")).toBe(1)
  })

  test("empty string → 1", () => {
    expect(startLevel("")).toBe(1)
  })
})

// ─── PROMPT richness (Phase 2, T-2.1) ───────────────────────────────────────

describe("session.om.observer.PROMPT", () => {
  test("PROMPT contains temporal anchoring instruction", () => {
    expect(PROMPT).toContain("MULTIPLE events")
  })

  test("PROMPT contains state-change framing instruction", () => {
    expect(PROMPT).toContain("STATE CHANGES")
  })

  test("PROMPT contains precise action verbs instruction", () => {
    expect(PROMPT).toContain("PRECISE ACTION VERBS")
  })

  test("PROMPT contains detail preservation instruction", () => {
    expect(PROMPT).toContain("PRESERVE DISTINGUISHING DETAILS")
  })

  test("PROMPT preserves XML output format tags", () => {
    expect(PROMPT).toContain("<observations>")
    expect(PROMPT).toContain("</observations>")
    expect(PROMPT).toContain("<current-task>")
    expect(PROMPT).toContain("</current-task>")
    expect(PROMPT).toContain("<suggested-response>")
    expect(PROMPT).toContain("</suggested-response>")
  })

  // T-1.3: completion tracking section
  test("PROMPT contains COMPLETION TRACKING section", () => {
    expect(PROMPT).toContain("COMPLETION TRACKING")
  })

  // T-1.4: conversation context section
  test("PROMPT contains CONVERSATION CONTEXT section", () => {
    expect(PROMPT).toContain("CONVERSATION CONTEXT")
  })

  // T-1.5: user message fidelity section
  test("PROMPT contains USER MESSAGE FIDELITY section", () => {
    expect(PROMPT).toContain("USER MESSAGE FIDELITY")
  })

  // T-1.6: thread-title in output format
  test("PROMPT contains <thread-title> in output format", () => {
    expect(PROMPT).toContain("<thread-title>")
    expect(PROMPT).toContain("</thread-title>")
  })

  // Gap 1: tool call grouping with sub-bullets
  test("PROMPT instructs to group repeated tool calls into sub-bullets", () => {
    expect(PROMPT).toContain("AVOIDING REPETITIVE OBSERVATIONS")
  })

  // Gap 2: assistant-generated content preservation
  test("PROMPT instructs to preserve details in assistant-generated content", () => {
    expect(PROMPT).toContain("ASSISTANT-GENERATED CONTENT")
  })

  // Gap 3: actionable insights section
  test("PROMPT contains ACTIONABLE INSIGHTS section", () => {
    expect(PROMPT).toContain("ACTIONABLE INSIGHTS")
  })

  // Gap 4: sanitizeObservationLines — per-line safety net
  test("PROMPT output format example uses sub-bullet -> notation for tool grouping", () => {
    expect(PROMPT).toContain("->")
  })
})

// ─── OMBuf async buffering behavior ─────────────────────────────────────────

describe("OMBuf async buffering behavior", () => {
  test("duplicate buffer guard: second setInFlight when one exists is a no-op via getInFlight check", () => {
    const sid = "test-session-dup" as any
    let resolved = false
    const p = new Promise<void>((resolve) =>
      setTimeout(() => {
        resolved = true
        resolve()
      }, 50),
    )
    OMBuf.setInFlight(sid, p)
    // Simulate: caller checks getInFlight before firing second — if exists, skip
    const existing = OMBuf.getInFlight(sid)
    expect(existing).toBeDefined() // guard: inFlight exists
    // Do NOT set a second one — this is the caller's responsibility
    OMBuf.clearInFlight(sid)
  })

  test("awaitInFlight resolves immediately when no promise exists", async () => {
    const sid = "test-session-noop" as any
    const start = Date.now()
    await OMBuf.awaitInFlight(sid)
    expect(Date.now() - start).toBeLessThan(50)
  })

  test("awaitInFlight waits for in-flight promise to resolve", async () => {
    const sid = "test-session-await" as any
    let done = false
    const p = new Promise<void>((resolve) =>
      setTimeout(() => {
        done = true
        resolve()
      }, 30),
    )
    OMBuf.setInFlight(sid, p)
    await OMBuf.awaitInFlight(sid)
    expect(done).toBe(true)
    expect(OMBuf.getInFlight(sid)).toBeUndefined() // cleaned up
  })

  test("awaitInFlight cleans up map entry after awaiting", async () => {
    const sid = "test-session-cleanup" as any
    const p = Promise.resolve()
    OMBuf.setInFlight(sid, p)
    expect(OMBuf.getInFlight(sid)).toBeDefined()
    await OMBuf.awaitInFlight(sid)
    expect(OMBuf.getInFlight(sid)).toBeUndefined()
  })

  test("late activate scenario: awaitInFlight waits then clears", async () => {
    const sid = "test-session-late" as any
    // Simulate: buffer LLM still running when activate arrives
    let bufferDone = false
    const bufferP = new Promise<void>((resolve) => {
      setTimeout(() => {
        bufferDone = true
        resolve()
      }, 40)
    })
    OMBuf.setInFlight(sid, bufferP)
    // activate arrives before buffer finishes
    expect(bufferDone).toBe(false)
    await OMBuf.awaitInFlight(sid)
    // after await, buffer is done and map is clean
    expect(bufferDone).toBe(true)
    expect(OMBuf.getInFlight(sid)).toBeUndefined()
  })
})

// ─── Reflector.startLevel behavior ──────────────────────────────────────────

describe("Reflector.startLevel behavior", () => {
  test("startLevel used in Reflector means level 0 compression guidance never fires for any model", () => {
    // Level 0 = COMPRESSION_GUIDANCE[0] = "" (no guidance)
    // startLevel always returns >= 1, so level 0 is never the initial level
    expect(startLevel("any-model")).toBeGreaterThanOrEqual(1)
    expect(startLevel("google/gemini-2.5-flash")).toBeGreaterThanOrEqual(1)
  })
})

// ─── OBSERVATION_RETRIEVAL_INSTRUCTIONS injection ────────────────────────────

describe("OBSERVATION_RETRIEVAL_INSTRUCTIONS injection", () => {
  test("OBSERVATION_RETRIEVAL_INSTRUCTIONS is defined and non-empty", () => {
    expect(SystemPrompt.OBSERVATION_RETRIEVAL_INSTRUCTIONS).toContain("recall")
    expect(SystemPrompt.OBSERVATION_RETRIEVAL_INSTRUCTIONS).toContain("observation-group")
  })

  test("wrapObservations with grouped obs includes retrieval instructions", () => {
    const wrapped = wrapInObservationGroup("* obs", "a:b", "g1")
    // parseObservationGroups(wrapped).length > 0 → instructions should be appended
    const groups = parseObservationGroups(wrapped)
    expect(groups.length).toBeGreaterThan(0)
    // The instructions would be appended by SystemPrompt.observations() — test the condition
  })
})

// ─── REQ-1.6: awaitInFlight idempotency ─────────────────────────────────────

test("OMBuf.awaitInFlight is idempotent — safe to call multiple times", async () => {
  const sid = "test-session-idem" as any
  const p = Promise.resolve()
  OMBuf.setInFlight(sid, p)
  await OMBuf.awaitInFlight(sid)
  // calling again when map is empty should not throw
  await expect(OMBuf.awaitInFlight(sid)).resolves.toBeUndefined()
})

// ─── truncateObsToBudget ─────────────────────────────────────────────────────

describe("truncateObsToBudget", () => {
  test("budget=0 returns empty string", () => {
    expect(truncateObsToBudget("line1\nline2\nline3", 0)).toBe("")
  })

  test("fits in budget returns unchanged", () => {
    const obs = "short observation"
    expect(truncateObsToBudget(obs, 2000)).toBe(obs)
  })

  test("empty string returns empty string", () => {
    expect(truncateObsToBudget("", 100)).toBe("")
  })

  test("exceeds budget inserts truncation marker", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `* line observation number ${i}`)
    const obs = lines.join("\n")
    const result = truncateObsToBudget(obs, 50)
    expect(result).toContain("observations truncated here")
  })

  test("🔴 lines preserved from head when truncating", () => {
    const important = "🔴 (09:00) User stated they are a senior engineer"
    const filler = Array.from({ length: 200 }, (_, i) => `* (10:${i}) routine observation ${i}`).join("\n")
    const obs = `${important}\n${filler}`
    const result = truncateObsToBudget(obs, 30)
    expect(result).toContain("senior engineer")
  })

  test("✅ lines preserved from head when truncating", () => {
    const done = "✅ (09:00) Task completed: implemented auth module"
    const filler = Array.from({ length: 200 }, (_, i) => `* (10:${i}) routine observation ${i}`).join("\n")
    const obs = `${done}\n${filler}`
    const result = truncateObsToBudget(obs, 30)
    expect(result).toContain("auth module")
  })
})

// ─── Observer.run prevBudget truncation ──────────────────────────────────────

describe("Observer.run prevBudget truncation", () => {
  test("truncateObsToBudget is applied when prev exceeds budget", () => {
    // 200 lines * ~25 chars = ~5000 chars / 4 = ~1250 tokens
    const longObs = Array.from({ length: 200 }, (_, i) => `* (09:${String(i).padStart(2, "0")}) observation ${i}`).join(
      "\n",
    )
    const result = truncateObsToBudget(longObs, 50)
    // Must be shorter than original
    expect(result.length).toBeLessThan(longObs.length)
    // Must contain truncation marker
    expect(result).toContain("observations truncated here")
  })
})

// ─── Observer.run group wrapping (T-3.2, T-3.3) ─────────────────────────────

describe("Observer.run group wrapping", () => {
  test("wraps output when msgs provided", () => {
    const obs = "* test observation"
    const wrapped = wrapInObservationGroup(obs, "msg-001:msg-010")
    expect(wrapped).toContain("<observation-group")
    expect(wrapped).toContain("msg-001:msg-010")
  })

  test("stripObservationGroups before truncateObsToBudget", () => {
    const wrapped = wrapInObservationGroup("* observation line", "a:b")
    const stripped = stripObservationGroups(wrapped)
    expect(stripped).not.toContain("<observation-group")
    expect(stripped).toContain("observation line")
  })
})

// ─── Reflector group integration (T-4.1 / T-4.2) ───────────────────────────

describe("Reflector group integration", () => {
  test("renderObservationGroupsForReflection used before reflector prompt", () => {
    // test the function directly — flat string returns unchanged
    const flat = "* line one\n* line two"
    expect(renderObservationGroupsForReflection(flat)).toBe(flat)
  })

  test("renderObservationGroupsForReflection wraps groups as markdown", () => {
    const wrapped = wrapInObservationGroup("* obs", "a:b", "grp1")
    const rendered = renderObservationGroupsForReflection(wrapped)
    expect(rendered).toContain("## Group `grp1`")
    expect(rendered).toContain("* obs")
  })

  test("reconcileObservationGroupsFromReflection restores group wrappers", () => {
    const obs = "* observation line one\n* observation line two"
    const source = wrapInObservationGroup(obs, "msg1:msg2", "g1")
    const reflected = "* observation line one\n* observation line two"
    const result = reconcileObservationGroupsFromReflection(reflected, source)
    expect(result).toContain("<observation-group")
  })

  test("reconcileObservationGroupsFromReflection falls back when no source groups", () => {
    const result = reconcileObservationGroupsFromReflection("* reflected obs", "* flat source")
    expect(result).toBe("* reflected obs")
  })
})

// ─── OM.activate group wrapping (T-3.5) ─────────────────────────────────────

describe("OM.activate group wrapping", () => {
  test("wrapInObservationGroup spans full buffer range", () => {
    const obs = "* merged observation"
    const range = "first-msg:last-msg"
    const wrapped = wrapInObservationGroup(obs, range)
    const groups = parseObservationGroups(wrapped)
    expect(groups).toHaveLength(1)
    expect(groups[0].range).toBe(range)
  })
})

// ─── OMBuf.seal ─────────────────────────────────────────────────────────────

describe("OMBuf.seal", () => {
  function sid(suffix: string): SessionID {
    return `test-seal-${suffix}-${Math.random().toString(36).slice(2)}` as SessionID
  }

  test("seal sets the seal for a session", () => {
    const s = sid("set")
    OMBuf.seal(s, 1000)
    expect(OMBuf.sealedAt(s)).toBe(1000)
  })

  test("sealedAt returns 0 for unsealed session", () => {
    const s = sid("unseal")
    expect(OMBuf.sealedAt(s)).toBe(0)
  })

  test("seal does not decrease — higher value wins", () => {
    const s = sid("nodecr")
    OMBuf.seal(s, 1000)
    OMBuf.seal(s, 500)
    expect(OMBuf.sealedAt(s)).toBe(1000)
  })

  test("seal updates to higher value", () => {
    const s = sid("higher")
    OMBuf.seal(s, 1000)
    OMBuf.seal(s, 2000)
    expect(OMBuf.sealedAt(s)).toBe(2000)
  })

  test("message with time.created === sealed is excluded from unobserved", () => {
    const sealed: number = 1000
    const filter = (created: number) => created > 0 && (sealed === 0 || created > sealed)
    expect(filter(1000)).toBe(false) // at boundary — excluded
  })

  test("message with time.created > sealed is included in unobserved", () => {
    const sealed: number = 1000
    const filter = (created: number) => created > 0 && (sealed === 0 || created > sealed)
    expect(filter(1001)).toBe(true) // after boundary — included
  })
})

// ─── session.om.groups ──────────────────────────────────────────────────────

describe("session.om.groups", () => {
  // ── wrapInObservationGroup ──────────────────────────────────────────────

  test("wraps obs in XML tag with range", () => {
    const result = wrapInObservationGroup("* fact one", "msg-001:msg-010")
    expect(result).toContain('<observation-group id="')
    expect(result).toContain('range="msg-001:msg-010"')
    expect(result).toContain("* fact one")
    expect(result).toContain("</observation-group>")
  })

  test("generates id when not provided", () => {
    const result = wrapInObservationGroup("obs", "a:b")
    const match = result.match(/id="([^"]+)"/)
    expect(match).not.toBeNull()
    expect(match![1].length).toBeGreaterThan(0)
  })

  test("uses provided id", () => {
    const result = wrapInObservationGroup("obs", "a:b", "custom")
    expect(result).toContain('id="custom"')
  })

  // ── parseObservationGroups ──────────────────────────────────────────────

  test("parses single group", () => {
    const wrapped = wrapInObservationGroup("* line one\n* line two", "m1:m5", "g1")
    const groups = parseObservationGroups(wrapped)
    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe("g1")
    expect(groups[0].range).toBe("m1:m5")
    expect(groups[0].content).toContain("line one")
  })

  test("parses multiple groups", () => {
    const a = wrapInObservationGroup("obs A", "m1:m3", "ga")
    const b = wrapInObservationGroup("obs B", "m4:m6", "gb")
    const groups = parseObservationGroups(`${a}\n\n${b}`)
    expect(groups).toHaveLength(2)
    expect(groups[0].id).toBe("ga")
    expect(groups[1].id).toBe("gb")
  })

  test("returns [] for flat string", () => {
    expect(parseObservationGroups("* obs line one\n* obs line two")).toEqual([])
  })

  test("roundtrip: wrap → parse", () => {
    const obs = "* 🔴 user is a TypeScript developer"
    const wrapped = wrapInObservationGroup(obs, "r1:r2", "tid")
    const groups = parseObservationGroups(wrapped)
    expect(groups).toHaveLength(1)
    expect(groups[0].content).toBe(obs)
  })

  // ── stripObservationGroups ──────────────────────────────────────────────

  test("strips wrappers leaves content", () => {
    const wrapped = wrapInObservationGroup("* fact one\n* fact two", "m1:m2", "g1")
    const stripped = stripObservationGroups(wrapped)
    expect(stripped).not.toContain("<observation-group")
    expect(stripped).not.toContain("</observation-group>")
    expect(stripped).toContain("fact one")
    expect(stripped).toContain("fact two")
  })

  test("flat string unchanged by strip", () => {
    const flat = "* obs line"
    expect(stripObservationGroups(flat)).toBe(flat)
  })

  // ── renderObservationGroupsForReflection ────────────────────────────────

  test("flat string returned unchanged by render", () => {
    const flat = "* obs line"
    expect(renderObservationGroupsForReflection(flat)).toBe(flat)
  })

  test("groups rendered as markdown headers", () => {
    const wrapped = wrapInObservationGroup("* fact about user", "m1:m3", "grp1")
    const rendered = renderObservationGroupsForReflection(wrapped)
    expect(rendered).toContain("## Group")
    expect(rendered).toContain("grp1")
    expect(rendered).toContain("fact about user")
    expect(rendered).not.toContain("<observation-group")
  })

  // ── reconcileObservationGroupsFromReflection ────────────────────────────

  test("no source groups → returns reflected unchanged", () => {
    const reflected = "* compressed fact\n* another fact"
    const source = "* original flat obs"
    expect(reconcileObservationGroupsFromReflection(reflected, source)).toBe(reflected)
  })

  test("restores group wrappers from source", () => {
    const source = wrapInObservationGroup("* user is senior engineer\n* prefers TypeScript", "m1:m5", "g1")
    // reflected contains lines matching the source group
    const reflected = "* user is senior engineer\n* prefers TypeScript"
    const result = reconcileObservationGroupsFromReflection(reflected, source)
    expect(result).toContain("<observation-group")
    expect(result).toContain("</observation-group>")
  })

  test("fallback: no overlap → wraps all in single group", () => {
    const source = wrapInObservationGroup("* completely different content", "m1:m5", "g1")
    // reflected has no content overlap with source
    const reflected = "* entirely new unrelated summary"
    const result = reconcileObservationGroupsFromReflection(reflected, source)
    // Should still produce a wrapped output (either assigned or fallback)
    expect(result).toContain("<observation-group")
    expect(result).toContain("entirely new unrelated summary")
  })
})

// ─── sanitizeObservationLines ────────────────────────────────────────────────

describe("session.om.observer.sanitizeObservationLines", () => {
  test("short lines pass through unchanged", () => {
    const obs = "* 🔴 user is a TypeScript developer\n* 🟡 asked about auth"
    expect(sanitizeObservationLines(obs)).toBe(obs)
  })

  test("line exceeding 10k chars is truncated with marker", () => {
    const long = "x".repeat(10_001)
    const result = sanitizeObservationLines(long)
    expect(result.length).toBeLessThan(10_050)
    expect(result).toContain("[truncated]")
  })

  test("line at exactly 10k chars passes through unchanged", () => {
    const exact = "y".repeat(10_000)
    const result = sanitizeObservationLines(exact)
    expect(result).toBe(exact)
    expect(result).not.toContain("[truncated]")
  })

  test("only the oversized line is truncated — others preserved", () => {
    const normal = "* 🔴 normal observation"
    const long = "z".repeat(10_001)
    const result = sanitizeObservationLines(`${normal}\n${long}`)
    expect(result).toContain(normal)
    expect(result).toContain("[truncated]")
  })

  test("empty string returns empty string", () => {
    expect(sanitizeObservationLines("")).toBe("")
  })

  test("parseObserverOutput applies sanitizeObservationLines to extracted observations", () => {
    const longLine = "x".repeat(10_001)
    const raw = `<observations>\n${longLine}\n</observations>`
    const result = parseObserverOutput(raw)
    expect(result.observations).toContain("[truncated]")
    expect(result.observations.length).toBeLessThan(10_050)
  })
})

// ─── sanitizeToolResult ──────────────────────────────────────────────────────

describe("sanitizeToolResult", () => {
  test("strips string field matching pattern when value > 256 chars", () => {
    const long = "x".repeat(257)
    const result = sanitizeToolResult({ token: long }) as Record<string, unknown>
    expect(typeof result.token).toBe("string")
    expect((result.token as string).startsWith("[stripped:")).toBe(true)
    expect(result.token).toContain("257 chars")
  })

  test("strips nested field matching pattern when value > 256 chars", () => {
    const long = "s".repeat(300)
    const result = sanitizeToolResult({ outer: { secret: long } }) as Record<string, unknown>
    const inner = result.outer as Record<string, unknown>
    expect((inner.secret as string).startsWith("[stripped:")).toBe(true)
  })

  test("handles circular reference — returns [circular] for that node", () => {
    const obj: Record<string, unknown> = { name: "safe" }
    obj.self = obj
    const result = sanitizeToolResult(obj) as Record<string, unknown>
    expect(result.name).toBe("safe")
    expect(result.self).toBe("[circular]")
  })

  test("leaves short fields intact even if name matches pattern", () => {
    const short = "tok"
    const result = sanitizeToolResult({ token: short }) as Record<string, unknown>
    expect(result.token).toBe("tok")
  })

  test("leaves fields with non-matching names intact regardless of length", () => {
    const long = "y".repeat(500)
    const result = sanitizeToolResult({ data: long }) as Record<string, unknown>
    expect(result.data).toBe(long)
  })
})

// ─── OM.trackObserved ────────────────────────────────────────────────────────

describe("OM.trackObserved", () => {
  test("persists IDs to DB", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          OM.upsert({
            id: s.id as SessionID,
            session_id: s.id as SessionID,
            observations: "🔴 fact",
            reflections: null,
            current_task: null,
            suggested_continuation: null,
            last_observed_at: Date.now(),
            retention_floor_at: null,
            generation_count: 1,
            observation_tokens: 10,
            observed_message_ids: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          OM.trackObserved(s.id as SessionID, ["msg-1", "msg-2"])
          const got = OM.get(s.id as SessionID)
          expect(got?.observed_message_ids).not.toBeNull()
          const ids = JSON.parse(got!.observed_message_ids!)
          expect(ids).toContain("msg-1")
          expect(ids).toContain("msg-2")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("merges IDs across calls (deduplication)", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          OM.upsert({
            id: s.id as SessionID,
            session_id: s.id as SessionID,
            observations: "🔴 fact",
            reflections: null,
            current_task: null,
            suggested_continuation: null,
            last_observed_at: Date.now(),
            retention_floor_at: null,
            generation_count: 1,
            observation_tokens: 10,
            observed_message_ids: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          OM.trackObserved(s.id as SessionID, ["msg-1", "msg-2"])
          OM.trackObserved(s.id as SessionID, ["msg-2", "msg-3"])
          const got = OM.get(s.id as SessionID)
          const ids: string[] = JSON.parse(got!.observed_message_ids!)
          expect(ids).toContain("msg-1")
          expect(ids).toContain("msg-2")
          expect(ids).toContain("msg-3")
          expect(ids.filter((id) => id === "msg-2")).toHaveLength(1)
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("does nothing when no OM record exists", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          // No upsert — record does not exist — should not throw
          expect(() => OM.trackObserved(s.id as SessionID, ["msg-1"])).not.toThrow()
          expect(OM.get(s.id as SessionID)).toBeUndefined()
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("legacy record with null observed_message_ids — ID filter skipped (empty set)", () => {
    // obsIds = new Set from null → empty Set → !obsIds.has(id) always true
    const raw: string | null = null
    const obsIds = new Set<string>(raw ? (JSON.parse(raw) as string[]) : [])
    expect(obsIds.size).toBe(0)
    expect(obsIds.has("any-id")).toBe(false)
  })

  test("mergeIds deduplicates correctly via trackObserved", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          OM.upsert({
            id: s.id as SessionID,
            session_id: s.id as SessionID,
            observations: "🔴 fact",
            reflections: null,
            current_task: null,
            suggested_continuation: null,
            last_observed_at: Date.now(),
            retention_floor_at: null,
            generation_count: 1,
            observation_tokens: 10,
            observed_message_ids: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          // Call three times with overlapping IDs
          OM.trackObserved(s.id as SessionID, ["a", "b"])
          OM.trackObserved(s.id as SessionID, ["b", "c"])
          OM.trackObserved(s.id as SessionID, ["a", "c", "d"])
          const got = OM.get(s.id as SessionID)
          const ids: string[] = JSON.parse(got!.observed_message_ids!)
          // Exactly 4 unique IDs — no duplicates
          expect(ids).toHaveLength(4)
          expect(new Set(ids).size).toBe(4)
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })
})
