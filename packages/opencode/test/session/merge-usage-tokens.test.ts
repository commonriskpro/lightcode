import { describe, expect, test } from "bun:test"
import { Session } from "../../src/session"

describe("Session.mergeUsageTokens", () => {
  const base = () => ({
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  })

  test("sums components when a later step is much smaller than an earlier one", () => {
    const large = { ...base(), input: 9800, output: 200, total: 10_000 }
    const small = { ...base(), input: 200, output: 44, total: 244 }
    const merged = Session.mergeUsageTokens(large, small)
    expect(merged.input).toBe(10_000)
    expect(merged.output).toBe(244)
    expect(merged.total).toBe(10_244)
  })

  test("leaves total undefined when both steps omit provider total", () => {
    const a = { ...base(), input: 100, output: 10 }
    const b = { ...base(), input: 5, output: 2 }
    const merged = Session.mergeUsageTokens(a, b)
    expect(merged.total).toBeUndefined()
    expect(merged.input).toBe(105)
    expect(merged.output).toBe(12)
  })
})
