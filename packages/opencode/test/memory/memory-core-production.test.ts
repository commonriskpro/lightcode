/**
 * LightCode Memory — Production Validation Tests
 *
 * Tests for all production-readiness changes:
 * P-1:  Working memory precedence — thread > agent > project (key-based dedup)
 * P-2:  FTS5 two-pass search — AND mode first, prefix-OR fallback
 * P-3:  Memory.buildContext() fallback to recent() when FTS returns empty
 * P-4:  Agent scope is operational in UpdateWorkingMemoryTool
 * P-5:  Agent scope is included in Memory.buildContext() ancestry
 * P-6:  runLoop has structural section comments (code readability)
 * P-7:  Dead Engram recall code removed from system.ts
 * P-8:  OPENCODE_MEMORY_USE_ENGRAM flag removed from flag.ts
 * P-9:  Scope dormancy documented in contracts.ts
 * P-R:  No regressions on existing behaviors
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
import { UpdateUserMemoryTool } from "../../src/tool/memory"
import type { Tool } from "../../src/tool/tool"
import type { ScopeRef } from "../../src/memory/contracts"

// ─── Test DB setup ────────────────────────────────────────────────────────────

let testDbPath: string

async function setup() {
  testDbPath = path.join(os.tmpdir(), `prod-test-${Math.random().toString(36).slice(2)}.db`)
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

const threadScope: ScopeRef = { type: "thread", id: "prod-thread" }
const agentScope: ScopeRef = { type: "agent", id: "build" }
const projectScope: ScopeRef = { type: "project", id: "prod-project" }
const userScope: ScopeRef = { type: "user", id: "default" }
const globalScope: ScopeRef = { type: "global_pattern", id: "prod-global" }

// ─── P-1: Working Memory Precedence ──────────────────────────────────────────

describe("P-1: Working memory precedence — thread > agent > project", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("thread value wins over project when same key (bug fix)", () => {
    WorkingMemory.set(projectScope, "goals", "Project goals: ship V1")
    WorkingMemory.set(threadScope, "goals", "Thread goals: fix auth bug")

    const records = WorkingMemory.getForScopes(threadScope, [projectScope])

    // Only ONE record for key "goals" — thread wins
    const goalRecords = records.filter((r) => r.key === "goals")
    expect(goalRecords.length).toBe(1)
    expect(goalRecords[0].value).toBe("Thread goals: fix auth bug")
    expect(goalRecords[0].scope_type).toBe("thread")
  })

  test("agent value wins over project when same key", () => {
    WorkingMemory.set(projectScope, "constraints", "No breaking changes")
    WorkingMemory.set(agentScope, "constraints", "Focus only on auth module")

    const records = WorkingMemory.getForScopes(agentScope, [projectScope])

    const constraintRecords = records.filter((r) => r.key === "constraints")
    expect(constraintRecords.length).toBe(1)
    expect(constraintRecords[0].value).toBe("Focus only on auth module")
    expect(constraintRecords[0].scope_type).toBe("agent")
  })

  test("thread > agent > project precedence chain", () => {
    WorkingMemory.set(projectScope, "context", "Project context")
    WorkingMemory.set(agentScope, "context", "Agent context")
    WorkingMemory.set(threadScope, "context", "Thread context — most specific")

    const records = WorkingMemory.getForScopes(threadScope, [agentScope, projectScope])

    const contextRecords = records.filter((r) => r.key === "context")
    expect(contextRecords.length).toBe(1)
    expect(contextRecords[0].value).toBe("Thread context — most specific")
    expect(contextRecords[0].scope_type).toBe("thread")
  })

  test("unique keys from all scopes are all returned", () => {
    WorkingMemory.set(projectScope, "proj_key", "project value")
    WorkingMemory.set(agentScope, "agent_key", "agent value")
    WorkingMemory.set(threadScope, "thread_key", "thread value")

    const records = WorkingMemory.getForScopes(threadScope, [agentScope, projectScope])

    // All 3 unique keys should be present (no cross-scope collision here)
    const keys = records.map((r) => r.key)
    expect(keys).toContain("proj_key")
    expect(keys).toContain("agent_key")
    expect(keys).toContain("thread_key")
    expect(records.length).toBe(3)
  })

  test("user scope below project in precedence", () => {
    WorkingMemory.set(userScope, "preference", "User pref")
    WorkingMemory.set(projectScope, "preference", "Project pref overrides user")

    // project is an ancestor before user in the chain
    const records = WorkingMemory.getForScopes(threadScope, [projectScope, userScope])

    const prefRecords = records.filter((r) => r.key === "preference")
    expect(prefRecords.length).toBe(1)
    expect(prefRecords[0].value).toBe("Project pref overrides user")
    expect(prefRecords[0].scope_type).toBe("project")
  })

  test("old bug: scope_type:key dedup key was wrong — verify fix", () => {
    // This is the regression test for the production bug.
    // Before the fix, dedup key was `"${scope_type}:${key}"` which means
    // project:"goals" and thread:"goals" were treated as different keys → BOTH returned.
    // After fix: dedup key is just `key` → only thread's "goals" returned.

    WorkingMemory.set(projectScope, "goals", "Project goals")
    WorkingMemory.set(threadScope, "goals", "Thread goals")

    const records = WorkingMemory.getForScopes(threadScope, [projectScope])

    // Correct behavior: exactly 1 record for "goals" (thread wins)
    const goalRecords = records.filter((r) => r.key === "goals")
    expect(goalRecords).toHaveLength(1)
    // Bug condition: if both were returned, this would be 2
    expect(goalRecords[0].scope_type).toBe("thread")
  })

  test("thread > agent > project > user > global_pattern precedence chain", () => {
    WorkingMemory.set(globalScope, "mode", "Global mode")
    WorkingMemory.set(userScope, "mode", "User mode")
    WorkingMemory.set(projectScope, "mode", "Project mode")
    WorkingMemory.set(agentScope, "mode", "Agent mode")
    WorkingMemory.set(threadScope, "mode", "Thread mode")

    const records = WorkingMemory.getForScopes(threadScope, [agentScope, projectScope, userScope, globalScope])
    const mode = records.filter((r) => r.key === "mode")

    expect(mode).toHaveLength(1)
    expect(mode[0].scope_type).toBe("thread")
    expect(mode[0].value).toBe("Thread mode")
  })
})

// ─── P-2: FTS5 Two-Pass Search ────────────────────────────────────────────────

describe("P-2: FTS5 two-pass search — AND mode first, OR prefix fallback", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("AND mode finds exact matches", () => {
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "prod-project",
      type: "decision",
      title: "Authentication Decision",
      content: "We use JWT authentication with 24-hour expiry",
      topic_key: null,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    // "JWT authentication" — both words are in the content → AND mode succeeds
    const results = SemanticRecall.search("JWT authentication", [projectScope], 10)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toBe("Authentication Decision")
  })

  test("prefix-OR fallback finds partial matches that AND mode misses", () => {
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "prod-project",
      type: "decision",
      title: "Auth Architecture",
      content: "authentication is implemented using stateless JWT tokens with refresh capability",
      topic_key: null,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    // "auth jwt" — "auth" would NOT match "authentication" with exact AND mode
    // but "auth*" prefix matches "authentication" in OR mode
    const results = SemanticRecall.search("auth jwt", [projectScope], 10)
    expect(results.length).toBeGreaterThan(0)
    // Title should contain "Auth"
    expect(results.some((r) => r.title.toLowerCase().includes("auth"))).toBe(true)
  })

  test("FTS5 special characters do not crash (two-pass mode)", () => {
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "prod-project",
      type: "pattern",
      title: "Test Pattern",
      content: "test content for special char handling",
      topic_key: null,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    // These should not throw in either AND or OR pass
    expect(() => SemanticRecall.search("AND OR NOT", [projectScope], 5)).not.toThrow()
    expect(() => SemanticRecall.search("fix: bug", [projectScope], 5)).not.toThrow()
    expect(() => SemanticRecall.search("(parens)", [projectScope], 5)).not.toThrow()
  })

  test("scope filtering works in both AND and OR modes", () => {
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "prod-project",
      type: "observation",
      title: "Project Auth",
      content: "authentication for the project",
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
      title: "User Auth Pattern",
      content: "authentication preferences for the user",
      topic_key: null,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    // Only project scope
    const projectResults = SemanticRecall.search("auth", [projectScope], 10)
    expect(projectResults.every((r) => r.scope_type === "project")).toBe(true)
  })
})

// ─── P-3: Memory.buildContext() fallback to recent() ─────────────────────────

describe("P-3: Memory.buildContext() falls back to recent() when FTS returns empty", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("returns recent artifacts when FTS query has no matches", async () => {
    // Index an artifact about database design
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "prod-project",
      type: "decision",
      title: "Database Schema Decision",
      content: "Using PostgreSQL with connection pooling for the production database",
      topic_key: "db/schema",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    // Query for something completely unrelated — FTS AND would return nothing
    // But OR mode might also return nothing if query tokens don't prefix-match anything
    // In that case, fallback to recency should return the artifact
    const ctx = await Memory.buildContext({
      scope: { type: "thread", id: "fallback-test" },
      ancestorScopes: [projectScope],
      semanticQuery: "COMPLETELY_UNMATCHED_ZZZXXX", // guaranteed no FTS match
    })

    // Fallback should populate semanticRecall with the most recent artifact
    expect(ctx.semanticRecall).toBeDefined()
    expect(ctx.semanticRecall).toContain("Database Schema Decision")
  })

  test("returns FTS results when they exist (no unnecessary fallback)", async () => {
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "prod-project",
      type: "decision",
      title: "Auth Strategy JWT",
      content: "JWT tokens used for authentication with 24-hour expiry",
      topic_key: null,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    const ctx = await Memory.buildContext({
      scope: { type: "thread", id: "fts-test" },
      ancestorScopes: [projectScope],
      semanticQuery: "JWT authentication",
    })

    expect(ctx.semanticRecall).toBeDefined()
    expect(ctx.semanticRecall).toContain("JWT")
  })

  test("returns undefined semanticRecall when no artifacts at all", async () => {
    // Empty DB — no artifacts
    const ctx = await Memory.buildContext({
      scope: { type: "thread", id: "empty-test" },
      ancestorScopes: [projectScope],
      semanticQuery: "some query",
    })

    expect(ctx.semanticRecall).toBeUndefined()
  })
})

// ─── P-4: Agent scope in UpdateWorkingMemoryTool ──────────────────────────────

describe("P-4: Agent scope is operational in UpdateWorkingMemoryTool", () => {
  test("tool/memory.ts exposes agent scope as enum option", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/tool/memory.ts"), "utf-8") as string

    expect(src).toContain('"agent"')
    expect(src).toContain('.enum(["thread", "agent", "project"])')
  })

  test("agent scope writes to agent scope_type in working memory", async () => {
    await setup()
    try {
      WorkingMemory.set(agentScope, "mode", "build agent operational memory")
      const records = WorkingMemory.get(agentScope, "mode")
      expect(records).toHaveLength(1)
      expect(records[0].scope_type).toBe("agent")
      expect(records[0].scope_id).toBe("build")
    } finally {
      await teardown()
    }
  })
})

// ─── P-5: Agent scope in Memory.buildContext() ────────────────────────────────

describe("P-5: Agent scope included in Memory.buildContext() ancestry", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("agent working memory is included when passed as ancestor scope", async () => {
    WorkingMemory.set(agentScope, "agent_goal", "Build the auth module end to end")
    WorkingMemory.set(projectScope, "proj_goal", "Ship LightCode V1")

    const ctx = await Memory.buildContext({
      scope: { type: "thread", id: "agent-scope-test" },
      ancestorScopes: [agentScope, projectScope],
    })

    expect(ctx.workingMemory).toBeDefined()
    // Both agent and project keys should be in working memory
    expect(ctx.workingMemory).toContain("Build the auth module")
    expect(ctx.workingMemory).toContain("Ship LightCode V1")
  })

  test("thread overrides agent when same key (precedence works with agent in chain)", () => {
    WorkingMemory.set(agentScope, "focus", "Agent focus: refactoring")
    WorkingMemory.set(threadScope, "focus", "Thread focus: current PR review")

    const records = WorkingMemory.getForScopes(threadScope, [agentScope, projectScope])
    const focusRecords = records.filter((r) => r.key === "focus")

    expect(focusRecords).toHaveLength(1)
    expect(focusRecords[0].scope_type).toBe("thread")
    expect(focusRecords[0].value).toBe("Thread focus: current PR review")
  })

  test("prompt.ts passes agent scope in both normal and fork buildContext calls", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string

    // Find all Memory.buildContext calls in prompt.ts
    const buildContextCount = (src.match(/Memory\.buildContext\(/g) ?? []).length
    expect(buildContextCount).toBeGreaterThanOrEqual(2) // normal + fork

    // Both should include agent scope
    const agentScopeCount = (src.match(/type: "agent"/g) ?? []).length
    expect(agentScopeCount).toBeGreaterThanOrEqual(2)
  })

  test("runtime load path includes user scope and keeps global_pattern dormant", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string
    const loadStart = src.indexOf("async function loadRuntimeMemory(")
    const loadEnd = src.indexOf("function indexSessionArtifacts(", loadStart)
    const body = src.slice(loadStart, loadEnd)

    expect(body).toContain("Memory.userScope()")
    expect(body).not.toContain('type: "global_pattern"')
  })

  test("buildContext includes user working memory when user scope is in ancestry", async () => {
    WorkingMemory.set(projectScope, "proj_pref", "project default")
    WorkingMemory.set(userScope, "user_pref", "user default")

    const ctx = await Memory.buildContext({
      scope: { type: "thread", id: "user-scope-test" },
      ancestorScopes: [agentScope, projectScope, userScope],
    })

    expect(ctx.workingMemory).toBeDefined()
    expect(ctx.workingMemory).toContain("project default")
    expect(ctx.workingMemory).toContain("user default")
  })

  test("runtime buildContext does not load global_pattern when hot path omits it", async () => {
    SemanticRecall.index({
      scope_type: "global_pattern",
      scope_id: globalScope.id,
      type: "pattern",
      title: "Global pattern only",
      content: "global pattern should stay dormant in runtime loading",
      topic_key: null,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    const ctx = await Memory.buildContext({
      scope: { type: "thread", id: "global-dormant-test" },
      ancestorScopes: [agentScope, projectScope, userScope],
      semanticQuery: "global pattern dormant",
    })

    expect(ctx.semanticRecall).toBeUndefined()
  })
})

// ─── P-5C: Explicit user memory write path ────────────────────────────────────

describe("P-5C: update_user_memory is explicit and controlled", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("tool asks for approval before writing user memory", async () => {
    let asked = 0
    const def = await UpdateUserMemoryTool.init()
    const ctx: Tool.Context = {
      sessionID: "user-write-test" as never,
      messageID: "msg-user-write-test" as never,
      agent: "build",
      abort: new AbortController().signal,
      messages: [],
      metadata() {},
      ask(input) {
        asked += 1
        expect(input.permission).toBe("memory.user.write")
        expect(input.patterns).toEqual(["default:workflow"])
        expect(input.always).toEqual([])
        return Promise.resolve()
      },
    }

    await def.execute({ key: "workflow", value: "Prefer concise answers" }, ctx)

    expect(asked).toBe(1)
    expect(WorkingMemory.get(userScope, "workflow")[0].value).toBe("Prefer concise answers")
  })

  test("general working memory tool still does not expose user scope", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/tool/memory.ts"), "utf-8") as string

    expect(src).toContain('Tool.define("update_user_memory"')
    expect(src).toContain('.enum(["thread", "agent", "project"])')
    expect(src).not.toContain('.enum(["thread", "agent", "project", "user"])')
  })
})

// ─── P-5B: DB-first durable child recovery ───────────────────────────────────

describe("P-5B: Durable child recovery is consumed from DB state", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("prompt.ts reads Memory.getHandoff() and Memory.getForkContext() via durable hydration helper", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string

    expect(src).toContain("function durableChildHydration(")
    expect(src).toContain("Memory.getHandoff(sessionID)")
    expect(src).toContain("Memory.getForkContext(sessionID)")
  })

  test("task.ts writes enriched fork snapshot with workingMemorySnapshot values", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/tool/task.ts"), "utf-8") as string

    expect(src).toContain("workingMemorySnapshot")
    expect(src).toContain("key: r.key")
    expect(src).toContain("value: r.value")
  })

  test("Memory.writeHandoff() persists and Memory.getHandoff() retrieves child handoff state", () => {
    const id = Memory.writeHandoff({
      parent_session_id: "parent-prod-1",
      child_session_id: "child-prod-1",
      context: "Implement auth recovery",
      working_memory_snap: JSON.stringify([{ key: "goal", value: "ship auth" }]),
      observation_snap: "Current task: auth recovery",
      metadata: JSON.stringify({ parentAgent: "build", projectId: "prod-project" }),
    })

    expect(id).toBeTruthy()
    const row = Memory.getHandoff("child-prod-1")
    expect(row).toBeDefined()
    expect(row!.context).toBe("Implement auth recovery")
    expect(JSON.parse(row!.working_memory_snap!)[0].value).toBe("ship auth")
  })
})

// ─── P-6: runLoop structural comments ────────────────────────────────────────

describe("P-6: runLoop has structural section comments", () => {
  test("prompt.ts has OM Coordinator section comment", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string

    expect(src).toContain("OM Coordinator")
  })

  test("prompt.ts has Memory Assembler section comment", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf-8") as string

    expect(src).toContain("Memory Assembler")
  })
})

// ─── P-6B: Working memory guidance is live in hot path ───────────────────────

describe("P-6B: Working memory guidance is present in provider hot path output", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("Memory.buildContext workingMemory includes update_working_memory guidance", async () => {
    WorkingMemory.set(projectScope, "goals", "Ship production memory")

    const ctx = await Memory.buildContext({
      scope: { type: "thread", id: "wm-guidance-test" },
      ancestorScopes: [agentScope, projectScope],
    })

    expect(ctx.workingMemory).toBeDefined()
    expect(ctx.workingMemory).toContain("update_working_memory")
    expect(ctx.workingMemory).toContain('scope="project"')
  })
})

// ─── P-7: Dead Engram recall code removed from system.ts ──────────────────────

describe("P-7: Dead Engram recall code removed from system.ts", () => {
  test("callEngramTool() is removed from system.ts", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/system.ts"), "utf-8") as string

    expect(src).not.toContain("async function callEngramTool(")
    expect(src).not.toContain("async function recallNative(")
    expect(src).not.toContain("async function recallEngram(")
  })

  test("system.ts no longer imports MCP (was only used by callEngramTool)", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/session/system.ts"), "utf-8") as string

    // MCP import was removed when callEngramTool was removed
    const importLines = src.split("\n").filter((l) => l.startsWith("import") && !l.startsWith("//"))
    const mcpImport = importLines.find((l) => l.includes("MCP"))
    expect(mcpImport).toBeUndefined()
  })
})

// ─── P-8: OPENCODE_MEMORY_USE_ENGRAM removed from flag.ts ─────────────────────

describe("P-8: OPENCODE_MEMORY_USE_ENGRAM flag removed from flag.ts", () => {
  test("flag.ts does not export OPENCODE_MEMORY_USE_ENGRAM", async () => {
    const { Flag } = await import("../../src/flag/flag")
    expect((Flag as any).OPENCODE_MEMORY_USE_ENGRAM).toBeUndefined()
  })

  test("flag.ts still exports OPENCODE_DREAM_USE_NATIVE_MEMORY (still used)", async () => {
    const { Flag } = await import("../../src/flag/flag")
    expect(typeof Flag.OPENCODE_DREAM_USE_NATIVE_MEMORY).toBe("boolean")
  })
})

// ─── P-9: Scope dormancy documented ──────────────────────────────────────────

describe("P-9: Scope dormancy documented in contracts.ts", () => {
  test("contracts.ts documents scope operational status", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/memory/contracts.ts"), "utf-8") as string

    expect(src).toContain("OPERATIONAL")
    expect(src).toContain("DORMANT")
    expect(src).toContain("user")
    expect(src).toContain("global_pattern")
  })

  test("contracts.ts documents Precedence ordering", () => {
    const src = require("fs").readFileSync(path.join(__dirname, "../../src/memory/contracts.ts"), "utf-8") as string

    expect(src).toContain("thread > agent > project > user > global_pattern")
  })
})

// ─── P-R: No regression ───────────────────────────────────────────────────────

describe("P-R: No regression on prior behaviors", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("WorkingMemory CRUD unchanged", () => {
    WorkingMemory.set(projectScope, "k", "v")
    expect(WorkingMemory.get(projectScope, "k")[0].value).toBe("v")
  })

  test("SemanticRecall topic_key dedupe unchanged", () => {
    const id1 = SemanticRecall.index({
      scope_type: "project",
      scope_id: "prod-project",
      type: "decision",
      title: "D1",
      content: "c1",
      topic_key: "prod/regression/dedupe",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })
    const id2 = SemanticRecall.index({
      scope_type: "project",
      scope_id: "prod-project",
      type: "decision",
      title: "D2",
      content: "c2",
      topic_key: "prod/regression/dedupe",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })
    expect(id1).toBe(id2)
    expect(SemanticRecall.get(id1)!.revision_count).toBe(2)
  })

  test("Memory.buildContext() returns correct structure", async () => {
    WorkingMemory.set(projectScope, "regression_key", "value for regression")
    const ctx = await Memory.buildContext({
      scope: { type: "thread", id: "regression-test" },
      ancestorScopes: [projectScope],
    })
    expect(ctx.workingMemory).toBeDefined()
    expect(ctx.workingMemory).toContain("regression_key")
  })

  test("Handoff fork persistence unchanged", () => {
    Handoff.writeFork({ sessionId: "c-prod", parentSessionId: "p-prod", context: "ctx" })
    expect(Handoff.getFork("c-prod")!.context).toBe("ctx")
  })

  test("addBufferSafe() still exists and is callable", () => {
    const { OM } = require("../../src/session/om/record")
    expect(typeof OM.addBufferSafe).toBe("function")
  })
})

// ─── Production recall: integration quality test ──────────────────────────────

describe("Production recall quality: natural language queries work", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("natural language query 'how does authentication work' can find auth artifacts", () => {
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "prod-project",
      type: "decision",
      title: "Authentication Architecture",
      content:
        "authentication is handled via JWT tokens. Users authenticate by sending credentials to /auth/login endpoint which returns a signed JWT token with 24-hour expiry.",
      topic_key: "architecture/auth",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    // This query would have returned 0 results with the old exact-AND mode
    // because "how", "does", "work" are NOT in the content.
    // With OR prefix mode, "auth*" → matches "authentication", "authenticate"
    const results = SemanticRecall.search("how does auth work", [projectScope], 10)

    // The two-pass search should find it via OR mode
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.title.toLowerCase().includes("auth"))).toBe(true)
  })

  test("exact match still works with two-pass approach", () => {
    SemanticRecall.index({
      scope_type: "project",
      scope_id: "prod-project",
      type: "pattern",
      title: "TypeScript Strict Mode Pattern",
      content: "All TypeScript code must use strict mode with noImplicitAny enabled",
      topic_key: null,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    // Exact token match — AND mode should find this first
    const results = SemanticRecall.search("TypeScript strict", [projectScope], 10)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toBe("TypeScript Strict Mode Pattern")
  })
})
