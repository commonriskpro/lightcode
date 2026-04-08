/**
 * Public memory API.
 *
 * - `Memory` is the high-level entry point used by runtime code.
 * - `HybridBackend`, `FTS5Backend`, and `EmbeddingBackend` are advanced backends
 *   for direct recall/indexing control.
 * - `SessionMemory` handles intra-session semantic recall.
 * - `Embedder` exposes embedder configuration and singleton resolution.
 */

export { Memory } from "./provider"
export { WorkingMemory } from "./working-memory"
export { FTS5Backend } from "./fts5-backend"
export { EmbeddingBackend } from "./embedding-backend"
export { HybridBackend } from "./hybrid-backend"
export { SessionMemory } from "./session-memory"
export { Embedder } from "./embedder"
export { EmbeddingCache } from "./embedding-cache"
export { Handoff } from "./handoff"

export type {
  MemoryScope,
  ScopeRef,
  MemoryContext,
  ContextBuildOptions,
  WorkingMemoryRecord,
  MemoryArtifact,
  ArtifactType,
  ArtifactSearchResult,
  ObservationRecord,
  ObservationBuffer,
  AgentHandoff,
  ForkContext,
  MemoryLink,
  LinkRelation,
  RecallBackend,
  MemoryProvider,
  EmbedderConfig,
  EmbedderBackend,
  SessionRecallResult,
} from "./contracts"
