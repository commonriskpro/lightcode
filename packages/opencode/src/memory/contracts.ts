/**
 * LightCode Memory — Internal Contracts
 *
 * Pure TypeScript types and interfaces. No DB imports. No external dependencies.
 * This file is the contract layer between all memory modules.
 */

// ─── Scope Model ──────────────────────────────────────────────────────────────

/**
 * Memory scope types — ordered from most specific to least specific.
 * Precedence in getForScopes(): thread > agent > project > user > global_pattern.
 *
 * Operational status:
 * - "thread"         OPERATIONAL — per-session memory, loaded every turn via buildContext()
 * - "agent"          OPERATIONAL — per-agent memory across sessions, loaded via buildContext() ancestorScopes
 *                                  Writable via update_working_memory(scope="agent")
 * - "project"        OPERATIONAL — shared across all agents/sessions for one project
 *                                  Writable via update_working_memory(scope="project")
 *                                  Auto-indexed from OM at session end
 * - "user"           DORMANT — reserved for user-wide preferences, not yet wired in hot path
 * - "global_pattern" DORMANT — reserved for cross-project reusable patterns, not yet wired
 *                              Writes strip <private> tags (safety mechanism already in place)
 *
 * To activate "user" scope: add { type: "user", id: "default" } to ancestorScopes in buildContext().
 * To activate "global_pattern" scope: same pattern, but carefully guard against private data leakage.
 */
export type MemoryScope = "thread" | "agent" | "project" | "user" | "global_pattern"

export interface ScopeRef {
  type: MemoryScope
  id: string
}

// ─── Memory Layers ────────────────────────────────────────────────────────────

export interface MemoryContext {
  /** Recent message history — assembled by caller, not by MemoryProvider */
  recentHistory: string | undefined
  /** Structured stable state: facts, preferences, goals, constraints */
  workingMemory: string | undefined
  /** Compressed narrative: what happened, what was tried, what changed */
  observations: string | undefined
  /** Similarity-based retrieval: relevant prior knowledge */
  semanticRecall: string | undefined
  /** Continuation hint from OM record */
  continuationHint: string | undefined
  /** Total token estimate for all assembled memory layers */
  totalTokens: number
}

export interface ContextBuildOptions {
  scope: ScopeRef
  ancestorScopes?: ScopeRef[]
  recentHistoryLimit?: number
  workingMemoryBudget?: number
  observationsBudget?: number
  semanticRecallBudget?: number
  semanticQuery?: string
  includeGlobalPatterns?: boolean
}

// ─── Working Memory ───────────────────────────────────────────────────────────

export interface WorkingMemoryRecord {
  id: string
  scope_type: MemoryScope
  scope_id: string
  key: string
  value: string
  format: "markdown" | "json"
  version: number
  time_created: number
  time_updated: number
}

// ─── Memory Artifacts (Semantic Recall) ──────────────────────────────────────

export type ArtifactType = "observation" | "working_memory" | "handoff" | "pattern" | "decision"

export interface MemoryArtifact {
  id: string
  scope_type: MemoryScope
  scope_id: string
  type: ArtifactType
  title: string
  content: string
  topic_key: string | null
  normalized_hash: string | null
  revision_count: number
  duplicate_count: number
  last_seen_at: number | null
  deleted_at: number | null
  time_created: number
  time_updated: number
}

export interface ArtifactSearchResult extends MemoryArtifact {
  rank: number
}

// ─── Observational Memory ─────────────────────────────────────────────────────

export interface ObservationRecord {
  id: string
  session_id: string
  observations: string | null
  reflections: string | null
  current_task: string | null
  suggested_continuation: string | null
  last_observed_at: number | null
  generation_count: number
  observation_tokens: number
  observed_message_ids: string | null
  time_created: number
  time_updated: number
}

export interface ObservationBuffer {
  id: string
  session_id: string
  observations: string
  first_msg_id: string | null
  last_msg_id: string | null
  starts_at: number
  ends_at: number
}

// ─── Fork and Handoff ─────────────────────────────────────────────────────────

export interface AgentHandoff {
  id: string
  parent_session_id: string
  child_session_id: string
  context: string
  working_memory_snap: string | null
  observation_snap: string | null
  metadata: string | null
  time_created: number
}

export interface ForkContext {
  id: string
  session_id: string
  parent_session_id: string
  context: string
  time_created: number
}

// ─── Memory Links ─────────────────────────────────────────────────────────────

export type LinkRelation = "derived_from" | "supersedes" | "related_to"

export interface MemoryLink {
  id: string
  from_artifact_id: string
  to_artifact_id: string
  relation: LinkRelation
  time_created: number
}

// ─── Recall Backend Abstraction ───────────────────────────────────────────────

/** Backend interface for semantic recall. V1 uses FTS5, future versions can use vector embeddings. */
export interface RecallBackend {
  index(artifact: MemoryArtifact): void
  search(query: string, scopes: ScopeRef[], limit: number): MemoryArtifact[]
  remove(id: string): void
}

// ─── MemoryProvider Interface ─────────────────────────────────────────────────

export interface MemoryProvider {
  buildContext(opts: ContextBuildOptions): Promise<MemoryContext>
  getWorkingMemory(scope: ScopeRef, key?: string): WorkingMemoryRecord[]
  setWorkingMemory(scope: ScopeRef, key: string, value: string, format?: "markdown" | "json"): void
  getObservations(sessionId: string): ObservationRecord | undefined
  searchArtifacts(query: string, scopes: ScopeRef[], limit?: number): MemoryArtifact[]
  indexArtifact(artifact: Omit<MemoryArtifact, "id" | "time_created" | "time_updated">): string
  getHandoff(childSessionId: string): AgentHandoff | undefined
  writeHandoff(h: Omit<AgentHandoff, "id" | "time_created">): string
  getForkContext(sessionId: string): ForkContext | undefined
  writeForkContext(ctx: Omit<ForkContext, "id" | "time_created">): void
}
