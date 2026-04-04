import { describe, expect, test, beforeEach } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { OMBuf } from "../../src/session/om/buffer"
import { OM } from "../../src/session/om/record"
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
    expect(result).toBe(`<local-observations>\n${body}\n</local-observations>`)
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
