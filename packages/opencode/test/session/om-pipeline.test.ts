/**
 * OM Pipeline — Long-Session Integration Tests
 *
 * Tests the full OM lifecycle end-to-end using a real session loop and a
 * mock LLM server. No real API calls. No mocking of internal functions.
 *
 * Architecture:
 *  - TestLLMServer intercepts ALL LLM calls on POST /v1/chat/completions
 *  - Main model = test/test-model (both main and observer point to same server)
 *  - Usage tokens are injected via reply().usage() to drive OMBuf.check()
 *  - observer_message_tokens = 12000, INTERVAL = 6000 (hardcoded in buffer.ts)
 *  - observer_reflection_tokens = 500 → Reflector fires as soon as we have obs
 *  - TestLLMServer.pushMatch() separates Observer calls (contain OM system prompt)
 *    from main LLM calls (everything else)
 *
 * Key insight on token accumulation (processor.ts mid-turn accumulation):
 *  - Each turn's stepTok = input(3500) + output(300) = 3800
 *  - Turn 1: cumulative = 3800  → idle (below INTERVAL=6000 boundary)
 *  - Turn 2: cumulative = 7600  → buffer (crosses 6000 boundary)
 *  - Turn 3: cumulative = 11400 → idle (same interval bucket)
 *  - Turn 4: cumulative = 15200 → block (>= limit=14400) → activate() fires
 *
 * Lifecycle milestones verified:
 *  OM-1: Observer fires and creates observations in DB
 *  OM-2: observation_tokens is non-zero after Observer run
 *  OM-3: last_observed_at is set after observation
 *  OM-4: current_task extracted from Observer XML output
 *  OM-5: tail boundary — msgs after last_observed_at < total msgs
 *  OM-6: generation_count increases with multiple Observer activations
 *  OM-7: 20-turn session — all milestones in sequence with lifecycle table
 */

import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { FileTime } from "../../src/file/time"
import { LSP } from "../../src/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { AppFileSystem } from "../../src/filesystem"
import { Instruction } from "../../src/session/instruction"
import { OMBuf } from "../../src/session/om/buffer"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { Todo } from "../../src/session/todo"
import { Truncate } from "../../src/tool/truncate"
import { ToolRegistry } from "../../src/tool/registry"
import { Snapshot } from "../../src/snapshot"
import { Log } from "../../src/util/log"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"
import type { SessionID } from "../../src/session/schema"
import { Database } from "../../src/storage/db"
import { eq } from "drizzle-orm"
import { ObservationTable, ObservationBufferTable, MessageTable } from "../../src/session/session.sql"

Log.init({ print: false })

// ─── Constants ─────────────────────────────────────────────────────────────────

// Threshold chosen so the buffer/activate sequence works with the processor's
// per-step accumulation. OMBuf has a hardcoded INTERVAL of 6000.
// With 3800 tok/turn and OBSERVER_THRESHOLD=12000 (limit=14400):
//   Turn 1: tok=3800 → idle
//   Turn 2: tok=7600 → buffer (crosses INTERVAL boundary at 6000)
//   Turn 3: tok=11400 → idle
//   Turn 4: tok=15200 → block → activate() condenses buffers
const OBSERVER_THRESHOLD = 12_000
// Very low so Reflector fires as soon as we have any observations
const REFLECTOR_THRESHOLD = 500

// Per-turn usage: input + output = 3800 tokens
const TURN_INPUT = 3_500
const TURN_OUTPUT = 300

// Observer XML response — valid format with current-task
const MOCK_OBS = (n: number) =>
  `<observations>\n## Session\n* 🔴 (t${n}) user asked about topic-${n}\n* 🟡 assistant explained concept ${n}\n</observations>\n<current-task>working on topic-${n}</current-task>`

// Reflector compressed response
const MOCK_REFL = `<observations>\n## Compressed\n* 🔴 user session summary\n</observations>`

// ─── Service stubs ────────────────────────────────────────────────────────────

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected"),
    authenticate: () => Effect.die("unexpected"),
    finishAuth: () => Effect.die("unexpected"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const filetime = Layer.succeed(
  FileTime.Service,
  FileTime.Service.of({
    read: () => Effect.void,
    get: () => Effect.succeed(undefined),
    assert: () => Effect.void,
    withLock: (_filepath, fn) => Effect.promise(fn),
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makeHttp() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Agent.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    filetime,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    status,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(Layer.provideMerge(deps))
  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionPrompt.layer.pipe(
      Layer.provideMerge(proc),
      Layer.provideMerge(registry),
      Layer.provideMerge(trunc),
      Layer.provide(Instruction.defaultLayer),
      Layer.provideMerge(deps),
    ),
  )
}

const it = testEffect(makeHttp())

// ─── Config factory ────────────────────────────────────────────────────────────
//
// IMPORTANT: observer_model MUST be "test/test-model" — same provider as main.
// The Observer calls the LLM, and in tests the only configured provider is "test".
// If it's set to "opencode/qwen3.6-plus-free" (the production default),
// Provider.getModel() will silently return undefined and the Observer won't fire.

function makeConfig(url: string) {
  const cfg = {
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 200_000, output: 10_000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: { apiKey: "test-key", baseURL: url },
      },
    },
    experimental: {
      // Point Observer/Reflector to the test provider so calls are intercepted
      observer_model: "test/test-model",
      observer_message_tokens: OBSERVER_THRESHOLD,
      observer_reflection_tokens: REFLECTOR_THRESHOLD,
      autodream: false,
    },
  }
  // Expose config to static Provider.getModel() runtime used by Observer.run()
  // (which runs as a plain async function outside the Effect layer stack).
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(cfg)
  return cfg
}

// ─── Detection: is this an Observer/Reflector LLM call? ──────────────────────
//
// The Observer system prompt contains unique markers we can sniff on.
// This is how we distinguish Observer LLM calls from main LLM calls
// when both share the same TestLLMServer.

function isOMCall(body: Record<string, unknown>): boolean {
  // Observer uses generateText → doGenerate → no "stream" field in body.
  // Main/Reflector calls use streamText → doStream → "stream: true" in body.
  // This is the most reliable way to distinguish Observer calls from main calls.
  if (!("stream" in body)) return true
  // Fallback: check OM-specific strings for condense calls (also non-streaming)
  const str = JSON.stringify(body)
  return (
    str.includes("observational memory") ||
    str.includes("OBSERVATIONS") ||
    str.includes("observation log") ||
    str.includes("compress")
  )
}

// ─── Queue helpers ────────────────────────────────────────────────────────────

function queueOM(llm: TestLLMServer["Service"], text: string) {
  return llm.pushMatch((hit) => isOMCall(hit.body), reply().text(text).stop())
}

function queueMain(llm: TestLLMServer["Service"]) {
  return llm.push(reply().text("ok").usage({ input: TURN_INPUT, output: TURN_OUTPUT }).stop())
}

// ─── sendTurn: prompt + await OM background work ─────────────────────────────

const sendTurn = Effect.fn("test.sendTurn")(function* (prompt: SessionPrompt.Interface, sid: SessionID, text: string) {
  yield* prompt.prompt({
    sessionID: sid,
    parts: [{ type: "text", text }],
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
  })
  // Wait for any in-flight Observer background work to settle
  yield* Effect.promise(() => OMBuf.awaitInFlight(sid))
  // Small extra settle window for DB writes
  yield* Effect.promise(() => new Promise<void>((r) => setTimeout(r, 100)))
})

// ─── DB read helpers ──────────────────────────────────────────────────────────

function getOM(sid: SessionID) {
  return Database.use((db) => db.select().from(ObservationTable).where(eq(ObservationTable.session_id, sid)).get())
}

function getBuffers(sid: SessionID) {
  return Database.use((db) =>
    db.select().from(ObservationBufferTable).where(eq(ObservationBufferTable.session_id, sid)).all(),
  )
}

function getMsgs(sid: SessionID) {
  return Database.use((db) => db.select().from(MessageTable).where(eq(MessageTable.session_id, sid)).all())
}

// ─── Test runner pattern ──────────────────────────────────────────────────────
//
// Each test:
//  1. Creates a session
//  2. Pre-queues OM responses (so the Observer has something to respond with)
//  3. Sends N turns with main responses
//  4. Asserts OM state from DB

describe("OM Pipeline — lifecycle", () => {
  // OM-1 ─────────────────────────────────────────────────────────────────────
  it.live("OM-1: Observer fires and creates observations after crossing threshold", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const sid = (yield* sessions.create({ title: "om-1" })).id as SessionID

        // Turns: tok=0→3800→7600→11400→15200
        // - Iter 2 processor: buffer signal → Observer.run() (async) → writes buffer
        // - Iter 4 processor: block signal (ignored by processor)
        // - Iter 5 prompt.ts: sees tok=15200 >= limit=14400 → block → activate()
        yield* queueOM(llm, MOCK_OBS(1))
        yield* queueOM(llm, MOCK_OBS(2))

        for (let i = 1; i <= 5; i++) {
          yield* queueMain(llm)
          yield* sendTurn(prompt, sid, `turn ${i}`)
        }

        const rec = getOM(sid)
        expect(rec).not.toBeNull()
        expect(rec?.generation_count ?? 0).toBeGreaterThan(0)
        expect(rec?.observations).not.toBeNull()
      }),
      { git: true, config: makeConfig },
    ),
  )

  // OM-2 ─────────────────────────────────────────────────────────────────────
  it.live("OM-2: observation_tokens is non-zero after Observer fires", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const sid = (yield* sessions.create({ title: "om-2" })).id as SessionID

        yield* queueOM(llm, MOCK_OBS(1))
        yield* queueOM(llm, MOCK_OBS(2))
        for (let i = 0; i < 5; i++) {
          yield* queueMain(llm)
          yield* sendTurn(prompt, sid, `turn ${i + 1}`)
        }

        const rec = getOM(sid)
        expect(rec?.observation_tokens ?? 0).toBeGreaterThan(0)
      }),
      { git: true, config: makeConfig },
    ),
  )

  // OM-3 ─────────────────────────────────────────────────────────────────────
  it.live("OM-3: last_observed_at is set after Observer activation", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const sid = (yield* sessions.create({ title: "om-3" })).id as SessionID

        yield* queueOM(llm, MOCK_OBS(1))
        yield* queueOM(llm, MOCK_OBS(2))
        for (let i = 0; i < 5; i++) {
          yield* queueMain(llm)
          yield* sendTurn(prompt, sid, `turn ${i + 1}`)
        }

        const rec = getOM(sid)
        expect(rec?.last_observed_at ?? 0).toBeGreaterThan(0)
      }),
      { git: true, config: makeConfig },
    ),
  )

  // OM-4 ─────────────────────────────────────────────────────────────────────
  it.live("OM-4: current_task is extracted from Observer XML output", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const sid = (yield* sessions.create({ title: "om-4" })).id as SessionID

        yield* queueOM(llm, MOCK_OBS(1))
        yield* queueOM(llm, MOCK_OBS(2))
        for (let i = 0; i < 5; i++) {
          yield* queueMain(llm)
          yield* sendTurn(prompt, sid, `turn ${i + 1}`)
        }

        const rec = getOM(sid)
        // MOCK_OBS includes <current-task>working on topic-N</current-task>
        expect(rec?.current_task).toBeTruthy()
      }),
      { git: true, config: makeConfig },
    ),
  )

  // OM-5 ─────────────────────────────────────────────────────────────────────
  it.live("OM-5: LLM does not receive early turns after OM boundary is set", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const sid = (yield* sessions.create({ title: "om-5" })).id as SessionID

        // 5 turns to ensure activate() fires (buffer at iter 2, block at iter 4, activate at iter 5)
        // Each turn sends a unique marker string so we can detect which turns the LLM sees
        yield* queueOM(llm, MOCK_OBS(1))
        yield* queueOM(llm, MOCK_OBS(2))
        for (let i = 0; i < 5; i++) {
          yield* queueMain(llm)
          yield* sendTurn(prompt, sid, `TURN_MARKER_${i + 1}`)
        }

        const rec = getOM(sid)
        expect(rec?.last_observed_at ?? 0).toBeGreaterThan(0)

        // Reset hits so we only capture the next turn
        yield* llm.reset

        // One more turn after the OM boundary — the LLM should NOT see early turns
        yield* queueMain(llm)
        yield* sendTurn(prompt, sid, "TURN_MARKER_6")

        const hits = yield* llm.hits
        // Only main LLM calls (not OM/title) carry a messages array
        const mainHits = hits.filter((h) => !isOMCall(h.body) && Array.isArray((h.body as any).messages))
        expect(mainHits.length).toBeGreaterThan(0)

        // prompt.ts applies the omBoundary filter — the LLM body should NOT contain
        // the text of turn 1 (which was observed and replaced by the compressed
        // observation block in the system prompt)
        const bodyStr = JSON.stringify(mainHits[0]?.body)
        expect(bodyStr).not.toContain("TURN_MARKER_1")
        // But it should contain the most recent turn
        expect(bodyStr).toContain("TURN_MARKER_6")
      }),
      { git: true, config: makeConfig },
    ),
  )

  // OM-6 ─────────────────────────────────────────────────────────────────────
  it.live("OM-6: generation_count increases across multiple Observer activations", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const sid = (yield* sessions.create({ title: "om-6" })).id as SessionID

        // 12 turns to ensure at least 2 full buffer→activate cycles
        // Each cycle: buffer at processor iter N, activate at prompt iter N+2
        for (let i = 0; i < 12; i++) {
          yield* queueOM(llm, MOCK_OBS(i + 1))
          yield* queueMain(llm)
          yield* sendTurn(prompt, sid, `turn ${i + 1}: question about topic-${i}`)
        }

        const rec = getOM(sid)
        expect(rec?.generation_count ?? 0).toBeGreaterThanOrEqual(2)
      }),
      { git: true, config: makeConfig },
    ),
  )
})

// ─── Full lifecycle summary ────────────────────────────────────────────────────

describe("OM Pipeline — 20-turn session", () => {
  it.live(
    "verifies all OM milestones in sequence with lifecycle table",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const sid = (yield* sessions.create({ title: "om-long" })).id as SessionID

          // Pre-queue plenty of OM responses (Observer + Reflector calls)
          for (let i = 0; i < 25; i++) {
            yield* queueOM(llm, i % 4 === 0 ? MOCK_REFL : MOCK_OBS(i + 1))
          }

          type Snapshot = {
            turn: number
            genCount: number
            obsTokens: number
            hasObs: boolean
            hasRefl: boolean
            lastObsAt: number | null
            bufChunks: number
          }

          const snapshots: Snapshot[] = []

          for (let i = 0; i < 20; i++) {
            yield* queueMain(llm)
            yield* sendTurn(prompt, sid, `turn ${i + 1}: question about topic-${i}`)

            const rec = getOM(sid)
            const bufs = getBuffers(sid)
            snapshots.push({
              turn: i + 1,
              genCount: rec?.generation_count ?? 0,
              obsTokens: rec?.observation_tokens ?? 0,
              hasObs: (rec?.observations ?? null) !== null,
              hasRefl: (rec?.reflections ?? null) !== null,
              lastObsAt: rec?.last_observed_at ?? null,
              bufChunks: bufs.length,
            })
          }

          // Give any trailing background work time to settle
          yield* Effect.promise(() => new Promise<void>((r) => setTimeout(r, 500)))

          const final = getOM(sid)
          const last = snapshots.at(-1)!

          // ── Milestone 1: Observer fired ──────────────────────────────────────
          const firstObsTurn = snapshots.findIndex((s) => s.genCount > 0) + 1
          expect(firstObsTurn).toBeGreaterThan(0)
          // With 3800 tok/turn and threshold 12000, Observer must fire by turn 5
          expect(firstObsTurn).toBeLessThanOrEqual(5)

          // ── Milestone 2: Observations exist ─────────────────────────────────
          const hasContent = (final?.observations ?? null) !== null || (final?.reflections ?? null) !== null
          expect(hasContent).toBe(true)

          // ── Milestone 3: generation_count grew ──────────────────────────────
          expect(last.genCount).toBeGreaterThanOrEqual(2)

          // ── Milestone 4: last_observed_at is set ─────────────────────────────
          expect(final?.last_observed_at ?? 0).toBeGreaterThan(0)

          // ── Milestone 5: observation_tokens is non-zero ───────────────────────
          expect(final?.observation_tokens ?? 0).toBeGreaterThan(0)

          // ── Milestone 6: generation_count is monotonically non-decreasing ────
          for (let i = 1; i < snapshots.length; i++) {
            expect(snapshots[i]!.genCount).toBeGreaterThanOrEqual(snapshots[i - 1]!.genCount)
          }

          // ── Lifecycle table (visible when not in CI) ──────────────────────────
          if (!process.env.CI) {
            console.log("\n  ── OM Pipeline: 20-turn lifecycle ─────────────────────────")
            console.log(
              `  ${"turn".padEnd(5)} ${"gen".padEnd(4)} ${"obs_tok".padEnd(9)} ${"obs".padEnd(4)} ${"refl".padEnd(5)} ${"buf".padEnd(4)} last_obs_at`,
            )
            for (const s of snapshots) {
              console.log(
                `  ${String(s.turn).padEnd(5)}` +
                  ` ${String(s.genCount).padEnd(4)}` +
                  ` ${String(s.obsTokens).padEnd(9)}` +
                  ` ${(s.hasObs ? "✓" : "·").padEnd(4)}` +
                  ` ${(s.hasRefl ? "✓" : "·").padEnd(5)}` +
                  ` ${String(s.bufChunks).padEnd(4)}` +
                  ` ${s.lastObsAt ?? "─"}`,
              )
            }
            console.log(`\n  First Observer at turn  : ${firstObsTurn}`)
            console.log(`  Final generation_count  : ${final?.generation_count ?? 0}`)
            console.log(`  Final observation_tokens: ${final?.observation_tokens ?? 0}`)
            console.log(`  Reflector fired         : ${(final?.reflections ?? null) !== null}`)
            console.log()
          }
        }),
        { git: true, config: makeConfig },
      ),
    120_000, // 2min for 20 turns
  )
})
