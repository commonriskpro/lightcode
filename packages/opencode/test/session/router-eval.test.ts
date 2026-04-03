import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadRouterEvalJsonl, parseRouterEvalLine } from "../../src/session/router-eval-types"
import {
  aggregateByCategory,
  aggregateBySource,
  aggregateExtrasAnalysis,
  aggregateExtrasCost,
  aggregateGlobal,
  countForbiddenSelections,
  missedAllRequired,
  precisionRecall,
  rankWorst,
  rowFailureHint,
  scoreRouterRow,
  accumulateToolMicro,
} from "../../src/session/router-eval-score"
import { getToolCostCatalog } from "../../src/session/router-eval-tool-cost"

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/router-eval.jsonl")

describe("router-eval dataset", () => {
  test("parseRouterEvalLine skips empty and comments", () => {
    expect(parseRouterEvalLine("")).toBeUndefined()
    expect(parseRouterEvalLine("# comment")).toBeUndefined()
  })

  test("loadRouterEvalJsonl reads fixture", () => {
    const raw = readFileSync(fixture, "utf8")
    const rows = loadRouterEvalJsonl(raw)
    expect(rows.length).toBeGreaterThanOrEqual(40)
    expect(rows[0]?.id).toBeDefined()
    expect(rows[0]?.available_tools?.length).toBeGreaterThan(0)
  })
})

describe("scoreRouterRow", () => {
  test("pass when required met and no forbidden", () => {
    const row = {
      id: "t",
      prompt: "x",
      agent: "build",
      available_tools: ["read", "grep", "bash"],
      required_tools: ["read"],
      forbidden_tools: ["bash"],
    }
    const s = scoreRouterRow(row, ["read", "grep"], "full")
    expect(s.pass).toBe(true)
    expect(s.exact).toBe(false)
    expect(s.extras).toEqual(["grep"])
  })

  test("exact when only required and allowed", () => {
    const row = {
      id: "t",
      prompt: "x",
      agent: "build",
      available_tools: ["read", "grep"],
      required_tools: ["read"],
      allowed_tools: ["grep"],
      forbidden_tools: [],
    }
    const s = scoreRouterRow(row, ["read", "grep"], "full")
    expect(s.pass).toBe(true)
    expect(s.exact).toBe(true)
    expect(s.extras).toEqual([])
  })

  test("fail when forbidden selected", () => {
    const row = {
      id: "t",
      prompt: "x",
      agent: "build",
      available_tools: ["read", "bash"],
      required_tools: ["read"],
      forbidden_tools: ["bash"],
    }
    const s = scoreRouterRow(row, ["read", "bash"], "full")
    expect(s.pass).toBe(false)
    expect(s.forbidden_selected).toEqual(["bash"])
  })

  test("expect_conversation: pass when empty selection", () => {
    const row = {
      id: "c",
      prompt: "hi",
      agent: "build",
      available_tools: ["read"],
      required_tools: [],
      expect_conversation: true,
    }
    const s = scoreRouterRow(row, [], "conversation")
    expect(s.pass).toBe(true)
    expect(s.conversation_tool_violation).toBe(false)
  })

  test("expect_conversation: violation when tools present", () => {
    const row = {
      id: "c",
      prompt: "hi",
      agent: "build",
      available_tools: ["read"],
      required_tools: [],
      expect_conversation: true,
    }
    const s = scoreRouterRow(row, ["read"], "full")
    expect(s.pass).toBe(false)
    expect(s.conversation_tool_violation).toBe(true)
  })
})

describe("aggregateBySource", () => {
  test("groups by row source", () => {
    const a = {
      id: "a",
      prompt: "x",
      agent: "build",
      available_tools: ["read"],
      required_tools: ["read"],
      source: "seed" as const,
    }
    const b = {
      id: "b",
      prompt: "y",
      agent: "build",
      available_tools: ["read"],
      required_tools: ["read"],
      source: "synthetic" as const,
    }
    const dataset = [a, b]
    const rows = [
      { ...scoreRouterRow(a, ["read"], "full"), id: "a" },
      { ...scoreRouterRow(b, [], "full"), id: "b" },
    ]
    const agg = aggregateBySource(rows, dataset)
    const seed = agg.find((x) => x.source === "seed")
    const syn = agg.find((x) => x.source === "synthetic")
    expect(seed?.pass).toBe(1)
    expect(syn?.pass).toBe(0)
  })
})

describe("getToolCostCatalog", () => {
  test("ranks by total_est_bytes descending", () => {
    const cat = getToolCostCatalog()
    expect(cat.length).toBeGreaterThan(3)
    for (let i = 0; i < cat.length - 1; i++) {
      expect(cat[i]!.total_est_bytes).toBeGreaterThanOrEqual(cat[i + 1]!.total_est_bytes)
    }
    expect(cat[0]!.cost_rank).toBe(1)
  })
})

describe("aggregateExtrasCost", () => {
  test("attributes bytes to extra tools", () => {
    const row = {
      id: "r",
      prompt: "x",
      agent: "build",
      available_tools: ["read", "grep", "task"],
      required_tools: ["read"],
    }
    const ev = scoreRouterRow(row, ["read", "grep", "task"], "full")
    const c = aggregateExtrasCost([ev], [row])
    expect(c.rows_non_conversation).toBe(1)
    expect(c.total_extra_bytes_summed).toBeGreaterThan(0)
    const g = c.extra_tool_by_cost.find((x) => x.tool === "grep")
    const t = c.extra_tool_by_cost.find((x) => x.tool === "task")
    expect(g?.occurrences).toBe(1)
    expect(t?.occurrences).toBe(1)
    expect(c.by_bucket.some((b) => b.occurrences > 0)).toBe(true)
  })
})

describe("aggregateExtrasAnalysis", () => {
  test("counts extras and histogram on non-conversation rows", () => {
    const row = {
      id: "r",
      prompt: "x",
      agent: "build",
      available_tools: ["read", "grep", "task"],
      required_tools: ["read"],
    }
    const ev = scoreRouterRow(row, ["read", "grep", "task"], "full")
    const x = aggregateExtrasAnalysis([ev], [row])
    expect(x.non_conversation_rows).toBe(1)
    expect(x.rows_with_extras).toBe(1)
    expect(x.extras_by_tool.some((t) => t.tool === "task")).toBe(true)
    expect(x.extras_histogram.some((h) => h.extras_count === 2 && h.rows === 1)).toBe(true)
  })
})

describe("aggregateByCategory", () => {
  test("groups by row category", () => {
    const a = {
      id: "a",
      prompt: "x",
      agent: "build",
      available_tools: ["read"],
      required_tools: ["read"],
      category: "bash_gate",
    }
    const b = {
      id: "b",
      prompt: "y",
      agent: "build",
      available_tools: ["read"],
      required_tools: ["read"],
      category: "bash_gate",
    }
    const dataset = [a, b]
    const rows = [
      { ...scoreRouterRow(a, ["read"], "full"), id: "a" },
      { ...scoreRouterRow(b, [], "full"), id: "b" },
    ]
    const agg = aggregateByCategory(rows, dataset)
    const bg = agg.find((x) => x.category === "bash_gate")
    expect(bg?.total).toBe(2)
    expect(bg?.pass).toBe(1)
    expect(bg?.pass_rate).toBeCloseTo(0.5)
  })
})

describe("rowFailureHint", () => {
  test("describes forbidden and missing", () => {
    const row = {
      id: "x",
      prompt: "p",
      agent: "build",
      available_tools: ["read", "bash"],
      required_tools: ["read"],
      forbidden_tools: ["bash"],
    }
    const ev = scoreRouterRow(row, ["bash"], "full")
    expect(rowFailureHint(row, ev)).toContain("forbidden:bash")
    expect(rowFailureHint(row, ev)).toContain("missing:read")
  })
})

describe("aggregateGlobal", () => {
  test("aggregates pass and exact", () => {
    const ds = [
      { id: "a", prompt: "", agent: "b", available_tools: ["read"], required_tools: ["read"] },
      { id: "b", prompt: "", agent: "b", available_tools: ["read"], required_tools: ["read"] },
    ]
    const rows = [
      scoreRouterRow(ds[0]!, ["read"], "full"),
      scoreRouterRow(ds[1]!, [], "minimal"),
    ]
    const g = aggregateGlobal(rows, ds as any)
    expect(g.total).toBe(2)
    expect(g.pass_count).toBe(1)
  })
})

describe("missedAllRequired", () => {
  test("true when all required missing", () => {
    const row = {
      id: "x",
      prompt: "",
      agent: "b",
      available_tools: ["read", "grep"],
      required_tools: ["read", "grep"],
    }
    const ev = scoreRouterRow(row, [], "full")
    expect(missedAllRequired(row, ev)).toBe(true)
  })
})

describe("rankWorst", () => {
  test("orders by forbidden count", () => {
    const ds: any[] = []
    const rows = [
      { id: "a", selected: [], context_tier: "full", pass: false, exact: false, missing_required: [], forbidden_selected: ["bash"], extras: [], over_selection: 0, under_selection: 1, conversation_tool_violation: false },
      { id: "b", selected: [], context_tier: "full", pass: false, exact: false, missing_required: [], forbidden_selected: ["bash", "edit"], extras: [], over_selection: 0, under_selection: 2, conversation_tool_violation: false },
    ]
    const w = rankWorst(rows as any, ds)
    expect(w.by_forbidden[0]?.id).toBe("b")
  })
})

describe("countForbiddenSelections", () => {
  test("sums forbidden tool ids", () => {
    const rows = [
      { id: "1", forbidden_selected: ["bash", "websearch"] },
      { id: "2", forbidden_selected: ["bash"] },
    ] as any
    const c = countForbiddenSelections(rows)
    expect(c.bash).toBe(2)
    expect(c.websearch).toBe(1)
  })
})

describe("precisionRecall", () => {
  test("tp=0 fp=0 gives precision 1", () => {
    expect(precisionRecall({ tp: 0, fp: 0, fn: 0 }).precision).toBe(1)
  })

  test("tp=1 fp=1 fn=0", () => {
    const p = precisionRecall({ tp: 1, fp: 1, fn: 0 })
    expect(p.precision).toBe(0.5)
    expect(p.recall).toBe(1)
  })
})

describe("accumulateToolMicro", () => {
  test("required tool fn when missing", () => {
    const acc = new Map()
    const row = {
      id: "r",
      prompt: "",
      agent: "b",
      available_tools: ["read"],
      required_tools: ["read"],
    }
    accumulateToolMicro(acc, row, [])
    expect(acc.get("read")?.fn).toBe(1)
  })
})
