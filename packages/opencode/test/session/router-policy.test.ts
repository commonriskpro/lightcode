import { describe, expect, test } from "bun:test"
import {
  applyRouterPolicy,
  lexicalSignals,
  lexicalSignalsMerged,
  negatesTaskDelegation,
} from "../../src/session/router-policy"

describe("lexicalSignals webResearch", () => {
  test("false when user forbids web search", () => {
    const s = lexicalSignals("Never use web search; only use the repo. Summarize AGENTS.md")
    expect(s.webResearch).toBe(false)
  })

  test("true for genuine web research ask", () => {
    const s = lexicalSignals("Search the web for the latest Drizzle ORM migration guide")
    expect(s.webResearch).toBe(true)
  })

  test("true when look up and online are separated by words", () => {
    const s = lexicalSignals("Look up best practices for Zod v4 migrations online (eval-syn-33)")
    expect(s.webResearch).toBe(true)
  })

  test("false for bare internet mention without search/doc phrasing", () => {
    expect(lexicalSignals("internet").webResearch).toBe(false)
    expect(lexicalSignals("habla de internet").webResearch).toBe(false)
    expect(lexicalSignals("en internet").webResearch).toBe(false)
  })

  test("true for busca en internet with doc intent", () => {
    expect(lexicalSignals("Busca en internet documentacion oficial de Postgres").webResearch).toBe(true)
  })

  test("true for documentación oficial sobre (reviewed-style)", () => {
    expect(lexicalSignals("Busca documentación oficial sobre advisory locks en Postgres").webResearch).toBe(true)
  })
})

describe("lexicalSignals codesearch vs grep cues", () => {
  test("semantic by-meaning keeps codesearch intent", () => {
    const s = lexicalSignals("Find by meaning where we handle tool router configuration")
    expect(s.semanticSearch).toBe(true)
    expect(s.codesearchIntent).toBe(true)
  })

  test("Spanish por significado", () => {
    const s = lexicalSignals("Por significado: donde está el offline router (eval-syn-39)")
    expect(s.semanticSearch).toBe(true)
    expect(s.codesearchIntent).toBe(true)
  })
})

describe("lexicalSignals bash ES", () => {
  test("ejecuta triggers strong bash", () => {
    const s = lexicalSignals("Ejecuta git status y muestra cambios")
    expect(s.strongBash).toBe(true)
  })
})

describe("lexicalSignals question edge", () => {
  test("¿? with trailing tag still questions", () => {
    expect(lexicalSignals("¿? (eval-syn-52)").questionIntent).toBe(true)
  })

  test("this (…) referent keeps question intent", () => {
    expect(lexicalSignals("this (eval-syn-224)").questionIntent).toBe(true)
  })
})

describe("lexicalSignals seed write/edit cues", () => {
  test("create a new test file triggers strongWrite", () => {
    expect(
      lexicalSignals("Find where this symbol is used and create a new test file for it").strongWrite,
    ).toBe(true)
  })

  test("apply edits and search_replace cue strongEdit", () => {
    const s = lexicalSignals("Apply edits across three files using search_replace style changes")
    expect(s.strongEdit).toBe(true)
  })

  test("crea un archivo triggers strongWrite", () => {
    expect(lexicalSignals("Crea un archivo nuevo reporte.md con el resumen").strongWrite).toBe(true)
  })

  test("créame un archivo que se llame hecho.md en el root del repo triggers strongWrite", () => {
    expect(
      lexicalSignals("créame un archivo que se llame hecho.md en el root del repo").strongWrite,
    ).toBe(true)
  })

  test("create a file named done.md in the repo root triggers strongWrite", () => {
    expect(lexicalSignals("create a file named done.md in the repo root").strongWrite).toBe(true)
  })
})

describe("lexicalSignalsMerged", () => {
  test("ORs per-clause signals for multi-step prompts", () => {
    const full = "Read foo.ts and then fix the typo in the comment"
    const parts = ["Read foo.ts", "fix the typo in the comment"]
    const m = lexicalSignalsMerged(full, parts)
    expect(m.strongEdit).toBe(true)
  })
})

describe("applyRouterPolicy websearch weak internet", () => {
  test("strips websearch when candidate set includes it but prompt only mentions internet weakly", () => {
    const ids = new Set(["read", "grep", "glob", "websearch", "webfetch", "skill", "task"])
    const available = new Set(["read", "grep", "glob", "websearch", "webfetch", "skill", "task"])
    const t = "solo menciono internet sin buscar nada"
    const out = applyRouterPolicy({
      ids,
      text: t,
      fullText: t,
      available,
      max: 12,
    })
    expect(out.includes("websearch")).toBe(false)
  })
})

describe("applyRouterPolicy web negation", () => {
  test("strips websearch and webfetch when user forbids web search", () => {
    const ids = new Set(["read", "websearch", "webfetch", "grep", "skill", "task"])
    const available = new Set(["read", "websearch", "webfetch", "grep", "skill", "task"])
    const t = "Never use web search; only use the repo. Summarize AGENTS.md"
    const out = applyRouterPolicy({
      ids,
      text: t,
      fullText: t,
      available,
      max: 12,
    })
    expect(out.includes("websearch")).toBe(false)
    expect(out.includes("webfetch")).toBe(false)
    expect(out.includes("read")).toBe(true)
  })
})

describe("negatesTaskDelegation", () => {
  test("true when user forbids spawning a subagent", () => {
    expect(negatesTaskDelegation("Do not spawn a subagent; grep only")).toBe(true)
    expect(negatesTaskDelegation("No delegation — read AGENTS.md")).toBe(true)
  })

  test("false for normal orchestration wording", () => {
    expect(negatesTaskDelegation("Delegate to task to refactor the module")).toBe(false)
  })
})

describe("applyRouterPolicy task vs delegation negation", () => {
  test("strips task when user forbids subagent delegation", () => {
    const ids = new Set(["task", "grep", "read"])
    const available = new Set(["task", "grep", "read"])
    const t = "Do not spawn a subagent; grep for router policy only"
    const out = applyRouterPolicy({
      ids,
      text: t,
      fullText: t,
      available,
      max: 12,
    })
    expect(out.includes("task")).toBe(false)
    expect(out.includes("grep")).toBe(true)
  })
})

describe("applyRouterPolicy bash vs no git commands", () => {
  test("drops bash when user forbids git commands", () => {
    const ids = new Set(["bash", "grep", "read"])
    const available = new Set(["bash", "grep", "read"])
    const t = "No git commands — grep for 'ToolRouter' without running git"
    const out = applyRouterPolicy({
      ids,
      text: t,
      fullText: t,
      available,
      max: 12,
    })
    expect(out.includes("bash")).toBe(false)
    expect(out.includes("grep")).toBe(true)
  })
})

describe("applyRouterPolicy grep + codesearch keep both", () => {
  test("keeps grep and codesearch for search the codebase for …", () => {
    const ids = new Set(["grep", "codesearch", "read"])
    const available = new Set(["grep", "codesearch", "read"])
    const t = "Search the codebase for 'ToolRouter' and explain how it works"
    const out = applyRouterPolicy({
      ids,
      text: t,
      fullText: t,
      available,
      max: 12,
    })
    expect(out.includes("grep")).toBe(true)
    expect(out.includes("codesearch")).toBe(true)
  })
})

describe("applyRouterPolicy bash vs list/glob", () => {
  test("drops bash when user forbids running terminal (multi-clause)", () => {
    const ids = new Set(["bash", "glob", "grep", "read", "skill", "task"])
    const available = new Set(["bash", "glob", "grep", "read", "skill", "task"])
    const t = "Read the router policy file, then grep for bash — do not run terminal"
    const out = applyRouterPolicy({
      ids,
      text: t,
      fullText: t,
      available,
      max: 12,
    })
    expect(out.includes("bash")).toBe(false)
    expect(out.includes("grep")).toBe(true)
  })

  test("drops bash for list *.test.ts files under path (not shell)", () => {
    const ids = new Set(["bash", "glob", "grep", "read", "skill", "task"])
    const available = new Set(["bash", "glob", "grep", "read", "skill", "task"])
    const out = applyRouterPolicy({
      ids,
      text: "List all *.test.ts files under packages/",
      fullText: "List all *.test.ts files under packages/",
      available,
      max: 12,
    })
    expect(out.includes("bash")).toBe(false)
    expect(out.includes("glob")).toBe(true)
  })
})
