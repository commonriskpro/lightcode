/**
 * LightCode Memory Core V1 — Public Exports
 *
 * The canonical entry point for all memory operations.
 * Import { Memory } from "@/memory" in runtime code.
 */

export { Memory } from "./provider"
export { WorkingMemory } from "./working-memory"
export { SemanticRecall } from "./semantic-recall"
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
} from "./contracts"
