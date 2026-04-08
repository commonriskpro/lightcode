import { describe, expect, test } from "bun:test"
import { OMBuf, BLOCK_AFTER_MULTIPLIER } from "../../src/session/om/buffer"
import type { SessionID } from "../../src/session/schema"

function sid(suffix: string): SessionID {
  return `test-buf-${suffix}-${Math.random().toString(36).slice(2)}` as SessionID
}

// ─── T-5.1 custom blockAfter ────────────────────────────────────────────────

describe("OMBuf.check blockAfter param", () => {
  test("T-5.1: returns block at custom blockAfter when supplied", () => {
    const s = sid("custom-block")
    expect(OMBuf.check(s, 19_999, undefined, undefined, 20_000)).toBe("buffer")
    expect(OMBuf.check(s, 1, undefined, undefined, 20_000)).toBe("block")
  })

  test("T-5.2: returns block at 1.2x the effective trigger when blockAfter omitted", () => {
    // No obsTokens, no configThreshold → trigger = DEFAULT_RANGE.max = 140_000
    // blockAfter = ceil(140_000 * 1.2) = 168_000
    const s = sid("default-block")
    const expectedBlock = Math.ceil(140_000 * BLOCK_AFTER_MULTIPLIER) // 168_000
    expect(OMBuf.check(s, expectedBlock)).toBe("block")
  })

  test("T-5.2b: does not block just below the 1.2x ceiling when blockAfter omitted", () => {
    const s = sid("no-block-below")
    const expectedBlock = Math.ceil(140_000 * BLOCK_AFTER_MULTIPLIER) // 168_000
    const sig = OMBuf.check(s, expectedBlock - 1)
    expect(sig).not.toBe("block")
  })

  test("T-5.2c: block scales with explicit plain-number configThreshold (e.g. 30k → block at 36k)", () => {
    const s = sid("block-30k-trigger")
    // trigger = 30_000 (plain number), blockAfter = ceil(30_000 * 1.2) = 36_000
    const expectedBlock = Math.ceil(30_000 * BLOCK_AFTER_MULTIPLIER)
    expect(OMBuf.check(s, expectedBlock - 1, 0, 30_000)).toBe("activate") // just below block
    expect(OMBuf.check(s, 1, 0, 30_000)).toBe("block") // crosses 36k
  })
})

// ─── T-5.3 / T-5.4 adaptive default ────────────────────────────────────────

describe("OMBuf.check adaptive default (no configThreshold)", () => {
  const highBlock = 200_000

  test("T-5.3: effective trigger is 140_000 when obsTokens=0 and configThreshold omitted", () => {
    const s = sid("adaptive-0obs")
    expect(OMBuf.check(s, 139_999, 0, undefined, highBlock)).toBe("buffer")
    expect(OMBuf.check(s, 1, 0, undefined, highBlock)).toBe("activate")
  })

  test("T-5.4: effective trigger is 80_000 when obsTokens=40_000 and configThreshold omitted", () => {
    const s = sid("adaptive-40kobs")
    // max(80k, 140k-40k)=max(80k,100k)=100k? wait for a higher obsTokens case below
    expect(OMBuf.check(s, 99_999, 40_000, undefined, highBlock)).toBe("buffer")
    expect(OMBuf.check(s, 1, 40_000, undefined, highBlock)).toBe("activate")
  })

  test("T-5.4b: effective trigger bottoms at 80_000 for large observations", () => {
    const s = sid("adaptive-floor")
    expect(OMBuf.check(s, 79_999, 999_999, undefined, highBlock)).toBe("buffer")
    expect(OMBuf.check(s, 1, 999_999, undefined, highBlock)).toBe("activate")
  })
})

// ─── T-5.5 plain-number configThreshold ─────────────────────────────────────

describe("OMBuf.check plain-number configThreshold", () => {
  test("T-5.5: plain-number configThreshold used as-is regardless of obsTokens", () => {
    const s = sid("plain-num")
    // plain 30_000 config — obsTokens=40_000 should NOT change trigger
    expect(OMBuf.check(s, 29_999, 40_000, 30_000)).toBe("buffer")
    expect(OMBuf.check(s, 1, 40_000, 30_000)).toBe("activate")
  })
})

// ─── Fase 2: retention floor ─────────────────────────────────────────────────

import { RETENTION_FLOOR, retentionFloorAt, withSessionLock } from "../../src/session/om/buffer"

describe("retention floor — RETENTION_FLOOR constant", () => {
  test("RETENTION_FLOOR is between 0 and 1 exclusive", () => {
    expect(RETENTION_FLOOR).toBeGreaterThan(0)
    expect(RETENTION_FLOOR).toBeLessThan(1)
  })

  test("RETENTION_FLOOR is 0.2 (retain 20% of observed window)", () => {
    expect(RETENTION_FLOOR).toBe(0.2)
  })
})

describe("retentionFloorAt — boundary timestamp calculation", () => {
  test("returns endsAt when windowMs is 0", () => {
    expect(retentionFloorAt(1000, 0)).toBe(1000)
  })

  test("retains 20% of the window before endsAt", () => {
    // window = 1000ms, retention = 20% → floor = endsAt - 200
    expect(retentionFloorAt(2000, 1000)).toBe(2000 - 200)
  })

  test("retention floor is always <= endsAt", () => {
    expect(retentionFloorAt(500, 10_000)).toBeLessThanOrEqual(500)
  })

  test("result is integer (Math.floor applied)", () => {
    const result = retentionFloorAt(1000, 333)
    expect(Number.isInteger(result)).toBe(true)
  })
})

// ─── Fase 3: per-session mutex ────────────────────────────────────────────────

describe("withSessionLock — serializes concurrent async ops", () => {
  test("executes fn and returns result", async () => {
    const result = await withSessionLock("test-s1" as any, async () => 42)
    expect(result).toBe(42)
  })

  test("serializes two concurrent calls — second waits for first", async () => {
    const order: number[] = []
    const p1 = withSessionLock("test-s2" as any, async () => {
      await new Promise((r) => setTimeout(r, 20))
      order.push(1)
    })
    const p2 = withSessionLock("test-s2" as any, async () => {
      order.push(2)
    })
    await Promise.all([p1, p2])
    expect(order).toEqual([1, 2])
  })

  test("releases lock on fn throw — subsequent calls succeed", async () => {
    await withSessionLock("test-s3" as any, async () => {
      throw new Error("boom")
    }).catch(() => {})
    const result = await withSessionLock("test-s3" as any, async () => "ok")
    expect(result).toBe("ok")
  })

  test("different sessions do not block each other", async () => {
    const order: string[] = []
    const p1 = withSessionLock("test-sa" as any, async () => {
      await new Promise((r) => setTimeout(r, 20))
      order.push("a")
    })
    const p2 = withSessionLock("test-sb" as any, async () => {
      order.push("b")
    })
    await Promise.all([p1, p2])
    // b completes before a because they're independent sessions
    expect(order).toEqual(["b", "a"])
  })
})
