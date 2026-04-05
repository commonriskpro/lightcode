/**
 * LightCode Memory Core V1 — MemoryProvider
 *
 * Composes all four memory layers into a single unified context:
 * 1. Recent History  — handled by caller (session/prompt.ts)
 * 2. Working Memory  — WorkingMemory service
 * 3. Observational Memory — existing OM system (session/om/)
 * 4. Semantic Recall — SemanticRecall service
 *
 * This is the canonical entry point for all memory operations in LightCode.
 * The runtime MUST use this provider — no scattered direct DB access for memory.
 */

import { Token } from "../util/token"
import { WorkingMemory } from "./working-memory"
import { SemanticRecall } from "./semantic-recall"
import { Handoff } from "./handoff"
import { OM } from "../session/om/record"
import type { SessionID } from "../session/schema"
import type {
  ContextBuildOptions,
  MemoryContext,
  ScopeRef,
  WorkingMemoryRecord,
  MemoryArtifact,
  AgentHandoff,
  ForkContext,
  ObservationRecord,
} from "./contracts"

// ─── System prompt wrappers ───────────────────────────────────────────────────

function wrapWorkingMemory(body: string, scope: string): string {
  return `<working-memory scope="${scope}">\n${body}\n</working-memory>`
}

function wrapSemanticRecall(body: string): string {
  return `<memory-recall>\n${body}\n</memory-recall>`
}

// ─── Memory namespace ─────────────────────────────────────────────────────────

export namespace Memory {
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
    const [wRecords, omRec, ftsArtifacts] = await Promise.all([
      Promise.resolve(WorkingMemory.getForScopes(opts.scope, opts.ancestorScopes ?? [])),
      Promise.resolve(
        opts.scope.type === "thread"
          ? (OM.get(opts.scope.id as SessionID) as ObservationRecord | undefined)
          : undefined,
      ),
      opts.semanticQuery
        ? Promise.resolve(SemanticRecall.search(opts.semanticQuery, allScopes, 10))
        : Promise.resolve([] as MemoryArtifact[]),
    ])

    // Fallback: if FTS5 returned no results AND a query was provided,
    // fall back to recency-ordered artifacts for these scopes.
    // This ensures semanticRecall is never silently empty when artifacts exist.
    const artifacts =
      ftsArtifacts.length === 0 && opts.semanticQuery ? SemanticRecall.recent(allScopes, 5) : ftsArtifacts

    // Format each layer with token budgets
    const rawWM = WorkingMemory.format(wRecords, wBudget)
    const workingMemory = rawWM ? wrapWorkingMemory(rawWM, opts.scope.type) : undefined

    const rawObs = omRec ? formatObservations(omRec, oBudget) : undefined
    const observations = rawObs ?? undefined

    const rawRecall = artifacts.length ? SemanticRecall.format(artifacts, rBudget) : undefined
    const semanticRecall = rawRecall ? wrapSemanticRecall(rawRecall) : undefined

    const continuationHint = omRec?.suggested_continuation ?? undefined

    const totalTokens = [workingMemory, observations, semanticRecall]
      .filter(Boolean)
      .reduce((sum, s) => sum + Token.estimate(s!), 0)

    return {
      recentHistory: undefined,
      workingMemory,
      observations,
      semanticRecall,
      continuationHint,
      totalTokens,
    }
  }

  // ─── Working Memory ─────────────────────────────────────────────────────────

  export function getWorkingMemory(scope: ScopeRef, key?: string): WorkingMemoryRecord[] {
    return WorkingMemory.get(scope, key)
  }

  export function setWorkingMemory(
    scope: ScopeRef,
    key: string,
    value: string,
    format: "markdown" | "json" = "markdown",
  ): void {
    WorkingMemory.set(scope, key, value, format)
  }

  // ─── Observational Memory ───────────────────────────────────────────────────

  export function getObservations(sessionId: string): ObservationRecord | undefined {
    return OM.get(sessionId as SessionID) as ObservationRecord | undefined
  }

  // ─── Semantic Recall ────────────────────────────────────────────────────────

  export function searchArtifacts(query: string, scopes: ScopeRef[], limit = 10): MemoryArtifact[] {
    return SemanticRecall.search(query, scopes, limit)
  }

  export function indexArtifact(artifact: Omit<MemoryArtifact, "id" | "time_created" | "time_updated">): string {
    return SemanticRecall.index(artifact)
  }

  // ─── Handoff and Fork ───────────────────────────────────────────────────────

  export function getHandoff(childSessionId: string): AgentHandoff | undefined {
    return Handoff.getHandoff(childSessionId)
  }

  export function writeHandoff(h: Omit<AgentHandoff, "id" | "time_created">): string {
    return Handoff.writeHandoff(h)
  }

  export function getForkContext(sessionId: string): ForkContext | undefined {
    return Handoff.getFork(sessionId)
  }

  export function writeForkContext(ctx: Omit<ForkContext, "id" | "time_created">): void {
    Handoff.writeFork({
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
