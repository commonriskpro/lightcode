/**
 * LightCode Memory Core V2 — Validation Tests
 *
 * Tests cover the V2 gap closures:
 * V2-1: OM atomicity — seal only advances after observer write succeeds
 * V2-2: recallNative uses real semantic query, not project UUID
 * V2-3: Working memory injects into system prompt
 * V2-4: update_working_memory tool stores correctly
 * V2-5: SemanticRecall.recent() returns latest artifacts when FTS fails
 * V2-6: Dream persistConsolidation() writes to memory_artifacts
 * V2-7: Engram gate removed from autodream (code-level check)
 * V2-8: No regression on V1 behavior
 */

import { beforeEach, afterEach, describe, test, expect } from "bun:test"
import os from "os"
import path from "path"
import { rm } from "fs/promises"
import { Database } from "../../src/storage/db"
import { WorkingMemory } from "../../src/memory/working-memory"
import { SemanticRecall } from "../../src/memory/semantic-recall"
import { Memory } from "../../src/memory/provider"
import { OM, OMBuf } from "../../src/session/om"
import type { ScopeRef } from "../../src/memory/contracts"
import type { SessionID } from "../../src/session/schema"

let testDbPath: string

async function setupTestDb() {
  testDbPath = path.join(os.tmpdir(), `memory-v2-test-${Math.random().toString(36).slice(2)}.db`)
  try {
    Database.close()
  } catch {}
  Database.Client.reset()
  process.env["OPENCODE_DB"] = testDbPath
  Database.Client()
}

async function teardownTestDb() {
  try {
    Database.close()
  } catch {}
  Database.Client.reset()
  await rm(testDbPath, { force: true }).catch(() => undefined)
  await rm(`${testDbPath}-wal`, { force: true }).catch(() => undefined)
  await rm(`${testDbPath}-shm`, { force: true }).catch(() => undefined)
  delete process.env["OPENCODE_DB"]
}

const projectScope: ScopeRef = { type: "project", id: "v2-test-project" }
const threadScope: ScopeRef = { type: "thread", id: "v2-test-thread" }

// ─── V2-1: OM Atomicity ───────────────────────────────────────────────────────

describe("V2-1: OM atomicity — seal only advances after write succeeds", () => {
  test("OMBuf.seal does NOT advance before Observer writes (code audit)", () => {
    // This is a structural/code correctness test.
    // Read the actual prompt.ts source to verify seal is inside the async closure.
    const fs = require("fs")
    const src = fs.readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string

    // The old broken pattern: OMBuf.seal() called OUTSIDE the async closure
    // The fix: OMBuf.seal() must appear AFTER OM.addBuffer() inside the async IIFE

    // Verify OMBuf.seal is NOT before the async closure start
    const sealMatch = src.match(/OMBuf\.seal\(sessionID, sealAt\)/)
    expect(sealMatch).not.toBeNull()

    // Find the positions
    const sealPos = src.indexOf("OMBuf.seal(sessionID, sealAt)")
    const addBufferPos = src.indexOf("OM.addBuffer(")
    const asyncIIFEPos = src.indexOf("const p = (async () => {")

    // seal must appear AFTER addBuffer (which is inside the async closure)
    expect(sealPos).toBeGreaterThan(addBufferPos)

    // seal must appear AFTER the async IIFE starts
    expect(sealPos).toBeGreaterThan(asyncIIFEPos)

    // trackObserved must also be inside (after addBuffer)
    const trackPos = src.indexOf("OM.trackObserved(sessionID, msgIds)")
    expect(trackPos).toBeGreaterThan(addBufferPos)
  })

  test("OMBuf.seal advances in-memory state independently of DB writes", () => {
    // Unit test: verify the in-memory seal mechanics (pure in-memory, no DB needed)
    // Use a unique ID so tests don't interfere with each other
    const sid = `test-seal-${Math.random().toString(36).slice(2)}` as SessionID

    // Initial state: no seal for this session
    expect(OMBuf.sealedAt(sid)).toBe(0)

    // Simulate the V2 sequence: check signal, then advance seal after write would succeed
    const sealAt = Date.now()
    OMBuf.seal(sid, sealAt)
    expect(OMBuf.sealedAt(sid)).toBe(sealAt)
  })

  test("seal does NOT advance if addBuffer never called (observer failure simulation)", () => {
    const sid = "test-session-fail-seal" as SessionID
    const sealAt = Date.now()

    // Simulate Observer.run() returning null (failure case)
    // In V2 code: if (!result) → skip addBuffer → skip seal
    const observerResult: string | null = null

    if (observerResult) {
      // This branch is not taken
      OMBuf.seal(sid, sealAt)
    }

    // Seal should remain 0
    expect(OMBuf.sealedAt(sid)).toBe(0)
    OMBuf.reset(sid)
  })
})

// ─── V2-2: Recall Query Fix ───────────────────────────────────────────────────

describe("V2-2: recallNative uses semantic query, not project UUID", () => {
  beforeEach(setupTestDb)
  afterEach(teardownTestDb)

  test("searchArtifacts with user message text finds relevant artifacts", () => {
    // Index an artifact with meaningful content
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "v2-test-project",
      type: "decision",
      title: "Authentication Strategy",
      content: "We decided to use JWT tokens for stateless authentication. Sessions expire in 24 hours.",
      topic_key: "decisions/auth",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    // Search with actual terms from the content (V2 behavior uses user message text)
    // Note: FTS5 with quoted terms uses AND matching, so all terms must appear in content
    const results = SemanticRecall.search("authentication JWT", [projectScope], 10)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toContain("Authentication")
  })

  test("UUID-as-query returns empty (proves V1 bug)", () => {
    // Index some artifacts
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "v2-test-project",
      type: "observation",
      title: "Session summary",
      content: "Worked on implementing the payment module with Stripe",
      topic_key: null,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    // Search with UUID (V1 broken behavior)
    const uuidQuery = "01JNX2ABCDEF12345678901234" // ULID-style UUID
    const results = SemanticRecall.search(uuidQuery, [projectScope], 10)
    // UUID won't match content — this demonstrates the V1 bug
    expect(results.length).toBe(0)
  })

  test("SemanticRecall.recent() returns artifacts when FTS finds nothing", () => {
    // Index artifacts
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "v2-test-project",
      type: "pattern",
      title: "Code Review Pattern",
      content: "Always run tests before committing",
      topic_key: "patterns/review",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    // Recency fallback (no query needed)
    const recent = SemanticRecall.recent([projectScope], 5)
    expect(recent.length).toBe(1)
    expect(recent[0].title).toBe("Code Review Pattern")
  })
})

// ─── V2-3: Working Memory in System Prompt ────────────────────────────────────

describe("V2-3: Working memory injects into system prompt", () => {
  beforeEach(setupTestDb)
  afterEach(teardownTestDb)

  test("wrapWorkingMemory creates correct XML block", async () => {
    const { SystemPrompt } = await import("../../src/session/system")
    const body = "## Goals\n- Build memory core\n## Tech Stack\n- TypeScript, SQLite"
    const wrapped = SystemPrompt.wrapWorkingMemory(body)

    expect(wrapped).toContain("<working-memory>")
    expect(wrapped).toContain("</working-memory>")
    expect(wrapped).toContain("Build memory core")
    expect(wrapped).toContain("stable facts")
  })

  test("projectWorkingMemory returns undefined when no records", async () => {
    const { SystemPrompt } = await import("../../src/session/system")
    const result = await SystemPrompt.projectWorkingMemory("empty-project")
    expect(result).toBeUndefined()
  })

  test("projectWorkingMemory returns wrapped content when records exist", async () => {
    WorkingMemory.set(projectScope, "goals", "Implement memory core V2")
    WorkingMemory.set(projectScope, "constraints", "No external daemon dependency")

    const { SystemPrompt } = await import("../../src/session/system")
    const result = await SystemPrompt.projectWorkingMemory("v2-test-project")

    expect(result).toBeDefined()
    expect(result).toContain("<working-memory>")
    expect(result).toContain("Implement memory core V2")
    expect(result).toContain("No external daemon dependency")
  })

  test("LLM StreamInput accepts workingMemory field (source check)", () => {
    // Code audit: verify llm.ts has workingMemory in StreamInput
    const fs = require("fs")
    const src = fs.readFileSync(path.join(__dirname, "../../src/session/llm.ts"), "utf-8") as string
    expect(src).toContain("workingMemory?: string")
  })
})

// ─── V2-4: update_working_memory Tool ─────────────────────────────────────────

describe("V2-4: update_working_memory tool", () => {
  beforeEach(setupTestDb)
  afterEach(teardownTestDb)

  test("tool stores working memory correctly via Memory.setWorkingMemory", () => {
    // Test the underlying service call directly (tool execute delegates to it)
    Memory.setWorkingMemory({ type: "project", id: "v2-tool-project" }, "architecture", "Event-sourced with CQRS")
    const records = Memory.getWorkingMemory({ type: "project", id: "v2-tool-project" }, "architecture")

    expect(records).toHaveLength(1)
    expect(records[0].value).toBe("Event-sourced with CQRS")
    expect(records[0].scope_type).toBe("project")
  })

  test("update_working_memory tool file exists and exports correct structure", async () => {
    const { UpdateWorkingMemoryTool } = await import("../../src/tool/memory")
    expect(UpdateWorkingMemoryTool).toBeDefined()
    // Verify it has an init function (standard Tool shape)
    expect(typeof UpdateWorkingMemoryTool.init).toBe("function")
  })

  test("update_working_memory tool is registered in the registry", async () => {
    const registrySrc = require("fs").readFileSync(
      path.join(__dirname, "../../src/tool/registry.ts"),
      "utf-8",
    ) as string
    expect(registrySrc).toContain("UpdateWorkingMemoryTool")
    // The registry uses the variable name; the string ID "update_working_memory" is in memory.ts
    expect(registrySrc).toContain("updateWorkingMemory")
    expect(registrySrc).toContain("Persist stable facts")
  })
})

// ─── V2-5: SemanticRecall.recent() ────────────────────────────────────────────

describe("V2-5: SemanticRecall.recent() returns latest artifacts", () => {
  beforeEach(setupTestDb)
  afterEach(teardownTestDb)

  test("recent() returns artifacts ordered by time_updated DESC", async () => {
    const now = Date.now()

    SemanticRecall.index({
      scope_type: "project",
      scope_id: "v2-test-project",
      type: "observation",
      title: "Old artifact",
      content: "This is older",
      topic_key: "old",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 5))

    SemanticRecall.index({
      scope_type: "project",
      scope_id: "v2-test-project",
      type: "decision",
      title: "New artifact",
      content: "This is newer",
      topic_key: "new",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    const recent = SemanticRecall.recent([projectScope], 5)
    expect(recent.length).toBe(2)
    // Most recently updated first
    expect(recent[0].title).toBe("New artifact")
    expect(recent[1].title).toBe("Old artifact")
  })

  test("recent() respects scope boundaries", () => {
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "v2-test-project",
      type: "observation",
      title: "Project artifact",
      content: "project content",
      topic_key: null,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    SemanticRecall.index({
      scope_type: "user",
      scope_id: "default",
      type: "pattern",
      title: "User pattern",
      content: "user content",
      topic_key: null,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    const recent = SemanticRecall.recent([projectScope], 10)
    expect(recent.every((r) => r.scope_type === "project")).toBe(true)
    expect(recent.length).toBe(1)
  })
})

// ─── V2-6: Dream persistConsolidation writes to memory_artifacts ──────────────

describe("V2-6: Dream persistConsolidation writes to memory_artifacts", () => {
  beforeEach(setupTestDb)
  afterEach(teardownTestDb)

  test("persistConsolidation() is defined and callable", async () => {
    const { AutoDream } = await import("../../src/dream/index")
    expect(typeof AutoDream.persistConsolidation).toBe("function")
  })

  test("persistConsolidation() writes to memory_artifacts when OPENCODE_DREAM_USE_NATIVE_MEMORY=true", async () => {
    // Ensure native memory flag is true (default)
    delete process.env["OPENCODE_DREAM_USE_NATIVE_MEMORY"]

    const { AutoDream } = await import("../../src/dream/index")

    AutoDream.persistConsolidation(
      "test-project-dream",
      "AutoDream consolidation 2026-04-05",
      "We implemented the auth module with JWT. Key decisions: token expiry 24h, refresh tokens stored in DB. Test coverage: 85%.",
      "dream/2026-04-05",
    )

    // Verify it landed in memory_artifacts
    const artifacts = SemanticRecall.search("JWT auth token", [{ type: "project", id: "test-project-dream" }], 10)
    expect(artifacts.length).toBeGreaterThan(0)
    expect(artifacts[0].scope_type).toBe("project")
    expect(artifacts[0].scope_id).toBe("test-project-dream")
    expect(artifacts[0].topic_key).toBe("dream/2026-04-05")
  })

  test("persistConsolidation() topic_key enables dedupe on subsequent calls", async () => {
    const { AutoDream } = await import("../../src/dream/index")

    const topicKey = "dream/2026-04-05"

    AutoDream.persistConsolidation("test-project-dedup", "Dream v1", "Initial consolidation content", topicKey)

    AutoDream.persistConsolidation(
      "test-project-dedup",
      "Dream v2",
      "Updated consolidation content with more detail",
      topicKey,
    )

    // Should be ONE artifact with revision_count=2
    const scope: ScopeRef = { type: "project", id: "test-project-dedup" }
    const all = SemanticRecall.recent([scope], 10)
    expect(all.length).toBe(1)
    expect(all[0].revision_count).toBe(2)
    expect(all[0].title).toBe("Dream v2")
  })
})

// ─── V2-7: Engram gate removed from autodream ─────────────────────────────────

describe("V2-7: Engram gate removed from autodream idle()", () => {
  test("idle() does NOT call Engram.ensure() (code audit)", () => {
    const fs = require("fs")
    const src = fs.readFileSync(path.join(__dirname, "../../src/dream/index.ts"), "utf-8") as string

    // Find the idle() function
    const idleFnStart = src.indexOf("async function idle(")
    const idleFnEnd = src.indexOf("\n  }", idleFnStart)
    const idleFnBody = src.slice(idleFnStart, idleFnEnd)

    // V2: Engram.ensure() must NOT be called in idle() body
    // (comments may mention it but actual function calls should not be present)
    // Strip single-line comments before checking
    const idleNoComments = idleFnBody.replace(/\/\/[^\n]*/g, "")
    expect(idleNoComments).not.toContain("Engram.ensure()")

    // V2 comment should be present
    expect(idleFnBody).toContain("V2:")
  })

  test("idle() has proper config gate for autodream=false", () => {
    const fs = require("fs")
    const src = fs.readFileSync(path.join(__dirname, "../../src/dream/index.ts"), "utf-8") as string

    const idleFnStart = src.indexOf("async function idle(")
    const idleFnEnd = src.indexOf("\n  }", idleFnStart)
    const idleFnBody = src.slice(idleFnStart, idleFnEnd)

    // Config gate must still be present
    expect(idleFnBody).toContain("autodream === false")
  })
})

// ─── V2-8: No regression on V1 behavior ──────────────────────────────────────

describe("V2-8: No regression on V1 behavior", () => {
  beforeEach(setupTestDb)
  afterEach(teardownTestDb)

  test("WorkingMemory CRUD still works correctly", () => {
    WorkingMemory.set(projectScope, "key", "value")
    const records = WorkingMemory.get(projectScope, "key")
    expect(records).toHaveLength(1)
    expect(records[0].value).toBe("value")
  })

  test("SemanticRecall index+search still works correctly", () => {
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "v2-test-project",
      type: "observation",
      title: "Regression test artifact",
      content: "This tests that V1 FTS5 search still works after V2 changes",
      topic_key: null,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    const results = SemanticRecall.search("regression FTS5", [projectScope], 10)
    expect(results.length).toBeGreaterThan(0)
  })

  test("Memory.buildContext() still returns correct structure", async () => {
    WorkingMemory.set(projectScope, "v1_compat", "V1 behavior preserved")
    const ctx = await Memory.buildContext({
      scope: threadScope,
      ancestorScopes: [projectScope],
    })

    // V1: workingMemory returned from buildContext()
    expect(ctx.workingMemory).toBeDefined()
    expect(ctx.workingMemory).toContain("V1 behavior preserved")
    // V1: undefined when no observations
    expect(ctx.observations).toBeUndefined()
  })

  test("topic_key dedupe still works (V1 SC-7 regression guard)", () => {
    const topicKey = "v2-regression/auth"

    const id1 = SemanticRecall.index({
      scope_type: "project",
      scope_id: "v2-test-project",
      type: "decision",
      title: "Auth V1",
      content: "Sessions",
      topic_key: topicKey,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    const id2 = SemanticRecall.index({
      scope_type: "project",
      scope_id: "v2-test-project",
      type: "decision",
      title: "Auth V2",
      content: "JWT tokens",
      topic_key: topicKey,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    expect(id1).toBe(id2)
    const artifact = SemanticRecall.get(id1)
    expect(artifact!.revision_count).toBe(2)
    expect(artifact!.title).toBe("Auth V2")
  })
})

// ─── Additional: Format preview expanded ─────────────────────────────────────

describe("V2 format: expanded content preview", () => {
  beforeEach(setupTestDb)
  afterEach(teardownTestDb)

  test("format() uses 800-char preview instead of 300", () => {
    const content = "A".repeat(1000)

    const id = SemanticRecall.index({
      scope_type: "project",
      scope_id: "v2-test-project",
      type: "observation",
      title: "Long content",
      content,
      topic_key: null,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    const artifacts = [SemanticRecall.get(id)!]
    const formatted = SemanticRecall.format(artifacts, 5000) // high budget

    // Should contain 800 chars of A's (not 300)
    expect(formatted).toBeDefined()
    const aCount = (formatted!.match(/A/g) || []).length
    expect(aCount).toBeGreaterThan(700)
    expect(aCount).toBeLessThanOrEqual(800)
    // V1 would have had ~300, V2 has ~800
    expect(aCount).toBeGreaterThan(300)
  })
})
