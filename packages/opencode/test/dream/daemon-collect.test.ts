/**
 * Daemon collectProjectObsFromDB — SQLite contract tests
 *
 * These tests verify the logic of collectProjectObsFromDB (inline mirror of
 * daemon.ts) and the serverAlive probe, using a real SQLite DB via the test
 * fixture pattern established in the project.
 *
 * DC-1: skips sessions with observation_tokens < 1000
 * DC-2: uses reflections when present (over observations)
 * DC-3: falls back to observations when reflections is null
 * DC-4: includes current_task when present
 * DC-5: separates multiple session results with ---
 * DC-6: returns empty string when no sessions match the project directory
 * DC-7: returns empty string on DB error
 * DC-8: skips rows where both observations and reflections are null
 * DC-9: serverAlive returns false when URL is empty
 * DC-10: serverAlive returns false when server is unreachable
 */

import { beforeEach, afterEach, describe, test, expect } from "bun:test"
import os from "os"
import path from "path"
import { rm } from "fs/promises"
import { Database, eq } from "../../src/storage/db"
import { ObservationTable } from "../../src/session/session.sql"
import { SessionTable } from "../../src/session/session.sql"
import { ProjectTable } from "../../src/project/project.sql"
import type { SessionID } from "../../src/session/schema"
import type { ProjectID } from "../../src/project/schema"

// ─── DB fixture ───────────────────────────────────────────────────────────────

let testDbPath: string

async function setup() {
  testDbPath = path.join(os.tmpdir(), `daemon-collect-${Math.random().toString(36).slice(2)}.db`)
  try {
    await Database.close()
  } catch {}
  Database.Client.reset()
  process.env["OPENCODE_DB"] = testDbPath
  await Database.Client()
}

async function teardown() {
  try {
    await Database.close()
  } catch {}
  Database.Client.reset()
  await rm(testDbPath, { force: true }).catch(() => undefined)
  await rm(`${testDbPath}-wal`, { force: true }).catch(() => undefined)
  await rm(`${testDbPath}-shm`, { force: true }).catch(() => undefined)
  delete process.env["OPENCODE_DB"]
}

// ─── Mirror of collectProjectObsFromDB from daemon.ts ────────────────────────
// Same logic, same SQL — testable without spawning a child process.

async function collectForDir(dir: string): Promise<string> {
  try {
    const rows = (await Database.use((db) =>
      db
        .select()
        .from(ObservationTable)
        .innerJoin(SessionTable, eq(ObservationTable.session_id, SessionTable.id))
        .where(eq(SessionTable.directory, dir))
        .all(),
    )) as Array<{
      session_observation: {
        observations: string | null
        reflections: string | null
        current_task: string | null
        observation_tokens: number
      }
    }>

    const parts: string[] = []
    for (const row of rows) {
      if (!row.session_observation.observation_tokens || row.session_observation.observation_tokens < 1000) continue
      const acc: string[] = []
      if (row.session_observation.current_task)
        acc.push(`<current-task>\n${row.session_observation.current_task}\n</current-task>`)
      if (row.session_observation.reflections)
        acc.push(`<reflections>\n${row.session_observation.reflections}\n</reflections>`)
      else if (row.session_observation.observations)
        acc.push(`<observations>\n${row.session_observation.observations}\n</observations>`)
      if (acc.length) parts.push(acc.join("\n\n"))
    }

    return parts.join("\n\n---\n\n")
  } catch {
    return ""
  }
}

// ─── Mirror of serverAlive from daemon.ts ────────────────────────────────────

async function serverAlive(url: string): Promise<boolean> {
  if (!url) return false
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1_000)
    const r = await fetch(`${url}/health`, { signal: ctrl.signal })
    clearTimeout(t)
    return r.ok
  } catch {
    return false
  }
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

const PROJECT_DIR = "/tmp/test-dream-project"
const PROJECT2_DIR = "/tmp/other-project"

function seedProject(dir: string, id: string) {
  return Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: id as ProjectID,
        worktree: dir,
        sandboxes: [],
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .onConflictDoNothing()
      .run(),
  )
}

function seedSession(id: string, dir: string, projectId: string) {
  return Database.use((db) =>
    db
      .insert(SessionTable)
      .values({
        id: id as SessionID,
        project_id: projectId as ProjectID,
        directory: dir,
        slug: id,
        title: `Session ${id}`,
        version: "1",
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .onConflictDoNothing()
      .run(),
  )
}

function seedObs(opts: {
  id: string
  sessionId: string
  observations?: string | null
  reflections?: string | null
  current_task?: string | null
  observation_tokens: number
}) {
  return Database.use((db) =>
    db
      .insert(ObservationTable)
      .values({
        id: opts.id as SessionID,
        session_id: opts.sessionId as SessionID,
        observations: opts.observations ?? null,
        reflections: opts.reflections ?? null,
        current_task: opts.current_task ?? null,
        suggested_continuation: null,
        last_observed_at: Date.now(),
        retention_floor_at: null,
        generation_count: 1,
        observation_tokens: opts.observation_tokens,
        observed_message_ids: null,
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .onConflictDoNothing()
      .run(),
  )
}

// ─── DC-1: observation_tokens threshold ──────────────────────────────────────

describe("DC-1: sessions below observation_tokens threshold are skipped", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("skips session with observation_tokens = 0", async () => {
    await seedProject(PROJECT_DIR, "proj-1")
    await seedSession("s1", PROJECT_DIR, "proj-1")
    await seedObs({ id: "o1", sessionId: "s1", observations: "some obs", observation_tokens: 0 })
    expect(await collectForDir(PROJECT_DIR)).toBe("")
  })

  test("skips session with observation_tokens = 999", async () => {
    await seedProject(PROJECT_DIR, "proj-2")
    await seedSession("s2", PROJECT_DIR, "proj-2")
    await seedObs({ id: "o2", sessionId: "s2", observations: "obs", observation_tokens: 999 })
    expect(await collectForDir(PROJECT_DIR)).toBe("")
  })

  test("includes session with observation_tokens = 1000", async () => {
    await seedProject(PROJECT_DIR, "proj-3")
    await seedSession("s3", PROJECT_DIR, "proj-3")
    await seedObs({ id: "o3", sessionId: "s3", observations: "fact A", observation_tokens: 1000 })
    expect(await collectForDir(PROJECT_DIR)).toContain("fact A")
  })

  test("includes session with observation_tokens = 50000", async () => {
    await seedProject(PROJECT_DIR, "proj-4")
    await seedSession("s4", PROJECT_DIR, "proj-4")
    await seedObs({ id: "o4", sessionId: "s4", observations: "deep insight", observation_tokens: 50_000 })
    expect(await collectForDir(PROJECT_DIR)).toContain("deep insight")
  })
})

// ─── DC-2: reflections priority ──────────────────────────────────────────────

describe("DC-2: uses reflections when present", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("reflections block is included when non-null", async () => {
    await seedProject(PROJECT_DIR, "proj-r1")
    await seedSession("sr1", PROJECT_DIR, "proj-r1")
    await seedObs({
      id: "or1",
      sessionId: "sr1",
      observations: "raw obs",
      reflections: "compressed ref",
      observation_tokens: 5000,
    })
    const result = await collectForDir(PROJECT_DIR)
    expect(result).toContain("<reflections>")
    expect(result).toContain("compressed ref")
  })

  test("observations block is NOT included when reflections is present", async () => {
    await seedProject(PROJECT_DIR, "proj-r2")
    await seedSession("sr2", PROJECT_DIR, "proj-r2")
    await seedObs({
      id: "or2",
      sessionId: "sr2",
      observations: "raw obs",
      reflections: "compressed ref",
      observation_tokens: 5000,
    })
    const result = await collectForDir(PROJECT_DIR)
    expect(result).not.toContain("<observations>")
    expect(result).not.toContain("raw obs")
  })
})

// ─── DC-3: observations fallback ─────────────────────────────────────────────

describe("DC-3: falls back to observations when reflections is null", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("observations block used when reflections is null", async () => {
    await seedProject(PROJECT_DIR, "proj-f1")
    await seedSession("sf1", PROJECT_DIR, "proj-f1")
    await seedObs({
      id: "of1",
      sessionId: "sf1",
      observations: "raw fact",
      reflections: null,
      observation_tokens: 2000,
    })
    const result = await collectForDir(PROJECT_DIR)
    expect(result).toContain("<observations>")
    expect(result).toContain("raw fact")
  })
})

// ─── DC-4: current_task included ─────────────────────────────────────────────

describe("DC-4: current_task is included when present", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("current_task block prepended before observations", async () => {
    await seedProject(PROJECT_DIR, "proj-t1")
    await seedSession("st1", PROJECT_DIR, "proj-t1")
    await seedObs({
      id: "ot1",
      sessionId: "st1",
      observations: "obs content",
      current_task: "working on auth system",
      observation_tokens: 3000,
    })
    const result = await collectForDir(PROJECT_DIR)
    expect(result).toContain("<current-task>")
    expect(result).toContain("working on auth system")
    // current_task appears before observations
    expect(result.indexOf("<current-task>")).toBeLessThan(result.indexOf("<observations>"))
  })

  test("no current_task block when current_task is null", async () => {
    await seedProject(PROJECT_DIR, "proj-t2")
    await seedSession("st2", PROJECT_DIR, "proj-t2")
    await seedObs({ id: "ot2", sessionId: "st2", observations: "obs", current_task: null, observation_tokens: 1500 })
    expect(await collectForDir(PROJECT_DIR)).not.toContain("<current-task>")
  })
})

// ─── DC-5: multiple sessions separator ───────────────────────────────────────

describe("DC-5: multiple sessions are separated by ---", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("two valid sessions joined with ---", async () => {
    await seedProject(PROJECT_DIR, "proj-m1")
    await seedSession("sm1", PROJECT_DIR, "proj-m1")
    await seedSession("sm2", PROJECT_DIR, "proj-m1")
    await seedObs({ id: "om1", sessionId: "sm1", observations: "obs-A", observation_tokens: 1000 })
    await seedObs({ id: "om2", sessionId: "sm2", observations: "obs-B", observation_tokens: 1000 })
    const result = await collectForDir(PROJECT_DIR)
    expect(result).toContain("obs-A")
    expect(result).toContain("obs-B")
    expect(result).toContain("---")
  })

  test("single valid session has no separator", async () => {
    await seedProject(PROJECT_DIR, "proj-m2")
    await seedSession("sm3", PROJECT_DIR, "proj-m2")
    await seedObs({ id: "om3", sessionId: "sm3", observations: "solo obs", observation_tokens: 1000 })
    expect(await collectForDir(PROJECT_DIR)).not.toContain("---")
  })
})

// ─── DC-6: different project directory ───────────────────────────────────────

describe("DC-6: returns empty string for a different project directory", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("session in another directory is not returned", async () => {
    await seedProject(PROJECT2_DIR, "proj-x1")
    await seedSession("sx1", PROJECT2_DIR, "proj-x1")
    await seedObs({ id: "ox1", sessionId: "sx1", observations: "other project obs", observation_tokens: 5000 })
    // Query for PROJECT_DIR — should find nothing
    expect(await collectForDir(PROJECT_DIR)).toBe("")
  })

  test("only sessions matching the queried directory are returned", async () => {
    await seedProject(PROJECT_DIR, "proj-x2")
    await seedProject(PROJECT2_DIR, "proj-x3")
    await seedSession("sx2", PROJECT_DIR, "proj-x2")
    await seedSession("sx3", PROJECT2_DIR, "proj-x3")
    await seedObs({ id: "ox2", sessionId: "sx2", observations: "my project", observation_tokens: 2000 })
    await seedObs({ id: "ox3", sessionId: "sx3", observations: "other project", observation_tokens: 2000 })
    const result = await collectForDir(PROJECT_DIR)
    expect(result).toContain("my project")
    expect(result).not.toContain("other project")
  })
})

// ─── DC-7: DB error resilience ────────────────────────────────────────────────

describe("DC-7: returns empty string on DB error", () => {
  test("returns '' when DB is not initialized (no setup called)", async () => {
    // DB not open — collectForDir should catch and return ""
    // We test the catch path via the inline mirror which wraps in try/catch
    Database.Client.reset()
    delete process.env["OPENCODE_DB"]
    // The function catches all errors and returns ""
    // In an uninitialized state it may throw internally — verify it doesn't propagate
    await expect(collectForDir("/nonexistent")).resolves.toBe("")
  })
})

// ─── DC-8: both observations and reflections null ─────────────────────────────

describe("DC-8: skips rows where both observations and reflections are null", () => {
  beforeEach(setup)
  afterEach(teardown)

  test("row with null observations and null reflections produces no output", async () => {
    await seedProject(PROJECT_DIR, "proj-n1")
    await seedSession("sn1", PROJECT_DIR, "proj-n1")
    await seedObs({ id: "on1", sessionId: "sn1", observations: null, reflections: null, observation_tokens: 5000 })
    expect(await collectForDir(PROJECT_DIR)).toBe("")
  })
})

// ─── DC-9/10: serverAlive probe ──────────────────────────────────────────────

describe("DC-9/10: serverAlive probe", () => {
  test("DC-9: returns false when URL is empty string", async () => {
    expect(await serverAlive("")).toBe(false)
  })

  test("DC-10: returns false when server is not reachable", async () => {
    // Port 19999 is extremely unlikely to have a server
    expect(await serverAlive("http://127.0.0.1:19999")).toBe(false)
  })
})
