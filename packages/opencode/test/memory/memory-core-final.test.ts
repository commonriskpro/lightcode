/**
 * LightCode Memory Core Final — Validation Tests
 *
 * Tests cover Final changes that remain unique after Phase 4 + shim removal:
 * F-1: addBufferSafe() merges observed ids into existing record (unique merge-path coverage)
 * F-3: Fork context snapshot is enriched (task, OM continuation, WM keys)
 * F-4: Memory.writeHandoff() is wired in task.ts for non-fork sessions (provider layer)
 * F-5: buildContext formats semantic recall with <memory-recall> tags
 * F-8: wrapRecall uses <memory-recall> not <engram-recall>
 */

import { beforeEach, describe, test, expect } from "bun:test"
import { Database } from "../../src/storage/db"
import { Memory } from "../../src/memory/provider"
import { OM } from "../../src/session/om"
import { ProjectID } from "../../src/project/schema"
import { ProjectTable } from "../../src/project/project.sql"
import { SessionTable } from "../../src/session/session.sql"
import { MessageID, SessionID } from "../../src/session/schema"
import type { ScopeRef } from "../../src/memory/contracts"
import { Instance } from "../../src/project/instance"
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
  "subagent_launch",
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

const projectScope: ScopeRef = { type: "project", id: "final-project" }

async function seedSession(sid: SessionID, pid = projectScope.id) {
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

// ─── F-1: addBufferSafe() merges observed ids into existing record ────────────

describe("F-1: addBufferSafe() merge path", () => {
  beforeEach(setup)

  test("addBufferSafe() merges observed ids into existing record", async () => {
    const sid = SessionID.make("final-om-002")
    await seedSession(sid)
    await OM.upsert({
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

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await OM.addBufferSafe(
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
      },
    })

    expect((await OM.get(sid))?.observed_message_ids).toBe(JSON.stringify(["m1", "m2", "m3"]))
  })
})

// ─── F-3: Fork context snapshot enriched ─────────────────────────────────────

describe("F-3: Fork context snapshot is enriched", () => {
  beforeEach(setup)

  test("Memory.writeForkContext stores enriched JSON", async () => {
    await Memory.writeForkContext({
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

    const fork = await Memory.getForkContext("child-final-001")
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

  test("Memory.writeHandoff() persists to memory_agent_handoffs", async () => {
    const id = await Memory.writeHandoff({
      parent_session_id: "parent-handoff-001",
      child_session_id: "child-handoff-001",
      context: "Implement payment processing module",
      working_memory_snap: JSON.stringify([{ key: "tech_stack", value: "TypeScript + Stripe" }]),
      observation_snap: "Working on payment integration with Stripe",
      metadata: JSON.stringify({ parentAgent: "build", projectId: "final-project" }),
    })

    expect(id).toBeTruthy()

    const handoff = await Memory.getHandoff("child-handoff-001")
    expect(handoff).toBeDefined()
    expect(handoff!.parent_session_id).toBe("parent-handoff-001")
    expect(handoff!.context).toBe("Implement payment processing module")
    expect(JSON.parse(handoff!.working_memory_snap!)[0].key).toBe("tech_stack")
  })
})

// ─── F-5: buildContext formats semantic recall with <memory-recall> tags ─────

describe("F-5: buildContext semantic recall tag formatting", () => {
  beforeEach(setup)

  test("buildContext formats semantic recall with memory-recall tags", async () => {
    await Memory.indexArtifact({
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

// ─── F-8: wrapRecall uses <memory-recall> not <engram-recall> ────────────────

describe("F-8: wrapRecall uses <memory-recall> not <engram-recall>", () => {
  test("wrapRecall returns <memory-recall> tag", async () => {
    const { SystemPrompt } = await import("../../src/session/system")
    const result = SystemPrompt.wrapRecall("test content")
    expect(result).toContain("<memory-recall>")
    expect(result).not.toContain("<engram-recall>")
    expect(result).toContain("test content")
  })
})
