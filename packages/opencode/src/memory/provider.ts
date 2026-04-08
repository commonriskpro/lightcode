/**
 * LightCode Memory Core V1 — MemoryProvider
 *
 * Composes all four memory layers into a single unified context:
 * 1. Recent History  — handled by caller (session/prompt.ts)
 * 2. Working Memory  — WorkingMemory service
 * 3. Observational Memory — existing OM system (session/om/)
 * 4. Semantic Recall — HybridBackend + SessionMemory
 *
 * This is the canonical entry point for all memory operations in LightCode.
 * The runtime MUST use this provider — no scattered direct DB access for memory.
 */

import { Token } from "../util/token"
import { createHash } from "crypto"
import { WorkingMemory } from "./working-memory"
import { Handoff } from "./handoff"
import { OM } from "../session/om/record"
import { SystemPrompt } from "../session/system"
import type { SessionID } from "../session/schema"
import { FTS5Backend, format as formatArtifacts } from "./fts5-backend"
import { EmbeddingBackend } from "./embedding-backend"
import { HybridBackend } from "./hybrid-backend"
import { SessionMemory } from "./session-memory"
import { Embedder } from "./embedder"
import type {
  ContextBuildOptions,
  MemoryContext,
  ScopeRef,
  WorkingMemoryRecord,
  MemoryArtifact,
  AgentHandoff,
  ForkContext,
  ObservationRecord,
  PromptBlock,
  SessionRecallResult,
} from "./contracts"
import { DEFAULT_USER_SCOPE_ID, PROMPT_BLOCK } from "./contracts"

const fts = new FTS5Backend()
let backend: Promise<HybridBackend> | undefined

async function getBackend(): Promise<HybridBackend> {
  if (backend) return backend
  backend = (async () => {
    const embedder = await Embedder.get()
    if (!embedder) return new HybridBackend(fts, null)
    return new HybridBackend(fts, new EmbeddingBackend(embedder, fts))
  })()
  return backend
}

// ─── System prompt wrappers ───────────────────────────────────────────────────

const WORKING_MEMORY_GUIDANCE =
  'When you make a significant architectural decision, technology choice, or discover a key constraint or goal for this project, call `update_working_memory` with scope="project" or scope="agent" to persist it for future sessions. Use `update_user_memory` only when the user explicitly asks to save a durable personal preference, default, or workflow habit. Keep entries concise and factual.'

function wrapWorkingMemory(body: string, scope: string): string {
  return `<working-memory scope="${scope}">\n${body}\n</working-memory>\n\n${WORKING_MEMORY_GUIDANCE}`
}

function wrapSemanticRecall(body: string): string {
  return `<memory-recall>\n${body}\n</memory-recall>`
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return text.slice(0, limit) + "…"
}

function wrapSessionRecall(items: { score: number; text: string }[]): string | undefined {
  if (!items.length) return undefined
  return `<session-recall>\n${items
    .map((item) => `[score=${item.score.toFixed(2)}] ${truncate(item.text, 400)}`)
    .join("\n")}\n</session-recall>`
}

// ─── Memory namespace ─────────────────────────────────────────────────────────

export namespace Memory {
  export function userScope(id = DEFAULT_USER_SCOPE_ID): ScopeRef {
    return { type: "user", id }
  }

  /**
   * Build a composed MemoryContext from all available memory layers.
   *
   * Loads all layers in parallel, applies token budgets, and returns
   * formatted strings ready for system prompt injection.
   *
   * Recent history is NOT included here — the caller (session/prompt.ts)
   * is responsible for supplying recent message history.
   */
  export async function buildContext(opts: ContextBuildOptions): Promise<MemoryContext> {
    const wBudget = opts.workingMemoryBudget ?? 2000
    const oBudget = opts.observationsBudget ?? 4000
    const rBudget = opts.semanticRecallBudget ?? 2000

    const allScopes = [opts.scope, ...(opts.ancestorScopes ?? [])]

    // Load all layers in parallel
    const search = opts.semanticQuery
      ? (await getBackend()).search(opts.semanticQuery, allScopes, 10)
      : Promise.resolve([] as MemoryArtifact[])
    const session =
      opts.scope.type === "thread" && opts.semanticQuery
        ? SessionMemory.recall(opts.scope.id as SessionID, opts.semanticQuery, 5, opts.excludeMsgIds)
        : Promise.resolve([] as SessionRecallResult[])

    const [wRecords, omRec, ftsArtifacts, sessionResults] = await Promise.all([
      WorkingMemory.getForScopes(opts.scope, opts.ancestorScopes ?? []),
      opts.scope.type === "thread" ? OM.get(opts.scope.id as SessionID) : Promise.resolve(undefined),
      search,
      session,
    ])

    // Fallback: if FTS5 returned no results AND a query was provided,
    // fall back to recency-ordered artifacts for these scopes.
    // This ensures semanticRecall is never silently empty when artifacts exist.
    const artifacts = ftsArtifacts.length === 0 && opts.semanticQuery ? await fts.recent(allScopes, 5) : ftsArtifacts

    // Format each layer with token budgets
    const rawWM = WorkingMemory.format(wRecords, wBudget)
    const workingMemory = rawWM ? wrapWorkingMemory(rawWM, opts.scope.type) : undefined

    const rawObs = omRec ? formatObservations(omRec, oBudget) : undefined
    const observationsStable = rawObs
      ? SystemPrompt.observationsStable({ observations: rawObs, reflections: null })
      : undefined
    const observationsLive = omRec ? SystemPrompt.observationsLive(omRec) : undefined
    const observations = SystemPrompt.mergeObservations(observationsStable, observationsLive)

    const rawRecall = artifacts.length ? formatArtifacts(artifacts, rBudget) : undefined
    const semanticRecall = rawRecall ? wrapSemanticRecall(rawRecall) : undefined
    const sessionRecall = wrapSessionRecall(sessionResults)
    const blocks = [
      block(PROMPT_BLOCK.WORKING_MEMORY, workingMemory, true),
      block(PROMPT_BLOCK.OBSERVATIONS_STABLE, observationsStable, true),
      block(PROMPT_BLOCK.OBSERVATIONS_LIVE, observationsLive, false),
      block(PROMPT_BLOCK.SESSION_RECALL, sessionRecall, false),
      block(PROMPT_BLOCK.SEMANTIC_RECALL, semanticRecall, false),
    ].filter((x): x is PromptBlock => Boolean(x))

    const continuationHint = omRec?.suggested_continuation ?? undefined

    const totalTokens = blocks.reduce((sum, x) => sum + x.tokens, 0)

    return {
      recentHistory: undefined,
      workingMemory,
      observations,
      semanticRecall,
      sessionRecall,
      observationsStable,
      observationsLive,
      blocks,
      continuationHint,
      totalTokens,
    }
  }

  // ─── Working Memory ─────────────────────────────────────────────────────────

  export async function getWorkingMemory(scope: ScopeRef, key?: string): Promise<WorkingMemoryRecord[]> {
    return WorkingMemory.get(scope, key)
  }

  export async function setWorkingMemory(
    scope: ScopeRef,
    key: string,
    value: string,
    format: "markdown" | "json" = "markdown",
  ): Promise<void> {
    await WorkingMemory.set(scope, key, value, format)
  }

  export async function setUserMemory(
    key: string,
    value: string,
    format: "markdown" | "json" = "markdown",
    id = DEFAULT_USER_SCOPE_ID,
  ): Promise<void> {
    await WorkingMemory.set(userScope(id), key, value, format)
  }

  // ─── Observational Memory ───────────────────────────────────────────────────

  export async function getObservations(sessionId: string): Promise<ObservationRecord | undefined> {
    return OM.get(sessionId as SessionID) as Promise<ObservationRecord | undefined>
  }

  // ─── Semantic Recall ────────────────────────────────────────────────────────

  export async function searchArtifacts(query: string, scopes: ScopeRef[], limit = 10): Promise<MemoryArtifact[]> {
    const b = await getBackend()
    return b.search(query, scopes, limit)
  }

  export async function indexArtifact(
    artifact: Omit<MemoryArtifact, "id" | "time_created" | "time_updated">,
  ): Promise<string> {
    const b = await getBackend()
    return b.index(artifact)
  }

  // ─── Handoff and Fork ───────────────────────────────────────────────────────

  export async function getHandoff(childSessionId: string): Promise<AgentHandoff | undefined> {
    return Handoff.getHandoff(childSessionId)
  }

  export async function writeHandoff(h: Omit<AgentHandoff, "id" | "time_created">): Promise<string> {
    return Handoff.writeHandoff(h)
  }

  export async function getForkContext(sessionId: string): Promise<ForkContext | undefined> {
    return Handoff.getFork(sessionId)
  }

  export async function writeForkContext(ctx: Omit<ForkContext, "id" | "time_created">): Promise<void> {
    await Handoff.writeFork({
      sessionId: ctx.session_id,
      parentSessionId: ctx.parent_session_id,
      context: ctx.context,
    })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatObservations(rec: ObservationRecord, budget: number): string | undefined {
  const body = rec.reflections ?? rec.observations
  if (!body) return undefined
  // Apply token budget cap
  const cap = Token.estimate(body) > budget ? body.slice(0, budget * 4) : body
  return cap || undefined
}

function block(key: PromptBlock["key"], body: string | undefined, stable: boolean): PromptBlock | undefined {
  if (!body?.trim()) return undefined
  return {
    key,
    body,
    stable,
    tokens: Token.estimate(body),
    hash: createHash("sha1").update(body).digest("hex"),
  }
}
