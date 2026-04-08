# Embedding Recall Backend Specification

## Purpose

Cross-session hybrid recall implementing `RecallBackend` combining FTS5 and Embedding backends using Reciprocal Rank Fusion (RRF).

## Requirements

### Requirement: Embedding Backend Operations

The `EmbeddingBackend` MUST implement indexing and searching of content.

#### Scenario: Indexing content

- GIVEN content to index
- WHEN `index()` is called
- THEN the content is embedded
- AND the result is upserted into `memory_artifacts_vec`

#### Scenario: Searching content

- GIVEN a search query
- WHEN `search()` is called
- THEN the query is embedded
- AND the system returns top-k results by cosine distance

### Requirement: Hybrid Search

The `HybridBackend` MUST combine results from `FTS5Backend` and `EmbeddingBackend`.

#### Scenario: Both backends available

- GIVEN a search query
- AND an embedder is available
- WHEN `search()` is called on `HybridBackend`
- THEN FTS5 and Embedding searches run in parallel
- AND results are merged using RRF (k=60)
- AND the top-k merged results are returned

#### Scenario: Embedder unavailable

- GIVEN a search query
- AND no embedder is available
- WHEN `search()` is called on `HybridBackend`
- THEN the system falls back to returning results only from `FTS5Backend`

### Requirement: Embedding Cache

The system SHALL cache embeddings to avoid redundant computation.

#### Scenario: Caching an embedding

- GIVEN content that needs embedding
- WHEN the embedding is generated
- THEN it is stored in an LRU cache (max 1000 entries) keyed by the xxhash32 of the content
- AND the cache is shared across `session-memory` and `embedding-recall-backend`
