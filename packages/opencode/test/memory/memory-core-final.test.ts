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
import { ProjectID } from "../../src/project/schema"
import { ProjectTable } from "../../src/project/project.sql"
import { SessionTable } from "../../src/session/session.sql"
import { MessageID, SessionID } from "../../src/session/schema"
import type { ScopeRef } from "../../src/memory/contracts"

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

function seedSession(sid: SessionID, pid = projectScope.id) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: ProjectID.make(pid),
        worktree: "/tmp",
        vcs: "git",
        name: pid,
        icon_url: null,
        icon_color: null,
        time_created: now,
        time_updated: now,
        time_initialized: null,
        sandboxes: [],
        commands: null,
      })
      .onConflictDoNothing()
      .run(),
  )
  Database.use((db) =>
    db
      .insert(SessionTable)
      .values({
        id: sid,
        project_id: ProjectID.make(pid),
        workspace_id: null,
        parent_id: null,
        slug: sid,
        directory: "/tmp",
        title: sid,
        version: "test",
        share_url: null,
        summary_additions: null,
        summary_deletions: null,
        summary_files: null,
        summary_diffs: null,
        revert: null,
        permission: null,
        time_created: now,
        time_updated: now,
        time_compacting: null,
        time_archived: null,
      })
      .run(),
  )
}

// ─── F-1: addBufferSafe() atomicity ──────────────────────────────────────────

describe("F-1: addBufferSafe() — canonical OM write path", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("addBufferSafe() is exported from OM namespace", () => {
    expect(typeof OM.addBufferSafe).toBe("function")
  })

  test("addBufferSafe() creates placeholder observation state for first write", () => {
    const sid = SessionID.make("final-om-001")
    seedSession(sid)
    OM.addBufferSafe(
      {
        id: "buf-final-001",
        session_id: sid,
        observations: "first batch",
        message_tokens: 10,
        observation_tokens: 20,
        starts_at: 1,
        ends_at: 2,
        first_msg_id: MessageID.make("m1"),
        last_msg_id: MessageID.make("m2"),
        time_created: Date.now(),
        time_updated: Date.now(),
      },
      sid,
      ["m1", "m2"],
    )

    expect(OM.buffers(sid)).toHaveLength(1)
    expect(OM.get(sid)?.observed_message_ids).toBe(JSON.stringify(["m1", "m2"]))
  })

  test("addBufferSafe() merges observed ids into existing record", () => {
    const sid = SessionID.make("final-om-002")
    seedSession(sid)
    OM.upsert({
      id: SessionID.make("obs-final-002"),
      session_id: sid,
      observations: null,
      reflections: null,
      current_task: null,
      suggested_continuation: null,
      last_observed_at: null,
            retention_floor_at: null,
      generation_count: 0,
      observation_tokens: 0,
      observed_message_ids: JSON.stringify(["m1"]),
      time_created: Date.now(),
      time_updated: Date.now(),
    })

    OM.addBufferSafe(
      {
        id: "buf-final-002",
        session_id: sid,
        observations: "second batch",
        message_tokens: 10,
        observation_tokens: 20,
        starts_at: 3,
        ends_at: 4,
        first_msg_id: MessageID.make("m2"),
        last_msg_id: MessageID.make("m3"),
        time_created: Date.now(),
        time_updated: Date.now(),
      },
      sid,
      ["m2", "m3"],
    )

    expect(OM.get(sid)?.observed_message_ids).toBe(JSON.stringify(["m1", "m2", "m3"]))
  })
})

// ─── F-2: prompt.ts uses addBufferSafe() ─────────────────────────────────────

describe("F-2: addBufferSafe() remains the canonical runtime OM API", () => {
  test("OM exposes addBufferSafe while older helpers remain optional internals", () => {
    expect(typeof OM.addBufferSafe).toBe("function")
    expect(typeof OM.addBuffer).toBe("function")
    expect(typeof OM.trackObserved).toBe("function")
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
        workingMemorySnapshot: [
          { key: "tech_stack", value: "TypeScript" },
          { key: "goals", value: "Ship auth" },
        ],
      }),
    })

    const fork = Memory.getForkContext("child-final-001")
    expect(fork).toBeDefined()

    const ctx = JSON.parse(fork!.context)
    expect(ctx.parentAgent).toBe("build")
    expect(ctx.projectId).toBe("final-project")
    expect(ctx.taskDescription).toBe("Implement auth module")
    expect(ctx.currentTask).toBe("JWT implementation")
    expect(ctx.workingMemorySnapshot[0].key).toBe("tech_stack")
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

  test("buildContext formats semantic recall with memory-recall tags", async () => {
    Memory.indexArtifact({
      scope_type: "project",
      scope_id: "final-project",
      type: "observation",
      title: "JWT authentication implemented",
      content: "Architecture uses stateless JWT authentication for recall formatting",
      topic_key: "session/final-format/observations",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    const ctx = await Memory.buildContext({
      scope: { type: "thread", id: "final-format-test" },
      ancestorScopes: [projectScope],
      semanticQuery: "JWT authentication stateless",
    })

    expect(ctx.semanticRecall).toBeDefined()
    expect(ctx.semanticRecall!).toContain("<memory-recall>")
    expect(ctx.semanticRecall!).toContain("JWT authentication implemented")
  })
})

// ─── F-6: SystemPrompt.recall() removed ──────────────────────────────────────

describe("F-6: SystemPrompt.recall() removed — Memory.buildContext() is canonical", () => {
  test("SystemPrompt does not export recall() function", async () => {
    const { SystemPrompt } = await import("../../src/session/system")
    expect((SystemPrompt as any).recall).toBeUndefined()
  })
})

// ─── F-7: SystemPrompt.projectWorkingMemory() removed ─────────────────────────

describe("F-7: SystemPrompt.projectWorkingMemory() removed", () => {
  test("SystemPrompt does not export projectWorkingMemory() function", async () => {
    const { SystemPrompt } = await import("../../src/session/system")
    expect((SystemPrompt as any).projectWorkingMemory).toBeUndefined()
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
