import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  balanceByCategory,
  balanceByFloorsAndCaps,
  buildReviewedSubset,
  buildSyntheticRows,
  computeManifest,
  computeManifestExtended,
  corpusPositiveToolId,
  dedupeRouterEvalRows,
  DEFAULT_CATEGORY_FLOORS,
  fnv1a32,
  labelFromCorpusTool,
  normalizePromptForDedupe,
  rowDedupeKey,
  selectReviewCandidates,
  tagSeedRows,
} from "../../src/session/router-eval-expand"
import { loadRouterEvalJsonl, parseRouterEvalLine } from "../../src/session/router-eval-types"

const seedFixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/router-eval.jsonl")

describe("router-eval-expand helpers", () => {
  test("fnv1a32 is deterministic", () => {
    expect(fnv1a32("a")).toBe(fnv1a32("a"))
    expect(fnv1a32("a")).not.toBe(fnv1a32("b"))
  })

  test("normalizePromptForDedupe collapses trivial differences", () => {
    expect(normalizePromptForDedupe("  Foo   BAR  ")).toBe(normalizePromptForDedupe("foo bar"))
  })

  test("dedupeRouterEvalRows keeps first occurrence", () => {
    const a = {
      id: "1",
      prompt: "x",
      agent: "build",
      available_tools: ["read"],
      required_tools: ["read"],
      source: "synthetic" as const,
    }
    const b = { ...a, id: "2" }
    expect(dedupeRouterEvalRows([a, b])).toHaveLength(1)
  })

  test("rowDedupeKey differs when required_tools differ", () => {
    const base = {
      id: "1",
      prompt: "same",
      agent: "build",
      available_tools: ["read", "grep"],
      required_tools: ["read"],
    }
    const r2 = { ...base, required_tools: ["grep"] }
    expect(rowDedupeKey(base as any)).not.toBe(rowDedupeKey(r2 as any))
  })

  test("corpusPositiveToolId reads head before dot", () => {
    expect(corpusPositiveToolId("read. Read-only")).toBe("read")
    expect(corpusPositiveToolId("apply_patch. Patch")).toBe("apply_patch")
  })

  test("labelFromCorpusTool maps apply_patch to edit+read", () => {
    const l = labelFromCorpusTool("apply_patch")
    expect("skip" in l).toBe(false)
    if ("skip" in l) return
    expect(l.required_tools).toEqual(["edit", "read"])
  })

  test("labelFromCorpusTool skips batch", () => {
    const l = labelFromCorpusTool("batch")
    expect("skip" in l && l.skip).toBe(true)
  })

  test("buildSyntheticRows is deterministic across runs", () => {
    const a = buildSyntheticRows().map((r) => r.id)
    const b = buildSyntheticRows().map((r) => r.id)
    expect(a).toEqual(b)
  })

  test("tagSeedRows sets source seed", () => {
    const rows = loadRouterEvalJsonl(
      '{"id":"z","prompt":"p","agent":"build","available_tools":["read"],"required_tools":["read"]}\n',
    )
    const t = tagSeedRows(rows)
    expect(t[0]?.source).toBe("seed")
  })

  test("balanceByCategory respects caps", () => {
    const rows = [
      { id: "a", category: "conversation", prompt: "x", agent: "build", available_tools: ["read"], required_tools: [] },
      { id: "b", category: "conversation", prompt: "y", agent: "build", available_tools: ["read"], required_tools: [] },
    ] as any[]
    const out = balanceByCategory(rows, { conversation: 1 })
    expect(out).toHaveLength(1)
  })

  test("computeManifest counts sources", () => {
    const m = computeManifest([
      {
        id: "1",
        prompt: "hola",
        agent: "build",
        available_tools: ["read"],
        required_tools: ["read"],
        source: "seed",
      },
    ] as any)
    expect(m.by_source.seed).toBe(1)
    expect(m.row_count).toBe(1)
  })

  test("parseRouterEvalLine accepts source and category", () => {
    const line = JSON.stringify({
      id: "t",
      prompt: "p",
      agent: "build",
      available_tools: ["read"],
      required_tools: ["read"],
      source: "synthetic",
      category: "bash_gate",
    })
    const r = parseRouterEvalLine(line)
    expect(r?.source).toBe("synthetic")
    expect(r?.category).toBe("bash_gate")
  })

  test("parseRouterEvalLine accepts confidence and reviewed", () => {
    const r = parseRouterEvalLine(
      JSON.stringify({
        id: "r",
        prompt: "p",
        agent: "build",
        available_tools: ["read"],
        required_tools: ["read"],
        confidence: "high",
        reviewed: true,
      }),
    )
    expect(r?.confidence).toBe("high")
    expect(r?.reviewed).toBe(true)
  })

  test("balanceByFloorsAndCaps pulls floor before cap trim", () => {
    const rows = [
      { id: "c1", category: "conflict_gate", prompt: "a", agent: "build", available_tools: ["read"], required_tools: ["read"] },
      { id: "c2", category: "conflict_gate", prompt: "b", agent: "build", available_tools: ["read"], required_tools: ["read"] },
      { id: "x1", category: "conversation", prompt: "c", agent: "build", available_tools: ["read"], required_tools: [] },
    ] as any[]
    const out = balanceByFloorsAndCaps(rows, { conflict_gate: 2, conversation: 0 }, { conflict_gate: 2, conversation: 1 })
    expect(out.map((r) => r.id).sort()).toContain("c1")
    expect(out.map((r) => r.id).sort()).toContain("c2")
  })

  test("buildReviewedSubset is deterministic and excludes sampled_heuristic", () => {
    const seed = tagSeedRows(loadRouterEvalJsonl(readFileSync(seedFixture, "utf8")))
    const sampled = [
      {
        id: "sam",
        prompt: "corpus line",
        agent: "build",
        available_tools: ["read"],
        required_tools: ["read"],
        source: "sampled_heuristic" as const,
        category: "sampled_heuristic",
      },
    ]
    const merged = [...seed, ...buildSyntheticRows(), ...sampled]
    const a = buildReviewedSubset(merged)
    const b = buildReviewedSubset(merged)
    expect(a.map((r) => r.id).join()).toBe(b.map((r) => r.id).join())
    expect(a.some((r) => r.source === "sampled_heuristic")).toBe(false)
    expect(a.every((r) => r.reviewed === true)).toBe(true)
    expect(a.length).toBeGreaterThanOrEqual(80)
    expect(a.length).toBeLessThanOrEqual(150)
  })

  test("selectReviewCandidates prioritizes sampled and short prompts", () => {
    const c = selectReviewCandidates([
      {
        id: "a",
        prompt: "x",
        agent: "build",
        available_tools: ["read", "grep", "bash"],
        required_tools: ["read", "grep", "bash"],
        source: "sampled_heuristic",
        category: "edge",
      },
      {
        id: "b",
        prompt: "a much longer prompt that should not score as high unless other signals",
        agent: "build",
        available_tools: ["read"],
        required_tools: ["read"],
        source: "seed",
        category: "seed",
      },
    ] as any)
    expect(c.length).toBeGreaterThanOrEqual(1)
    expect(c[0]?.id).toBe("a")
  })

  test("computeManifestExtended includes gaps when below floor", () => {
    const m = computeManifestExtended(
      [{ id: "1", prompt: "p", agent: "build", available_tools: ["read"], required_tools: ["read"], category: "conflict_gate" }] as any,
      DEFAULT_CATEGORY_FLOORS,
    )
    expect(m.category_vs_floor.conflict_gate?.gap).toBeGreaterThan(0)
    expect(m.underrepresented_categories.includes("conflict_gate")).toBe(true)
  })
})
