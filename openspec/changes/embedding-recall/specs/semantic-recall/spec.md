# Delta for Semantic Recall

## MODIFIED Requirements

### Requirement: Semantic Recall Implementation

The `SemanticRecall` implementation MUST be refactored into an `FTS5Backend` class implementing `RecallBackend` and routing through `HybridBackend`.
(Previously: `SemanticRecall` namespace was used directly for memory context building)

#### Scenario: Building context

- GIVEN a request to build memory context
- WHEN `Memory.buildContext()` is called
- THEN it routes the request through `HybridBackend`
- AND `HybridBackend` uses `FTS5Backend` internally for FTS5 queries
- AND the public API of `Memory` remains unchanged

#### Scenario: Preserving existing FTS5 behavior

- GIVEN FTS5 operations (two-pass AND+OR, topic_key match, soft delete, dedup)
- WHEN performed via `FTS5Backend`
- THEN the behavior remains identical to the previous `SemanticRecall` namespace implementation
