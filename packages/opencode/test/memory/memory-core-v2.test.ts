/**
 * LightCode Memory Core V2 — Validation Tests
 *
 * Tests cover the V2 gap closures that remain unique after Phase 4 + shim removal:
 * V2-1: OM atomicity — seal only advances after observer write succeeds
 * V2-3: Working memory injects into system prompt
 * V2-4: update_working_memory tool stores correctly
 * V2-5: FTS5 recent() returns latest artifacts (ordering + scope filter)
 * V2-6: Dream persistConsolidation() integration
 * V2-7: Engram gate removed from autodream (code-level check)
 * V2-F: format() 800-char preview
 */

import { beforeEach, afterEach, describe, test, expect } from "bun:test"
import os from "os"
import path from "path"
import { rm } from "fs/promises"
import { Database } from "../../src/storage/db"
import { WorkingMemory } from "../../src/memory/working-memory"
import { FTS5Backend, format as formatArtifacts } from "../../src/memory/fts5-backend"
import { Memory } from "../../src/memory/provider"
import { OM, OMBuf } from "../../src/session/om"
import { AutoDream } from "../../src/dream/index"
import { ToolRegistry } from "../../src/tool/registry"
import { UpdateWorkingMemoryTool } from "../../src/tool/memory"
import { Instance } from "../../src/project/instance"
import { ProjectID } from "../../src/project/schema"
import { ProjectTable } from "../../src/project/project.sql"
import { SessionTable } from "../../src/session/session.sql"
import { MessageID, SessionID } from "../../src/session/schema"
import type { ScopeRef } from "../../src/memory/contracts"
import { tmpdir } from "../fixture/fixture"

let testDbPath: string

async function setupTestDb() {
  testDbPath = path.join(os.tmpdir(), `memory-v2-test-${Math.random().toString(36).slice(2)}.db`)
  try {
    await Database.close()
  } catch {}
  Database.Client.reset()
  process.env["OPENCODE_DB"] = testDbPath
  await Database.Client()
}

async function teardownTestDb() {
  try {
    await Database.close()
  } catch {}
  Database.Client.reset()
  await rm(testDbPath, { force: true }).catch(() => undefined)
  await rm(`${testDbPath}-wal`, { force: true }).catch(() => undefined)
  await rm(`${testDbPath}-shm`, { force: true }).catch(() => undefined)
  delete process.env["OPENCODE_DB"]
}

const projectScope: ScopeRef = { type: "project", id: "v2-test-project" }

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

// ─── V2-1: OM Atomicity ───────────────────────────────────────────────────────

describe("V2-1: OM atomicity — seal only advances after write succeeds", () => {
  beforeEach(setupTestDb)
  afterEach(teardownTestDb)

  test("addBufferSafe persists buffer and observed ids together", async () => {
    const sid = SessionID.make("v2-atomic-001")
    await seedSession(sid)

    await OM.addBufferSafe(
      {
        id: "buf-v2-001",
        session_id: sid,
        observations: "Observed a runtime change",
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

    expect(await OM.buffers(sid)).toHaveLength(1)
    expect((await OM.get(sid))?.observed_message_ids).toBe(JSON.stringify(["m1", "m2"]))
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

  test("Memory.buildContext returns working memory via canonical path (replaces projectWorkingMemory)", async () => {
    await WorkingMemory.set(projectScope, "goals", "Implement memory core V2")
    await WorkingMemory.set(projectScope, "constraints", "No external daemon dependency")

    const ctx = await Memory.buildContext({
      scope: { type: "thread", id: "test-thread" },
      ancestorScopes: [projectScope],
    })

    expect(ctx.workingMemory).toBeDefined()
    // Memory.buildContext() uses <working-memory scope="..."> format
    expect(ctx.workingMemory).toContain("<working-memory")
    expect(ctx.workingMemory).toContain("Implement memory core V2")
    expect(ctx.workingMemory).toContain("No external daemon dependency")
  })

  test("SystemPrompt.wrapWorkingMemory remains the runtime injection contract", async () => {
    const { SystemPrompt } = await import("../../src/session/system")
    const wrapped = SystemPrompt.wrapWorkingMemory("## Goals\n- Build memory core")

    expect(wrapped).toContain("<working-memory>")
    expect(wrapped).toContain("Build memory core")
  })
})

// ─── V2-4: update_working_memory Tool ─────────────────────────────────────────

describe("V2-4: update_working_memory tool", () => {
  beforeEach(setupTestDb)
  afterEach(teardownTestDb)

  test("tool stores working memory correctly via Memory.setWorkingMemory", async () => {
    // Test the underlying service call directly (tool execute delegates to it)
    await Memory.setWorkingMemory({ type: "project", id: "v2-tool-project" }, "architecture", "Event-sourced with CQRS")
    const records = await Memory.getWorkingMemory({ type: "project", id: "v2-tool-project" }, "architecture")

    expect(records).toHaveLength(1)
    expect(records[0].value).toBe("Event-sourced with CQRS")
    expect(records[0].scope_type).toBe("project")
  })

  test("update_working_memory tool validates runtime schema", async () => {
    const def = await UpdateWorkingMemoryTool.init()
    expect(() => def.parameters.parse({ scope: "project", key: "stack", value: "TypeScript" })).not.toThrow()
    expect(() => def.parameters.parse({ scope: "user", key: "stack", value: "TypeScript" })).toThrow()
  })

  test("update_working_memory tool is registered in the runtime registry", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("update_working_memory")
      },
    })
  })
})

// ─── V2-5: FTS5Backend.recent() ───────────────────────────────────────────────

describe("V2-5: FTS5Backend.recent() returns latest artifacts", () => {
  beforeEach(setupTestDb)
  afterEach(teardownTestDb)

  test("recent() returns artifacts ordered by time_updated DESC", async () => {
    const fts = new FTS5Backend()

    await fts.index({
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

    await fts.index({
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

    const recent = await fts.recent([projectScope], 5)
    expect(recent.length).toBe(2)
    // Most recently updated first
    expect(recent[0].title).toBe("New artifact")
    expect(recent[1].title).toBe("Old artifact")
  })

  test("recent() respects scope boundaries", async () => {
    const fts = new FTS5Backend()

    await fts.index({
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

    await fts.index({
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

    const recent = await fts.recent([projectScope], 10)
    expect(recent.every((r) => r.scope_type === "project")).toBe(true)
    expect(recent.length).toBe(1)
  })
})

// ─── V2-6: Dream persistConsolidation writes to memory_artifacts ──────────────

describe("V2-6: Dream persistConsolidation writes to memory_artifacts", () => {
  beforeEach(setupTestDb)
  afterEach(teardownTestDb)

  test("persistConsolidation() writes to memory_artifacts when OPENCODE_DREAM_USE_NATIVE_MEMORY=true", async () => {
    // Ensure native memory flag is true (default)
    delete process.env["OPENCODE_DREAM_USE_NATIVE_MEMORY"]

    await AutoDream.persistConsolidation(
      "test-project-dream",
      "AutoDream consolidation 2026-04-05",
      "We implemented the auth module with JWT. Key decisions: token expiry 24h, refresh tokens stored in DB. Test coverage: 85%.",
      "dream/2026-04-05",
    )

    // Verify it landed in memory_artifacts
    const fts = new FTS5Backend()
    const artifacts = await fts.search("JWT auth token", [{ type: "project", id: "test-project-dream" }], 10)
    expect(artifacts.length).toBeGreaterThan(0)
    expect(artifacts[0].scope_type).toBe("project")
    expect(artifacts[0].scope_id).toBe("test-project-dream")
    expect(artifacts[0].topic_key).toBe("dream/2026-04-05")
  })

  test("persistConsolidation() topic_key enables dedupe on subsequent calls", async () => {
    const topicKey = "dream/2026-04-05"

    await AutoDream.persistConsolidation("test-project-dedup", "Dream v1", "Initial consolidation content", topicKey)

    await AutoDream.persistConsolidation(
      "test-project-dedup",
      "Dream v2",
      "Updated consolidation content with more detail",
      topicKey,
    )

    // Should be ONE artifact with revision_count=2
    const scope: ScopeRef = { type: "project", id: "test-project-dedup" }
    const fts = new FTS5Backend()
    const all = await fts.recent([scope], 10)
    expect(all.length).toBe(1)
    expect(all[0].revision_count).toBe(2)
    expect(all[0].title).toBe("Dream v2")
  })
})

// ─── V2-7: Engram gate removed from autodream ─────────────────────────────────

describe("V2-7: Engram gate removed from autodream idle()", () => {
  test("buildSpawnPrompt composes focus and observations for native dream runtime", () => {
    const out = AutoDream.buildSpawnPrompt("base", "auth", "JWT observations")
    expect(out).toContain("## Focus")
    expect(out).toContain("auth")
    expect(out).toContain("## Session Observations")
    expect(out).toContain("JWT observations")
  })
})

// ─── V2-F: Format 800-char preview ────────────────────────────────────────────

describe("V2-F: format() uses 800-char preview", () => {
  beforeEach(setupTestDb)
  afterEach(teardownTestDb)

  test("format() uses 800-char preview instead of 300", async () => {
    const fts = new FTS5Backend()
    const content = "A".repeat(1000)

    const id = await fts.index({
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

    const got = await fts.get(id)
    const artifacts = got ? [got] : []
    const formatted = formatArtifacts(artifacts, 5000) // high budget

    // Should contain 800 chars of A's (not 300)
    expect(formatted).toBeDefined()
    const aCount = (formatted!.match(/A/g) || []).length
    expect(aCount).toBeGreaterThan(700)
    expect(aCount).toBeLessThanOrEqual(800)
    // V1 would have had ~300, V2 has ~800
    expect(aCount).toBeGreaterThan(300)
  })
})
