/**
 * Mirrors the intent ranking math in `classifyIntentEmbed` (max dot per intent, then best intent)
 * using synthetic vectors so tests do not load @huggingface/transformers. Production `router-embed.ts` is unchanged.
 */
import { describe, expect, test } from "bun:test"
import type { IntentPrototype } from "../../src/session/router-embed"

function dot(a: Float32Array, b: Float32Array) {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

/** Same control flow as `classifyIntentEmbed` inner loop; test-only. */
function rankIntentByCosine(
  userVec: Float32Array,
  prototypes: IntentPrototype[],
  getPhrase: (label: string, phrase: string) => Float32Array,
) {
  let best: { label: string; score: number; add: string[] } | undefined
  for (const p of prototypes) {
    let maxPhrase = -1
    for (const phrase of p.phrases) {
      const v = getPhrase(p.label, phrase)
      const s = dot(userVec, v)
      if (s > maxPhrase) maxPhrase = s
    }
    if (maxPhrase < 0) continue
    if (!best || maxPhrase > best.score) best = { label: p.label, score: maxPhrase, add: p.add }
  }
  return best
}

function unit(dim: number, i: number) {
  const a = new Float32Array(dim)
  a[i] = 1
  return a
}

describe("intent ranking (test mirror of router cosine logic)", () => {
  test("picks intent whose prototype phrase aligns with user vector", () => {
    const dim = 8
    const conv = unit(dim, 0)
    const work = unit(dim, 1)
    const prototypes: IntentPrototype[] = [
      { label: "conversation", add: [], phrases: ["a"] },
      { label: "edit/refactor", add: ["edit"], phrases: ["b"] },
    ]
    const vecs: Record<string, Float32Array> = {
      "conversation|a": conv,
      "edit/refactor|b": work,
    }
    const getPhrase = (label: string, phrase: string) => vecs[`${label}|${phrase}`]!
    const u = unit(dim, 0)
    const best = rankIntentByCosine(u, prototypes, getPhrase)
    expect(best?.label).toBe("conversation")
    expect(best?.score).toBeCloseTo(1, 5)
  })

  test("maxes over several phrases per intent before comparing intents", () => {
    const dim = 4
    const prototypes: IntentPrototype[] = [
      {
        label: "weak",
        add: [],
        phrases: ["x", "y"],
      },
      {
        label: "strong",
        add: [],
        phrases: ["z"],
      },
    ]
    const e0 = unit(dim, 0)
    const e1 = unit(dim, 1)
    const e2 = unit(dim, 2)
    const vecs: Record<string, Float32Array> = {
      "weak|x": e0,
      "weak|y": e2,
      "strong|z": e1,
    }
    const getPhrase = (label: string, phrase: string) => vecs[`${label}|${phrase}`]!
    const u = unit(dim, 1)
    const best = rankIntentByCosine(u, prototypes, getPhrase)
    expect(best?.label).toBe("strong")
    expect(best?.score).toBeCloseTo(1, 5)
  })

  test("returns add ids from winning intent for router wiring", () => {
    const dim = 3
    const prototypes: IntentPrototype[] = [
      { label: "conversation", add: [], phrases: ["c"] },
      { label: "test", add: ["bash", "read"], phrases: ["t"] },
    ]
    const vecs: Record<string, Float32Array> = {
      "conversation|c": unit(dim, 0),
      "test|t": unit(dim, 1),
    }
    const getPhrase = (label: string, phrase: string) => vecs[`${label}|${phrase}`]!
    const best = rankIntentByCosine(unit(dim, 1), prototypes, getPhrase)
    expect(best?.add).toEqual(["bash", "read"])
  })

  test("returns undefined for empty prototypes", () => {
    const best = rankIntentByCosine(new Float32Array([1, 0]), [], () => new Float32Array([1, 0]))
    expect(best).toBeUndefined()
  })
})
