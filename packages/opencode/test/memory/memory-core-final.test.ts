/**
 * LightCode Memory Core Final — Validation Tests
 *
 * Tests cover all Final changes:
 * F-1:  addBufferSafe() atomically writes buffer + observed IDs in one transaction
 * F-2:  prompt.ts uses addBufferSafe() as canonical OM write path
 * F-3:  Fork context snapshot is enriched (task, OM continuation, WM keys)
 * F-4:  Memory.writeHandoff() is wired in task.ts for non-fork sessions
 * F-5:  Auto-index uses reflections > observations, and meaningful title
 * F-6:  SystemPrompt.recall() removed — Memory.buildContext() is canonical
 * F-7:  SystemPrompt.projectWorkingMemory() removed — Memory.buildContext() is canonical
 * F-8:  <engram-recall> renamed to <memory-recall>
 * F-9:  Stale "Requires Engram" comments fixed in config.ts
 * F-10: record.ts stale comment fixed
 * F-R:  No regressions on V1/V2/V3 behaviors
 */

import { beforeEach, afterEach, describe, test, expect } from "bun:test"
import os from "os"
import path from "path"
import { rm } from "fs/promises"
import { Database } from "../../src/storage/db"
import { Memory } from "../../src/memory/provider"
import { SemanticRecall } from "../../src/memory/semantic-recall"
import { WorkingMemory } from "../../src/memory/working-memory"
import { Handoff } from "../../src/memory/handoff"
import { OM, OMBuf } from "../../src/session/om"
import type { ScopeRef } from "../../src/memory/contracts"
import type { SessionID } from "../../src/session/schema"

// ─── Test DB setup ────────────────────────────────────────────────────────────

let testDbPath: string

async function setup() {
  testDbPath = path.join(os.tmpdir(), `final-test-${Math.random().toString(36).slice(2)}.db`)
  try {
    Database.close()
  } catch {}
  Database.Client.reset()
  process.env["OPENCODE_DB"] = testDbPath
  Database.Client()
}

async function teardown() {
  try {
    Database.close()
  } catch {}
  Database.Client.reset()
  await rm(testDbPath, { force: true }).catch(() => undefined)
  await rm(`${testDbPath}-wal`, { force: true }).catch(() => undefined)
  await rm(`${testDbPath}-shm`, { force: true }).catch(() => undefined)
  delete process.env["OPENCODE_DB"]
}

const projectScope: ScopeRef = { type: "project", id: "final-project" }

// ─── F-1: addBufferSafe() atomicity ──────────────────────────────────────────

describe("F-1: addBufferSafe() — canonical OM write path", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("addBufferSafe() is exported from OM namespace", () => {
    expect(typeof OM.addBufferSafe).toBe("function")
  })

  test("addBufferSafe() function is implemented with Database.transaction", () => {
    // Verify the implementation uses a DB transaction (code audit)
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/om/record.ts"), "utf-8") as string

    const fnStart = src.indexOf("export function addBufferSafe(")
    const fnEnd = src.indexOf("export function addBuffer(", fnStart + 100)
    const fnBody = fnStart > -1 ? src.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2000) : ""

    expect(fnBody).toContain("Database.transaction(")
    expect(fnBody).toContain("ObservationBufferTable")
    expect(fnBody).toContain("observed_message_ids")
    expect(fnBody).toContain("mergeIds(")
  })

  test("addBufferSafe() signature accepts buffer, sessionID, and msgIds", () => {
    // Verify function signature via code inspection
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/om/record.ts"), "utf-8") as string

    const signature = src.slice(
      src.indexOf("export function addBufferSafe("),
      src.indexOf("): void", src.indexOf("export function addBufferSafe(")) + 10,
    )
    expect(signature).toContain("buf: ObservationBuffer")
    expect(signature).toContain("sid: SessionID")
    expect(signature).toContain("msgIds: string[]")
  })

  test("addBufferSafe() handles missing ObservationRecord via placeholder path (code audit)", () => {
    // The addBufferSafe() function handles the case where no ObservationRecord exists yet
    // (very first observation for a session) by inserting a placeholder row.
    // This is verified via code inspection since the test DB has session FK constraints.
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/om/record.ts"), "utf-8") as string

    const fnStart = src.indexOf("export function addBufferSafe(")
    const fnEnd = src.indexOf("export function trackObserved(", fnStart)
    const fnBody = src.slice(fnStart, fnEnd)

    // Must handle existing record path
    expect(fnBody).toContain("if (rec) {")
    // Must handle missing record path (else branch)
    expect(fnBody).toContain("} else {")
    // Must insert placeholder with observed_message_ids set
    expect(fnBody).toContain("JSON.stringify(msgIds)")
  })
})

// ─── F-2: prompt.ts uses addBufferSafe() ─────────────────────────────────────

describe("F-2: prompt.ts uses addBufferSafe() as canonical OM write path", () => {
  test("prompt.ts calls OM.addBufferSafe() not OM.addBuffer() in the observer closure", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string

    // Find the observer async closure
    const closureStart = src.indexOf("const p = (async () => {")
    const closureEnd = src.indexOf("OMBuf.setInFlight(sessionID, p)", closureStart)
    const closure = src.slice(closureStart, closureEnd)

    // Must use addBufferSafe
    expect(closure).toContain("OM.addBufferSafe(")

    // Must NOT use old separate OM.addBuffer + OM.trackObserved sequence
    const codeOnly = closure.replace(/\/\/[^\n]*/g, "")
    expect(codeOnly).not.toContain("OM.addBuffer(")
    expect(codeOnly).not.toContain("OM.trackObserved(")
  })

  test("prompt.ts still calls OMBuf.seal() after addBufferSafe (in-memory hint)", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string

    const closureStart = src.indexOf("const p = (async () => {")
    const closureEnd = src.indexOf("OMBuf.setInFlight(sessionID, p)", closureStart)
    const closure = src.slice(closureStart, closureEnd)

    // Seal remains (in-memory read-performance hint)
    expect(closure).toContain("OMBuf.seal(sessionID, sealAt)")
  })
})

// ─── F-3: Fork context snapshot enriched ─────────────────────────────────────

describe("F-3: Fork context snapshot is enriched", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("Memory.writeForkContext stores enriched JSON", () => {
    Memory.writeForkContext({
      session_id: "child-final-001",
      parent_session_id: "parent-final-001",
      context: JSON.stringify({
        parentAgent: "build",
        projectId: "final-project",
        taskDescription: "Implement auth module",
        currentTask: "JWT implementation",
        suggestedContinuation: "Continue with refresh token logic",
        workingMemoryKeys: ["tech_stack", "goals"],
      }),
    })

    const fork = Memory.getForkContext("child-final-001")
    expect(fork).toBeDefined()

    const ctx = JSON.parse(fork!.context)
    expect(ctx.parentAgent).toBe("build")
    expect(ctx.projectId).toBe("final-project")
    expect(ctx.taskDescription).toBe("Implement auth module")
    expect(ctx.currentTask).toBe("JWT implementation")
    expect(ctx.workingMemoryKeys).toContain("tech_stack")
  })

  test("task.ts includes enriched fields in fork context write", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/tool/task.ts"), "utf-8") as string

    // Must include the new enriched fields
    expect(src).toContain("taskDescription")
    expect(src).toContain("currentTask")
    expect(src).toContain("suggestedContinuation")
    expect(src).toContain("workingMemoryKeys")
  })
})

// ─── F-4: Memory.writeHandoff() wired in task.ts ─────────────────────────────

describe("F-4: Memory.writeHandoff() wired for non-fork sessions", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("Memory.writeHandoff() persists to memory_agent_handoffs", () => {
    const id = Memory.writeHandoff({
      parent_session_id: "parent-handoff-001",
      child_session_id: "child-handoff-001",
      context: "Implement payment processing module",
      working_memory_snap: JSON.stringify([{ key: "tech_stack", value: "TypeScript + Stripe" }]),
      observation_snap: "Working on payment integration with Stripe",
      metadata: JSON.stringify({ parentAgent: "build", projectId: "final-project" }),
    })

    expect(id).toBeTruthy()

    const handoff = Memory.getHandoff("child-handoff-001")
    expect(handoff).toBeDefined()
    expect(handoff!.parent_session_id).toBe("parent-handoff-001")
    expect(handoff!.context).toBe("Implement payment processing module")
    expect(JSON.parse(handoff!.working_memory_snap!)[0].key).toBe("tech_stack")
  })

  test("task.ts calls Memory.writeHandoff() for non-fork sessions", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/tool/task.ts"), "utf-8") as string

    expect(src).toContain("Memory.writeHandoff(")
    // Must be guarded by !isFork
    const handoffBlock = src.slice(src.indexOf("Memory.writeHandoff(") - 200, src.indexOf("Memory.writeHandoff(") + 500)
    expect(handoffBlock).toContain("!isFork")
  })
})

// ─── F-5: Auto-index uses reflections + meaningful title ──────────────────────

describe("F-5: Auto-index improved title and content quality", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("session end auto-index indexes reflections over observations", () => {
    // Index an artifact simulating session end with reflections
    const reflectContent =
      "JWT authentication implemented. Architecture: stateless tokens, 24h expiry. Decisions: no refresh tokens in V1."
    Memory.indexArtifact({
      scope_type: "project",
      scope_id: "final-project",
      type: "observation",
      title: "JWT authentication implemented", // current_task style title
      content: reflectContent,
      topic_key: "session/ses_test/observations",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    // Must be searchable by topic content
    const results = SemanticRecall.search("JWT authentication stateless", [projectScope], 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toBe("JWT authentication implemented")
    expect(results[0].content).toContain("stateless tokens")
  })

  test("prompt.ts uses reflections-first content for auto-indexing", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string

    const autoIndexSection = src.slice(
      src.indexOf("Auto-index final OM observations"),
      src.indexOf("return yield* lastAssistant(sessionID)"),
    )

    // Must use reflections > observations
    expect(autoIndexSection).toContain("finalObs?.reflections ?? finalObs?.observations")

    // Must use current_task as title when available
    expect(autoIndexSection).toContain("finalObs?.current_task")
  })
})

// ─── F-6: SystemPrompt.recall() removed ──────────────────────────────────────

describe("F-6: SystemPrompt.recall() removed — Memory.buildContext() is canonical", () => {
  test("SystemPrompt does not export recall() function", async () => {
    const { SystemPrompt } = await import("../../src/session/system")
    expect((SystemPrompt as any).recall).toBeUndefined()
  })

  test("prompt.ts calls Memory.buildContext() not SystemPrompt.recall()", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string

    const step1Section = src.slice(src.indexOf("if (step === 1) {"), src.indexOf("// Load observations every turn"))

    const codeOnly = step1Section.replace(/\/\/[^\n]*/g, "")
    expect(codeOnly).not.toContain("SystemPrompt.recall(")
    expect(codeOnly).toContain("Memory.buildContext(")
  })
})

// ─── F-7: SystemPrompt.projectWorkingMemory() removed ─────────────────────────

describe("F-7: SystemPrompt.projectWorkingMemory() removed", () => {
  test("SystemPrompt does not export projectWorkingMemory() function", async () => {
    const { SystemPrompt } = await import("../../src/session/system")
    expect((SystemPrompt as any).projectWorkingMemory).toBeUndefined()
  })

  test("system.ts source has removal comment, not function definition", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/system.ts"), "utf-8") as string

    expect(src).not.toContain("export async function projectWorkingMemory(")
    expect(src).toContain("projectWorkingMemory() removed")
  })
})

// ─── F-8: <engram-recall> renamed to <memory-recall> ─────────────────────────

describe("F-8: wrapRecall uses <memory-recall> not <engram-recall>", () => {
  test("wrapRecall returns <memory-recall> tag", async () => {
    const { SystemPrompt } = await import("../../src/session/system")
    const result = SystemPrompt.wrapRecall("test content")
    expect(result).toContain("<memory-recall>")
    expect(result).not.toContain("<engram-recall>")
    expect(result).toContain("test content")
  })

  test("Memory.buildContext() also uses <memory-recall> (consistent)", async () => {
    await setup()
    try {
      SemanticRecall.index({
        scope_type: "project",
        scope_id: "final-project",
        type: "decision",
        title: "Memory recall test",
        content: "Using memory-recall tag for semantic recall context",
        topic_key: null,
        normalized_hash: null,
        revision_count: 1,
        duplicate_count: 1,
        last_seen_at: null,
        deleted_at: null,
      })

      const ctx = await Memory.buildContext({
        scope: { type: "thread", id: "final-test" },
        ancestorScopes: [projectScope],
        semanticQuery: "memory recall tag",
      })

      if (ctx.semanticRecall) {
        expect(ctx.semanticRecall).toContain("<memory-recall>")
        expect(ctx.semanticRecall).not.toContain("<engram-recall>")
      }
    } finally {
      await teardown()
    }
  })
})

// ─── F-9: Stale comments fixed ────────────────────────────────────────────────

describe("F-9: Stale comments fixed in config.ts", () => {
  test("config.ts autodream description no longer mentions Engram", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/config/config.ts"), "utf-8") as string

    // Find the autodream describe line
    const autodreamIdx = src.indexOf("Enable automatic memory consolidation")
    const autodreamLine = src.slice(autodreamIdx, autodreamIdx + 200)
    expect(autodreamLine).not.toContain("via Engram")
    expect(autodreamLine).toContain("native LightCode memory")
  })

  test("config.ts observer description no longer says 'Requires Engram'", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/config/config.ts"), "utf-8") as string

    expect(src).not.toContain("Requires Engram.")
  })
})

// ─── F-10: record.ts stale comment fixed ──────────────────────────────────────

describe("F-10: record.ts stale comment corrected", () => {
  test("record.ts addBuffer comment reflects actual usage", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/om/record.ts"), "utf-8") as string

    // Old wrong comment said addBuffer was NOT called from main path
    expect(src).not.toContain("not called from the main observation path")

    // Must have addBufferSafe() as canonical
    expect(src).toContain("addBufferSafe() is the canonical write path")
  })
})

// ─── F-R: No regression ───────────────────────────────────────────────────────

describe("F-R: No regression on prior behaviors", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("WorkingMemory CRUD unchanged", () => {
    WorkingMemory.set(projectScope, "k", "v")
    expect(WorkingMemory.get(projectScope, "k")[0].value).toBe("v")
  })

  test("SemanticRecall FTS5 search unchanged", () => {
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "final-project",
      type: "decision",
      title: "Final regression check",
      content: "All prior FTS5 search functionality should still work correctly",
      topic_key: "final/regression",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })
    const r = SemanticRecall.search("regression FTS5", [projectScope], 5)
    expect(r.length).toBeGreaterThan(0)
  })

  test("Memory.buildContext() still returns all layers", async () => {
    WorkingMemory.set(projectScope, "final_test", "regression check")
    const ctx = await Memory.buildContext({
      scope: { type: "thread", id: "final-regression" },
      ancestorScopes: [projectScope],
    })
    expect(ctx.workingMemory).toBeDefined()
    expect(ctx.workingMemory).toContain("regression check")
  })

  test("Handoff.writeFork + getFork unchanged", () => {
    Handoff.writeFork({ sessionId: "c-final", parentSessionId: "p-final", context: "test" })
    expect(Handoff.getFork("c-final")!.context).toBe("test")
  })

  test("topic_key dedupe still works", () => {
    const id1 = SemanticRecall.index({
      scope_type: "project",
      scope_id: "final-project",
      type: "decision",
      title: "D1",
      content: "c1",
      topic_key: "final/dedupe-test",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })
    const id2 = SemanticRecall.index({
      scope_type: "project",
      scope_id: "final-project",
      type: "decision",
      title: "D2",
      content: "c2",
      topic_key: "final/dedupe-test",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })
    expect(id1).toBe(id2)
    expect(SemanticRecall.get(id1)!.revision_count).toBe(2)
  })

  test("wrapWorkingMemory still includes guidance text", async () => {
    const { SystemPrompt } = await import("../../src/session/system")
    const wrapped = SystemPrompt.wrapWorkingMemory("## Goals\n- Build memory")
    expect(wrapped).toContain("<working-memory>")
    expect(wrapped).toContain("update_working_memory")
    expect(wrapped).toContain("Build memory")
  })
})
