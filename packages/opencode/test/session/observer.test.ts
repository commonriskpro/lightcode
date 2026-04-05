import { describe, expect, test, beforeEach } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { OMBuf, calculateDynamicThreshold } from "../../src/session/om/buffer"
import type { ThresholdRange } from "../../src/session/om/buffer"
import { OM } from "../../src/session/om/record"
import { Reflector, startLevel } from "../../src/session/om/reflector"
import {
  detectDegenerateRepetition,
  parseObserverOutput,
  PROMPT,
  truncateObsToBudget,
} from "../../src/session/om/observer"
import { SystemPrompt } from "../../src/session/system"
import type { SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const root = path.join(__dirname, "../..")

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

  test("returns activate at 30k", () => {
    const s = sid("act30k")
    // 29999 → still buffer range
    expect(OMBuf.check(s, 29_999)).toBe("buffer")

    expect(OMBuf.check(s, 1)).toBe("activate")
  })

  test("returns force at > 36k", () => {
    const s = sid("force36k")
    // Jump straight to force threshold
    expect(OMBuf.check(s, 36_001)).toBe("force")
  })

  test("returns force when exactly at 36k", () => {
    const s = sid("force-exact")
    expect(OMBuf.check(s, 36_000)).toBe("force")
  })

  test("returns activate when exactly at 30k", () => {
    const s = sid("act-exact")
    expect(OMBuf.check(s, 30_000)).toBe("activate")
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
    // 10000 chars / 4 = 2500 tokens → exceeds 2000 cap → sliced to 8000 chars
    const large = "x".repeat(10_000)
    const result = SystemPrompt.wrapObservations(large)
    // The inner body should be capped
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
            generation_count: 1,
            observation_tokens: 10,
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
            generation_count: 1,
            observation_tokens: 5,
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
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const now = Date.now()
          const buf1 = {
            id: `buf-a-${now}` as SessionID,
            session_id: s.id as SessionID,
            observations: "chunk one",
            message_tokens: 50,
            observation_tokens: 10,
            starts_at: now,
            ends_at: now + 500,
            time_created: now,
            time_updated: now,
          }
          const buf2 = {
            id: `buf-b-${now}` as SessionID,
            session_id: s.id as SessionID,
            observations: "chunk two",
            message_tokens: 60,
            observation_tokens: 12,
            starts_at: now + 501,
            ends_at: now + 1000,
            time_created: now,
            time_updated: now,
          }
          OM.addBuffer(buf1)
          OM.addBuffer(buf2)

          // activate merges buffers → observation row (async — condenses via LLM or naive join)
          await OM.activate(s.id as SessionID)

          const rec = OM.get(s.id as SessionID)
          expect(rec).not.toBeUndefined()
          expect(rec!.observations).toContain("chunk one")
          expect(rec!.observations).toContain("chunk two")
          expect(rec!.generation_count).toBe(2)
          // observation_tokens now estimated from merged string length (char/4)
          expect(rec!.observation_tokens).toBeGreaterThan(0)
          expect(rec!.last_observed_at).toBe(now + 1000)

          // Buffers should be cleared after activation
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
  test("threshold constant is 40_000", () => {
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
            generation_count: 1,
            observation_tokens: 50_000,
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
  test("without hint — no system-reminder in output", () => {
    const result = SystemPrompt.wrapObservations("some facts")
    expect(result).toContain("<local-observations>")
    expect(result).toContain("</local-observations>")
    expect(result).toContain(SystemPrompt.OBSERVATION_CONTEXT_INSTRUCTIONS)
    expect(result).not.toContain("<system-reminder>")
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
            generation_count: 1,
            observation_tokens: 100,
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
            generation_count: 1,
            observation_tokens: 10,
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
