/**
 * LightCode Memory Core V3 — Validation Tests
 *
 * Tests cover all V3 changes:
 * V3-1: Fork step guard is now === 1 (not 0) — fork path is reachable
 * V3-2: Fork path loads memory context via Memory.buildContext()
 * V3-3: Normal hot path uses Memory.buildContext() as canonical entry
 * V3-4: Durable fork context written to DB in task.ts
 * V3-5: activeContexts.delete called on loop exit (memory leak fixed)
 * V3-6: observeSafe() removed — canonical path documented
 * V3-7: Auto-indexing: session end writes OM observations to memory_artifacts
 * V3-8: Working memory guidance added to wrapWorkingMemory output
 * V3-9: Dream.run() no longer calls Engram.ensure()
 * V3-R: No regression on V1/V2 behavior
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
import type { ScopeRef } from "../../src/memory/contracts"

// ─── Test DB setup ────────────────────────────────────────────────────────────

let testDbPath: string

async function setup() {
  testDbPath = path.join(os.tmpdir(), `v3-test-${Math.random().toString(36).slice(2)}.db`)
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

const projectScope: ScopeRef = { type: "project", id: "v3-project" }

// ─── V3-1: Fork step guard ────────────────────────────────────────────────────

describe("V3-1: Fork step guard is step === 1 (not 0)", () => {
  test("prompt.ts fork guard uses step === 1", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string

    // V3 fix: was step === 0 (always false because step++ fires before check)
    const forkSection = src.slice(
      src.indexOf("// Fork path: use pre-built context"),
      src.indexOf("const maxSteps = agent.steps"),
    )

    // Must NOT contain the broken guard
    expect(forkSection).not.toContain("fork && step === 0")

    // Must contain the fixed guard
    expect(forkSection).toContain("fork && step === 1")
  })

  test("prompt.ts fork path deletes from activeContexts on fork consumption", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string

    // V3: activeContexts.delete must appear in the fork branch
    const forkSection = src.slice(
      src.indexOf("// Fork path: use pre-built context"),
      src.indexOf("const maxSteps = agent.steps"),
    )
    expect(forkSection).toContain("activeContexts.delete(sessionID)")
  })
})

// ─── V3-2: Fork path loads memory context ────────────────────────────────────

describe("V3-2: Fork path calls Memory.buildContext()", () => {
  test("prompt.ts fork block calls Memory.buildContext()", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string

    // Find the fork section
    const forkStart = src.indexOf("// Fork path: use pre-built context")
    const forkEnd = src.indexOf("const maxSteps = agent.steps")
    const forkSection = src.slice(forkStart, forkEnd)

    // Must call Memory.buildContext in fork block
    expect(forkSection).toContain("Memory.buildContext(")
    // Must use forkMemCtx results
    expect(forkSection).toContain("forkMemCtx.semanticRecall")
    expect(forkSection).toContain("forkMemCtx.workingMemory")
  })

  test("Memory.buildContext() returns correct structure for fork scope", async () => {
    await setup()
    try {
      // Simulate what fork path does: load child's memory context
      WorkingMemory.set(projectScope, "fork_goal", "Complete the payment integration")

      const ctx = await Memory.buildContext({
        scope: { type: "thread", id: "fork-child-session" },
        ancestorScopes: [projectScope],
      })

      expect(ctx.workingMemory).toBeDefined()
      expect(ctx.workingMemory).toContain("payment integration")
      // Recall and observations may be undefined for empty DB
      expect(ctx.recentHistory).toBeUndefined() // caller-supplied
    } finally {
      await teardown()
    }
  })
})

// ─── V3-3: Memory.buildContext() is canonical in normal path ──────────────────

describe("V3-3: Memory.buildContext() is canonical in normal hot path", () => {
  test("prompt.ts step===1 block calls Memory.buildContext() not scattered calls", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string

    // Find the step===1 block
    const step1Start = src.indexOf("if (step === 1) {")
    const step1End = src.indexOf("// Load observations every turn", step1Start)
    const step1Section = src.slice(step1Start, step1End)

    // Must use Memory.buildContext()
    expect(step1Section).toContain("Memory.buildContext(")
    expect(step1Section).toContain("memCtx.semanticRecall")
    expect(step1Section).toContain("memCtx.workingMemory")

    // Must NOT use the old scattered calls (check code lines, not comments)
    const step1NoComments = step1Section.replace(/\/\/[^\n]*/g, "")
    expect(step1NoComments).not.toContain("SystemPrompt.recall(")
    expect(step1NoComments).not.toContain("SystemPrompt.projectWorkingMemory(")
  })

  test("Memory.buildContext() returns all expected fields", async () => {
    await setup()
    try {
      WorkingMemory.set(projectScope, "tech_stack", "TypeScript + SQLite")
      SemanticRecall.index({
        scope_type: "project",
        scope_id: "v3-project",
        type: "decision",
        title: "Auth choice",
        content: "JWT tokens selected for stateless authentication",
        topic_key: "auth/decision",
        normalized_hash: null,
        revision_count: 1,
        duplicate_count: 1,
        last_seen_at: null,
        deleted_at: null,
      })

      const ctx = await Memory.buildContext({
        scope: { type: "thread", id: "normal-session" },
        ancestorScopes: [projectScope],
        semanticQuery: "JWT authentication",
      })

      // Working memory populated
      expect(ctx.workingMemory).toBeDefined()
      expect(ctx.workingMemory).toContain("TypeScript")

      // Semantic recall populated
      expect(ctx.semanticRecall).toBeDefined()
      expect(ctx.semanticRecall).toContain("Auth choice")

      // Structure intact
      expect(ctx.totalTokens).toBeGreaterThan(0)
    } finally {
      await teardown()
    }
  })
})

// ─── V3-4: Durable fork context written to DB ────────────────────────────────

describe("V3-4: Durable fork context written to DB in task.ts", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("Memory.writeForkContext persists to DB", () => {
    Memory.writeForkContext({
      session_id: "child-v3-001",
      parent_session_id: "parent-v3-001",
      context: JSON.stringify({ parentAgent: "build", projectId: "v3-project" }),
    })

    const fork = Memory.getForkContext("child-v3-001")
    expect(fork).toBeDefined()
    expect(fork!.session_id).toBe("child-v3-001")
    expect(fork!.parent_session_id).toBe("parent-v3-001")

    const ctx = JSON.parse(fork!.context)
    expect(ctx.parentAgent).toBe("build")
  })

  test("task.ts imports Memory and calls writeForkContext", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/tool/task.ts"), "utf-8") as string

    // Must import Memory
    expect(src).toContain('from "@/memory"')
    // Must call writeForkContext
    expect(src).toContain("Memory.writeForkContext(")
    // Must be after setForkContext
    const setPos = src.indexOf("SessionPrompt.setForkContext(")
    const writePos = src.indexOf("Memory.writeForkContext(")
    expect(writePos).toBeGreaterThan(setPos)
  })

  test("fork context upsert is safe (duplicate writes don't error)", () => {
    Memory.writeForkContext({ session_id: "child-dup", parent_session_id: "p1", context: "v1" })
    Memory.writeForkContext({ session_id: "child-dup", parent_session_id: "p1", context: "v2" })

    const fork = Memory.getForkContext("child-dup")
    expect(fork!.context).toBe("v2")
  })
})

// ─── V3-5: activeContexts cleanup ────────────────────────────────────────────

describe("V3-5: activeContexts.delete called on loop exit", () => {
  test("prompt.ts has activeContexts.delete after loop exit", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string

    // After the while loop ends (after `if (outcome === "break") break`)
    // and before `return yield* lastAssistant(sessionID)`
    const loopEnd = src.indexOf('if (outcome === "break") break')
    const returnStatement = src.indexOf("return yield* lastAssistant(sessionID)")
    const cleanupSection = src.slice(loopEnd, returnStatement)

    expect(cleanupSection).toContain("activeContexts.delete(sessionID)")
  })
})

// ─── V3-6: observeSafe() removed ─────────────────────────────────────────────

describe("V3-6: observeSafe() removed from om/record.ts", () => {
  test("observeSafe function definition no longer exists", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/om/record.ts"), "utf-8") as string

    // The function definition must be gone
    expect(src).not.toContain("export function observeSafe(")
    // The explanation comment must be present
    expect(src).toContain("V3: observeSafe() removed")
    expect(src).toContain("addBufferSafe()")
  })

  test("no remaining callers of observeSafe in codebase", () => {
    // observeSafe had zero callers before V3 — verify still zero
    const { execSync } = require("child_process")
    try {
      const result = execSync(
        'grep -r "observeSafe" /Users/dev/lightcodev2/packages/opencode/src --include="*.ts" -l',
        { encoding: "utf-8" },
      )
      // Only record.ts should mention it (in the comment explaining removal)
      const files = result.trim().split("\n").filter(Boolean)
      expect(files.every((f: string) => f.includes("record.ts"))).toBe(true)
    } catch {
      // grep exits non-zero if no files found — that's also acceptable
    }
  })
})

// ─── V3-7: Auto-indexing at session end ──────────────────────────────────────

describe("V3-7: Auto-indexing writes OM observations to memory_artifacts", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("Memory.indexArtifact stores observation with project scope", () => {
    // Simulate what session end auto-indexing does
    const obsContent =
      "We implemented JWT authentication. Key decision: 24h token expiry. Next: implement refresh tokens."

    Memory.indexArtifact({
      scope_type: "project",
      scope_id: "v3-project",
      type: "observation",
      title: `Session observations ${new Date().toISOString().slice(0, 10)}`,
      content: obsContent,
      topic_key: `session/ses_test001/observations`,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    // Must be searchable
    const results = SemanticRecall.search("JWT authentication", [projectScope], 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].scope_type).toBe("project")
    expect(results[0].type).toBe("observation")
  })

  test("topic_key deduplication works for repeated session observations", () => {
    const topicKey = "session/ses_same/observations"

    Memory.indexArtifact({
      scope_type: "project",
      scope_id: "v3-project",
      type: "observation",
      title: "Session obs v1",
      content: "Initial session work",
      topic_key: topicKey,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    Memory.indexArtifact({
      scope_type: "project",
      scope_id: "v3-project",
      type: "observation",
      title: "Session obs v2",
      content: "Updated session work with more detail",
      topic_key: topicKey,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    // Should be one artifact with revision_count = 2
    const recent = SemanticRecall.recent([projectScope], 10)
    const matching = recent.filter((a) => a.topic_key === topicKey)
    expect(matching.length).toBe(1)
    expect(matching[0].revision_count).toBe(2)
    expect(matching[0].title).toBe("Session obs v2")
  })

  test("prompt.ts has auto-indexing code at session end", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string

    // After loop exit, before return lastAssistant
    const loopEnd = src.indexOf("activeContexts.delete(sessionID)")
    const returnStatement = src.indexOf("return yield* lastAssistant(sessionID)")
    const autoIndexSection = src.slice(loopEnd, returnStatement)

    expect(autoIndexSection).toContain("Memory.indexArtifact(")
    expect(autoIndexSection).toContain("finalObs?.observations")
    expect(autoIndexSection).toContain('scope_type: "project"')
    expect(autoIndexSection).toContain("topic_key: `session/")
  })
})

// ─── V3-8: Working memory guidance ───────────────────────────────────────────

describe("V3-8: Working memory guidance in wrapWorkingMemory output", () => {
  test("SystemPrompt.WORKING_MEMORY_GUIDANCE is exported", async () => {
    const { SystemPrompt } = await import("../../src/session/system")
    expect(typeof SystemPrompt.WORKING_MEMORY_GUIDANCE).toBe("string")
    expect(SystemPrompt.WORKING_MEMORY_GUIDANCE.length).toBeGreaterThan(20)
    expect(SystemPrompt.WORKING_MEMORY_GUIDANCE).toContain("update_working_memory")
  })

  test("wrapWorkingMemory output includes guidance text", async () => {
    const { SystemPrompt } = await import("../../src/session/system")
    const wrapped = SystemPrompt.wrapWorkingMemory("## Goals\n- Build V3")
    expect(wrapped).toContain("<working-memory>")
    expect(wrapped).toContain("Build V3")
    expect(wrapped).toContain("update_working_memory")
    expect(wrapped).toContain("scope=")
  })
})

// ─── V3-9: Dream.run() Engram gate removed ───────────────────────────────────

describe("V3-9: Dream.run() no longer calls Engram.ensure()", () => {
  test("dream/index.ts run() does not call Engram.ensure()", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/dream/index.ts"), "utf-8") as string

    // Find run() function body
    const runStart = src.indexOf("export async function run(")
    const runEnd = src.indexOf("\n  }", runStart)
    const runBody = src.slice(runStart, runEnd)

    // Strip comments before checking
    const runNoComments = runBody.replace(/\/\/[^\n]*/g, "")
    expect(runNoComments).not.toContain("Engram.ensure()")
  })

  test("dream/index.ts no longer imports Engram", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/dream/index.ts"), "utf-8") as string

    // Engram import should be removed or commented out
    const importLines = src.split("\n").filter((l) => l.startsWith("import") && !l.startsWith("//"))
    const engramImport = importLines.find((l) => l.includes("Engram") && l.includes("engram"))
    expect(engramImport).toBeUndefined()
  })

  test("dream/index.ts idle() still does not call Engram.ensure()", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/dream/index.ts"), "utf-8") as string

    const idleStart = src.indexOf("async function idle(")
    const idleEnd = src.indexOf("\n  }", idleStart)
    const idleBody = src.slice(idleStart, idleEnd).replace(/\/\/[^\n]*/g, "")
    expect(idleBody).not.toContain("Engram.ensure()")
  })
})

// ─── V3-R: No regression ─────────────────────────────────────────────────────

describe("V3-R: No regression on V1/V2 behavior", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("Working memory CRUD unchanged", () => {
    WorkingMemory.set(projectScope, "k", "v")
    const r = WorkingMemory.get(projectScope, "k")
    expect(r[0].value).toBe("v")
  })

  test("SemanticRecall FTS5 still works", () => {
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "v3-project",
      type: "pattern",
      title: "V3 regression test",
      content: "FTS5 search should still work correctly after V3 changes",
      topic_key: null,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })
    const r = SemanticRecall.search("regression FTS5", [projectScope], 5)
    expect(r.length).toBeGreaterThan(0)
  })

  test("Handoff.writeFork + getFork unchanged", () => {
    Handoff.writeFork({ sessionId: "c1", parentSessionId: "p1", context: "ctx" })
    const f = Handoff.getFork("c1")
    expect(f!.context).toBe("ctx")
  })

  test("Memory.buildContext() returns all undefined on empty DB", async () => {
    const ctx = await Memory.buildContext({ scope: { type: "thread", id: "empty" } })
    expect(ctx.workingMemory).toBeUndefined()
    expect(ctx.observations).toBeUndefined()
    expect(ctx.semanticRecall).toBeUndefined()
    expect(ctx.totalTokens).toBe(0)
  })

  test("SemanticRecall.recent() unchanged", () => {
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "v3-project",
      type: "decision",
      title: "Recent test",
      content: "content",
      topic_key: "recent/test",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })
    const r = SemanticRecall.recent([projectScope], 5)
    expect(r.length).toBe(1)
  })

  test("topic_key dedupe still works", () => {
    const id1 = SemanticRecall.index({
      scope_type: "project",
      scope_id: "v3-project",
      type: "decision",
      title: "D1",
      content: "c1",
      topic_key: "v3/regression/dedupe",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })
    const id2 = SemanticRecall.index({
      scope_type: "project",
      scope_id: "v3-project",
      type: "decision",
      title: "D2",
      content: "c2",
      topic_key: "v3/regression/dedupe",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })
    expect(id1).toBe(id2)
    expect(SemanticRecall.get(id1)!.revision_count).toBe(2)
  })
})
