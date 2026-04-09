/**
 * LightCode Memory — Production Validation Tests
 *
 * Tests for production-readiness changes that remain unique after Phase 4 + shim removal:
 * P-1:  Working memory precedence — thread > agent > project > user > global_pattern (bug fix)
 * P-2:  FTS5 two-pass search unique cases (singular→plural, special chars, scope filter both modes, topic_key scope)
 * P-3:  Memory.buildContext() fallback to recent() when FTS returns empty
 * P-4:  Agent scope is operational in UpdateWorkingMemoryTool
 * P-5:  Agent/user scope in Memory.buildContext() ancestry + block metadata ordering
 * P-5C: update_user_memory permission approval gate (security-critical)
 * P-6B: Working memory guidance is present in provider hot path output
 * P-8:  OPENCODE_MEMORY_USE_ENGRAM flag removed from flag.ts
 * P-9:  Scope defaults remain stable
 */

import { beforeEach, describe, test, expect } from "bun:test"
import { Database } from "../../src/storage/db"
import { DEFAULT_USER_SCOPE_ID } from "../../src/memory/contracts"
import { Memory } from "../../src/memory/provider"
import { FTS5Backend } from "../../src/memory/fts5-backend"
import { WorkingMemory } from "../../src/memory/working-memory"
import { OM } from "../../src/session/om"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { SessionTable } from "../../src/session/session.sql"
import { SessionID } from "../../src/session/schema"
import { UpdateUserMemoryTool, UpdateWorkingMemoryTool } from "../../src/tool/memory"
import { ToolRegistry } from "../../src/tool/registry"
import { Instance } from "../../src/project/instance"
import type { Tool } from "../../src/tool/tool"
import type { ScopeRef } from "../../src/memory/contracts"
import { tmpdir } from "../fixture/fixture"

// ─── Test DB setup ────────────────────────────────────────────────────────────

const CLEAN_TABLES = [
  "memory_working",
  "memory_artifacts",
  "memory_agent_handoffs",
  "memory_fork_contexts",
  "memory_links",
  "memory_session_chunks",
  "session_observation",
  "session",
  "project",
]

async function setup() {
  const db = await Database.Client()
  for (const t of CLEAN_TABLES) {
    try {
      await db.$client.execute(`DELETE FROM ${t}`)
    } catch {}
  }
}

const threadScope: ScopeRef = { type: "thread", id: "prod-thread" }
const agentScope: ScopeRef = { type: "agent", id: "build" }
const projectScope: ScopeRef = { type: "project", id: "prod-project" }
const userScope: ScopeRef = { type: "user", id: "default" }
const globalScope: ScopeRef = { type: "global_pattern", id: "prod-global" }

async function seedSession(sid = threadScope.id, pid = projectScope.id) {
  const now = Date.now()
  await Database.use((db) =>
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
  await Database.use((db) =>
    db
      .insert(SessionTable)
      .values({
        id: SessionID.make(sid),
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

// ─── P-1: Working Memory Precedence ──────────────────────────────────────────

describe("P-1: Working memory precedence — thread > agent > project", () => {
  beforeEach(setup)

  test("thread value wins over project when same key (bug fix)", async () => {
    await WorkingMemory.set(projectScope, "goals", "Project goals: ship V1")
    await WorkingMemory.set(threadScope, "goals", "Thread goals: fix auth bug")

    const records = await WorkingMemory.getForScopes(threadScope, [projectScope])

    // Only ONE record for key "goals" — thread wins
    const goalRecords = records.filter((r) => r.key === "goals")
    expect(goalRecords.length).toBe(1)
    expect(goalRecords[0].value).toBe("Thread goals: fix auth bug")
    expect(goalRecords[0].scope_type).toBe("thread")
  })

  test("agent value wins over project when same key", async () => {
    await WorkingMemory.set(projectScope, "constraints", "No breaking changes")
    await WorkingMemory.set(agentScope, "constraints", "Focus only on auth module")

    const records = await WorkingMemory.getForScopes(agentScope, [projectScope])

    const constraintRecords = records.filter((r) => r.key === "constraints")
    expect(constraintRecords.length).toBe(1)
    expect(constraintRecords[0].value).toBe("Focus only on auth module")
    expect(constraintRecords[0].scope_type).toBe("agent")
  })

  test("thread > agent > project precedence chain", async () => {
    await WorkingMemory.set(projectScope, "context", "Project context")
    await WorkingMemory.set(agentScope, "context", "Agent context")
    await WorkingMemory.set(threadScope, "context", "Thread context — most specific")

    const records = await WorkingMemory.getForScopes(threadScope, [agentScope, projectScope])

    const contextRecords = records.filter((r) => r.key === "context")
    expect(contextRecords.length).toBe(1)
    expect(contextRecords[0].value).toBe("Thread context — most specific")
    expect(contextRecords[0].scope_type).toBe("thread")
  })

  test("unique keys from all scopes are all returned", async () => {
    await WorkingMemory.set(projectScope, "proj_key", "project value")
    await WorkingMemory.set(agentScope, "agent_key", "agent value")
    await WorkingMemory.set(threadScope, "thread_key", "thread value")

    const records = await WorkingMemory.getForScopes(threadScope, [agentScope, projectScope])

    // All 3 unique keys should be present (no cross-scope collision here)
    const keys = records.map((r) => r.key)
    expect(keys).toContain("proj_key")
    expect(keys).toContain("agent_key")
    expect(keys).toContain("thread_key")
    expect(records.length).toBe(3)
  })

  test("user scope below project in precedence", async () => {
    await WorkingMemory.set(userScope, "preference", "User pref")
    await WorkingMemory.set(projectScope, "preference", "Project pref overrides user")

    // project is an ancestor before user in the chain
    const records = await WorkingMemory.getForScopes(threadScope, [projectScope, userScope])

    const prefRecords = records.filter((r) => r.key === "preference")
    expect(prefRecords.length).toBe(1)
    expect(prefRecords[0].value).toBe("Project pref overrides user")
    expect(prefRecords[0].scope_type).toBe("project")
  })

  test("old bug: scope_type:key dedup key was wrong — verify fix", async () => {
    // This is the regression test for the production bug.
    // Before the fix, dedup key was `"${scope_type}:${key}"` which means
    // project:"goals" and thread:"goals" were treated as different keys → BOTH returned.
    // After fix: dedup key is just `key` → only thread's "goals" returned.

    await WorkingMemory.set(projectScope, "goals", "Project goals")
    await WorkingMemory.set(threadScope, "goals", "Thread goals")

    const records = await WorkingMemory.getForScopes(threadScope, [projectScope])

    // Correct behavior: exactly 1 record for "goals" (thread wins)
    const goalRecords = records.filter((r) => r.key === "goals")
    expect(goalRecords).toHaveLength(1)
    // Bug condition: if both were returned, this would be 2
    expect(goalRecords[0].scope_type).toBe("thread")
  })

  test("thread > agent > project > user > global_pattern precedence chain", async () => {
    await WorkingMemory.set(globalScope, "mode", "Global mode")
    await WorkingMemory.set(userScope, "mode", "User mode")
    await WorkingMemory.set(projectScope, "mode", "Project mode")
    await WorkingMemory.set(agentScope, "mode", "Agent mode")
    await WorkingMemory.set(threadScope, "mode", "Thread mode")

    const records = await WorkingMemory.getForScopes(threadScope, [agentScope, projectScope, userScope, globalScope])
    const mode = records.filter((r) => r.key === "mode")

    expect(mode).toHaveLength(1)
    expect(mode[0].scope_type).toBe("thread")
    expect(mode[0].value).toBe("Thread mode")
  })

  test("fixed precedence does not depend on ancestor order", async () => {
    await WorkingMemory.set(userScope, "policy", "User policy")
    await WorkingMemory.set(projectScope, "policy", "Project policy")

    const records = await WorkingMemory.getForScopes(threadScope, [userScope, projectScope])
    const policy = records.filter((r) => r.key === "policy")

    expect(policy).toHaveLength(1)
    expect(policy[0].scope_type).toBe("project")
    expect(policy[0].value).toBe("Project policy")
  })
})

// ─── P-2: FTS5 Two-Pass Search — unique cases ────────────────────────────────

describe("P-2: FTS5 two-pass search unique cases", () => {
  beforeEach(setup)

  test("prefix-OR fallback handles single-token singular to plural matches", async () => {
    const fts = new FTS5Backend()
    await fts.index({
      scope_type: "project",
      scope_id: "prod-project",
      type: "decision",
      title: "Plural reminders",
      content: "reminders are persisted in working memory",
      topic_key: null,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    const results = await fts.search("reminder", [projectScope], 10)
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.title === "Plural reminders")).toBe(true)
  })

  test("FTS5 special characters do not crash (two-pass mode)", async () => {
    const fts = new FTS5Backend()
    await fts.index({
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
    await expect(fts.search("AND OR NOT", [projectScope], 5)).resolves.toBeDefined()
    await expect(fts.search("fix: bug", [projectScope], 5)).resolves.toBeDefined()
    await expect(fts.search("(parens)", [projectScope], 5)).resolves.toBeDefined()
  })

  test("scope filtering works in both AND and OR modes", async () => {
    const fts = new FTS5Backend()
    await fts.index({
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
    await fts.index({
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
    const projectResults = await fts.search("auth", [projectScope], 10)
    expect(projectResults.every((r) => r.scope_type === "project")).toBe(true)
  })

  test("topic_key search respects scope filters", async () => {
    const fts = new FTS5Backend()
    await fts.index({
      scope_type: "project",
      scope_id: projectScope.id,
      type: "decision",
      title: "Project auth topic",
      content: "project-only auth decision",
      topic_key: "auth/decision",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })
    await fts.index({
      scope_type: "user",
      scope_id: userScope.id,
      type: "decision",
      title: "User auth topic",
      content: "user-only auth preference",
      topic_key: "auth/decision",
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })

    const projectResults = await fts.search("auth/decision", [projectScope], 10)
    const userResults = await fts.search("auth/decision", [userScope], 10)

    expect(projectResults).toHaveLength(1)
    expect(projectResults[0].scope_type).toBe("project")
    expect(projectResults[0].title).toBe("Project auth topic")
    expect(userResults).toHaveLength(1)
    expect(userResults[0].scope_type).toBe("user")
    expect(userResults[0].title).toBe("User auth topic")
  })
})

// ─── P-3: Memory.buildContext() fallback to recent() ─────────────────────────

describe("P-3: Memory.buildContext() falls back to recent() when FTS returns empty", () => {
  beforeEach(setup)

  test("returns recent artifacts when FTS query has no matches", async () => {
    // Index an artifact about database design
    await Memory.indexArtifact({
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
    await Memory.indexArtifact({
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
})

// ─── P-4: Agent scope in UpdateWorkingMemoryTool ──────────────────────────────

describe("P-4: Agent scope is operational in UpdateWorkingMemoryTool", () => {
  test("tool registry exposes both working-memory tools at runtime", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("update_working_memory")
        expect(ids).toContain("update_user_memory")
      },
    })
  })

  test("agent scope writes to agent scope_type in working memory", async () => {
    await setup()
    await WorkingMemory.set(agentScope, "mode", "build agent operational memory")
    const records = await WorkingMemory.get(agentScope, "mode")
    expect(records).toHaveLength(1)
    expect(records[0].scope_type).toBe("agent")
    expect(records[0].scope_id).toBe("build")
  })

  test("general working memory schema accepts agent and rejects user scope", async () => {
    const def = await UpdateWorkingMemoryTool.init()

    expect(() => def.parameters.parse({ scope: "agent", key: "mode", value: "ship it" })).not.toThrow()
    expect(() => def.parameters.parse({ scope: "user", key: "mode", value: "nope" })).toThrow()
  })
})

// ─── P-5: Agent scope in Memory.buildContext() ────────────────────────────────

describe("P-5: Agent scope included in Memory.buildContext() ancestry", () => {
  beforeEach(setup)

  test("agent working memory is included when passed as ancestor scope", async () => {
    await WorkingMemory.set(agentScope, "agent_goal", "Build the auth module end to end")
    await WorkingMemory.set(projectScope, "proj_goal", "Ship LightCode V1")

    const ctx = await Memory.buildContext({
      scope: { type: "thread", id: "agent-scope-test" },
      ancestorScopes: [agentScope, projectScope],
    })

    expect(ctx.workingMemory).toBeDefined()
    // Both agent and project keys should be in working memory
    expect(ctx.workingMemory).toContain("Build the auth module")
    expect(ctx.workingMemory).toContain("Ship LightCode V1")
  })

  test("thread overrides agent when same key (precedence works with agent in chain)", async () => {
    await WorkingMemory.set(agentScope, "focus", "Agent focus: refactoring")
    await WorkingMemory.set(threadScope, "focus", "Thread focus: current PR review")

    const records = await WorkingMemory.getForScopes(threadScope, [agentScope, projectScope])
    const focusRecords = records.filter((r) => r.key === "focus")

    expect(focusRecords).toHaveLength(1)
    expect(focusRecords[0].scope_type).toBe("thread")
    expect(focusRecords[0].value).toBe("Thread focus: current PR review")
  })

  test("buildContext includes user working memory when user scope is in ancestry", async () => {
    await WorkingMemory.set(projectScope, "proj_pref", "project default")
    await WorkingMemory.set(userScope, "user_pref", "user default")

    const ctx = await Memory.buildContext({
      scope: { type: "thread", id: "user-scope-test" },
      ancestorScopes: [agentScope, projectScope, userScope],
    })

    expect(ctx.workingMemory).toBeDefined()
    expect(ctx.workingMemory).toContain("project default")
    expect(ctx.workingMemory).toContain("user default")
  })

  test("buildContext returns block metadata with stable ordering", async () => {
    await seedSession()
    await WorkingMemory.set(projectScope, "proj_pref", "project default")
    await Memory.indexArtifact({
      scope_type: "project",
      scope_id: projectScope.id,
      type: "decision",
      title: "Cacheable recall",
      content: "Recall is available for this project",
      topic_key: null,
      normalized_hash: null,
      revision_count: 1,
      duplicate_count: 1,
      last_seen_at: null,
      deleted_at: null,
    })
    await OM.upsert({
      id: SessionID.make("obs-prod-blocks"),
      session_id: SessionID.make(threadScope.id),
      observations: "Stable observations body",
      reflections: null,
      current_task: null,
      suggested_continuation: "Continue the stable flow",
      last_observed_at: null,
      retention_floor_at: null,
      generation_count: 1,
      observation_tokens: 100,
      observed_message_ids: null,
      time_created: Date.now(),
      time_updated: Date.now(),
    })

    const ctx = await Memory.buildContext({
      scope: threadScope,
      ancestorScopes: [agentScope, projectScope, userScope],
      semanticQuery: "recall stable",
    })

    expect(ctx.blocks.map((x) => x.key)).toEqual([
      "working_memory",
      "observations_stable",
      "observations_live",
      "semantic_recall",
    ])
    expect(ctx.blocks.every((x) => x.hash.length > 0)).toBe(true)
    expect(ctx.blocks.every((x) => x.tokens > 0)).toBe(true)
    expect(ctx.observationsStable).toContain("Stable observations body")
    expect(ctx.observationsLive).toContain("Continue the stable flow")
  })

  test("runtime buildContext does not load global_pattern when hot path omits it", async () => {
    await Memory.indexArtifact({
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
    expect((await WorkingMemory.get(userScope, "workflow"))[0].value).toBe("Prefer concise answers")
  })

  test("tool does not write user memory when approval rejects", async () => {
    const def = await UpdateUserMemoryTool.init()
    const ctx: Tool.Context = {
      sessionID: "user-write-reject" as never,
      messageID: "msg-user-write-reject" as never,
      agent: "build",
      abort: new AbortController().signal,
      messages: [],
      metadata() {},
      ask() {
        return Promise.reject(new Error("rejected"))
      },
    }

    await expect(def.execute({ key: "defaults", value: "dark mode" }, ctx)).rejects.toThrow("rejected")
    expect(await WorkingMemory.get(userScope, "defaults")).toHaveLength(0)
  })
})

// ─── P-6B: Working memory guidance is live in hot path ───────────────────────

describe("P-6B: Working memory guidance is present in provider hot path output", () => {
  beforeEach(setup)

  test("Memory.buildContext workingMemory includes update_working_memory guidance", async () => {
    await WorkingMemory.set(projectScope, "goals", "Ship production memory")

    const ctx = await Memory.buildContext({
      scope: { type: "thread", id: "wm-guidance-test" },
      ancestorScopes: [agentScope, projectScope],
    })

    expect(ctx.workingMemory).toBeDefined()
    expect(ctx.workingMemory).toContain("update_working_memory")
    expect(ctx.workingMemory).toContain('scope="project"')
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

// ─── P-9: Scope defaults remain stable ───────────────────────────────────────

describe("P-9: Scope defaults remain stable", () => {
  test("user scope helper uses the exported default id", () => {
    expect(DEFAULT_USER_SCOPE_ID).toBe("default")
    expect(Memory.userScope()).toEqual({ type: "user", id: DEFAULT_USER_SCOPE_ID })
  })
})
