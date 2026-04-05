# Engram vs Industry: Gap Analysis

## What Engram Does Well

| Feature               | Engram                 | Industry Standard             |
| --------------------- | ---------------------- | ----------------------------- |
| Local-first (privacy) | ✅ SQLite in ~/.engram | ✅ Mem0, SuperLocalMemory     |
| MCP protocol          | ✅ 15 tools            | ✅ MCP becoming standard      |
| Simple deployment     | ✅ Single Go binary    | ✅ Similar to Memvid          |
| Session tracking      | ✅                     | ❌ Most lack this             |
| Topic keys (upserts)  | ✅                     | ⚠️ Only Mem0 matches          |
| Soft delete           | ✅                     | ⚠️ Rare                       |
| Deduplication (hash)  | ✅                     | ⚠️ Mem0 does smarter          |
| FTS5 search           | ✅                     | ❌ Most use vector embeddings |

## Where Engram Falls Behind

| Gap                     | Impact                                        | Solutions                               |
| ----------------------- | --------------------------------------------- | --------------------------------------- |
| No vector embeddings    | Can't do semantic similarity search           | Add embedding pipeline                  |
| No memory types         | Treats all observations same                  | Add episodic/semantic/procedural        |
| No entity relationships | Can't answer "how has X changed?"             | Add knowledge graph layer               |
| No conflict resolution  | Contradicting facts accumulate                | Implement Mem0's ADD/UPDATE/DELETE/NOOP |
| No confidence scores    | No way to weight memories                     | Add trust scoring                       |
| No consolidation        | Memory grows unbounded                        | Add summarization/decay                 |
| No cross-tool sharing   | Locked to LightCode                           | MCP makes this easy                     |
| No temporal reasoning   | Can't query "before X" or "changes over time" | Add timestamps/graph traversal          |
| No prompt caching       | Inefficient token usage                       | Observational memory pattern            |
| Single-layer            | No hot/cold separation                        | Add Redis hot path                      |

---

## Detailed Gap Breakdown

### Gap 1: No Vector Embeddings

**Can't do semantic similarity search** — "remember something like X" fails.

| Who           | What                                                                                                                                                    | Effort                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Engram**    | Add `embedding` column to `observations`, compute via `all-MiniLM-L6-v2` or similar lightweight model, store as `BLOB`, add `<->` FTS5 match in queries | Medium — schema + embedding pipeline |
| **Engram**    | New MCP tool: `mem_similar(query, limit)` — embeds query, returns top-K by cosine similarity                                                            | Medium — new tool + ranking          |
| **LightCode** | **Could workaround now** — use `mem_search` with keywords, or keep a separate Qdrant/Pinecone sidecar for semantic search                               | Quick win                            |

**Recommendation:** Engram add-on, not core. LightCode can bridge with existing `mem_search` + keywords for now.

---

### Gap 2: No Memory Types

**Treats all observations the same** — user assertions and casual chat are indistinguishable.

| Who           | What                                                                                                                                                                                                                         | Effort                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Engram**    | Add `memory_type` column (`episodic` \| `semantic` \| `procedural`) to `observations` table, new MCP tool `mem_save_typed(type, ...)`                                                                                        | Medium — schema + new tool |
| **Engram**    | Auto-classify via lightweight LLM on `mem_save` (opt-in flag)                                                                                                                                                                | Medium                     |
| **LightCode** | **Partially handles this** — Observer uses 🔴/🟡 emoji markers in the text to distinguish assertions vs requests. There is NO `is_assertion` column or typed field — it's a text convention only, not a queryable attribute. | ⚠️ Partial                 |

**Recommendation:** Engram could add the column/tool for other consumers. LightCode's Observer does the semantic separation via emoji markers in text — functional but not queryable downstream.

---

### Gap 3: No Entity Relationships

**Can't answer "how has X changed over time?"**

| Who           | What                                                                                                                                                                | Effort                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Engram**    | New `entities` table + `entity_observations` join table, new tools: `mem_tag_entity`, `mem_entity_history`, `mem_entity_timeline`                                   | Large — schema + graph layer |
| **Engram**    | Alternatively, lightweight: `topic_key` already enables upserts — extend so a topic_key can span multiple `scope` values                                            | Medium                       |
| **LightCode** | **Already partially handles this** — `topic_key` field in observations + AutoDream's "contradiction detection" phase traces entity changes via observation timeline | ✅ Partial                   |

**Recommendation:** LightCode's AutoDream contradiction detection + `topic_key` upserts cover the common case. Engram entity graph is a nice-to-have for upstream.

---

### Gap 4: No Conflict Resolution

**Contradicting facts accumulate** — no ADD vs UPDATE vs DELETE semantics.

| Who           | What                                                                                                                                                                                                                                                                                                | Effort                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Engram**    | New MCP tool: `mem_resolve(content, mode)` — LLM classifies as ADD/UPDATE/DELETE/NOOP, then applies semantics: UPDATE sets `deleted_at` on old, inserts new with same `topic_key`                                                                                                                   | Medium — LLM + logic                         |
| **Engram**    | New tool: `mem_merge(obs_a, obs_b)` — merges two observations, marks original as superseded                                                                                                                                                                                                         | Small                                        |
| **LightCode** | **Partially handled via AutoDream** — `dream/prompt.txt` instructs the dream agent to call `mem_search` before saving, then `mem_update` to merge duplicates instead of creating new ones. This is LLM-directed conflict resolution — no deterministic ADD/UPDATE/DELETE/NOOP logic exists in code. | ⚠️ Partial (LLM-directed, not deterministic) |

**Recommendation:** Engram could add `mem_resolve` for deterministic resolution. LightCode's approach is prompt-guided and works in practice but depends on the dream agent following instructions correctly.

---

### Gap 5: No Confidence Scores

**No way to weight memories** — all observations treated equally.

| Who           | What                                                                                                                                                           | Effort                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Engram**    | Add `confidence` column (`float`, 0-1), new tool `mem_save_with_confidence(content, confidence)`, filter in `mem_context` to exclude low-confidence            | Small — schema + tool |
| **Engram**    | Auto-compute confidence via LLM: extract facts, score each 0-1                                                                                                 | Medium                |
| **LightCode** | **Already has trust weighting** — `<engram-recall>` could filter by confidence if Engram exposes it; currently LightCode relies on recency + observation count | ✅ Partial            |

**Recommendation:** Small Engram addition. LightCode would opt in via `mem_context` params.

---

### Gap 6: No Consolidation

**Memory grows unbounded** — no summarization, decay, or nightly cleanup.

| Who           | What                                                                                                                               | Effort  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Engram**    | New tool: `mem_consolidate(project_id, mode)` — summarization + archiving old observations (older than N days → condensed summary) | Medium  |
| **Engram**    | `mem_prune(deleted_before=timestamp)` — hard-delete soft-deleted rows                                                              | Small   |
| **Engram**    | Retention policy: `mem_set_retention(project_id, days=90)`                                                                         | Small   |
| **LightCode** | **Already has this** — Reflector condenses observations at 40k token threshold; AutoDream consolidates on idle                     | ✅ Done |

**Recommendation:** Engram consolidation tools are useful for other consumers. LightCode is covered.

---

### Gap 7: No Cross-Tool Sharing

**Locked to LightCode** — Engram's data isn't discoverable by other MCP clients.

| Who           | What                                                                      | Effort  |
| ------------- | ------------------------------------------------------------------------- | ------- |
| **Engram**    | Already MCP-native — any MCP client can connect                           | ✅ Done |
| **Engram**    | Publish `engram-mcp` as an official MCP server in MCP registry / Smithery | Small   |
| **LightCode** | Already uses Engram as MCP — nothing to change                            | ✅ Done |

**Recommendation:** This gap is already closed. Engram just needs better discoverability (registry listing).

---

### Gap 8: No Temporal Reasoning

**Can't query "before X" or "changes over time"** — Engram has `created_at` but doesn't expose it.

| Who           | What                                                                                                                                                                                                                                                                                           | Effort                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Engram**    | Add `mem_timeline(project_id, since=timestamp, until=timestamp)` — returns observations in time range                                                                                                                                                                                          | Small — new tool                      |
| **Engram**    | Add `mem_changes_since(entity_id, since=timestamp)` — returns changes to a topic/entity                                                                                                                                                                                                        | Small                                 |
| **Engram**    | Extend `mem_context` with `since=` and `until=` params                                                                                                                                                                                                                                         | Small                                 |
| **LightCode** | **Partially uses this** — `dream/prompt.txt` instructs the dream agent to use `mem_context`, `mem_search`, `mem_save`, `mem_update`, and `mem_get_observation`. However `mem_timeline` is NOT used anywhere in LightCode's code — the claim that "LightCode uses `mem_timeline`" is incorrect. | ⚠️ Partial — `mem_timeline` not wired |

**Recommendation:** Engram's `mem_timeline` exists but LightCode doesn't call it. `mem_get_observation` by ID is used for reading specific observations, not temporal range queries.

---

### Gap 9: No Prompt Caching

**Inefficient token usage** — every system prompt rebuilds from scratch.

| Who           | What                                                                                                                                        | Effort                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Engram**    | Add `mem_cache_key(topic)` — returns stable hash of observation set for cache invalidation                                                  | Small — hashing logic |
| **Engram**    | Add `mem_cache_ttl(project_id)` — sets cache TTL for `mem_context` responses                                                                | Small                 |
| **LightCode** | **Already has this** — BP1-4 markers in system prompt + header (1h TTL), recall (5min TTL), observations (session TTL), volatile (no cache) | ✅ Done               |

**Recommendation:** This gap is already closed in LightCode. Engram could expose TTL knobs for other consumers.

---

### Gap 10: Single-Layer (No Hot/Cold Separation)

**All observations in one SQLite table** — no hot path for recent/active memory.

| Who           | What                                                                                                                                  | Effort                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Engram**    | Add `hot` flag to `observations`, new tool `mem_hot(project_id, limit=50)` — returns only hot observations                            | Small — add column + tool |
| **Engram**    | Auto-promote: observations accessed >N times or within recent session → hot                                                           | Medium                    |
| **Engram**    | In-memory LRU cache layer in front of SQLite                                                                                          | Medium                    |
| **LightCode** | **Already works around this** — LightCode doesn't need hot/cold because it controls what goes in system prompt via Observer/Reflector | ✅ Done                   |

**Recommendation:** Engram could add hot/cold for consumers who don't have a LightCode-style observer layer.

---

## Summary Matrix

| Gap                  | Engram                             | LightCode                                     | Status            |
| -------------------- | ---------------------------------- | --------------------------------------------- | ----------------- |
| Vector embeddings    | Needs embedding pipeline           | Can workaround with `mem_search`              | 🟡 Engram gap     |
| Memory types         | Needs `memory_type` column         | ⚠️ Emoji markers only, not queryable          | 🟡 Partial        |
| Entity relationships | Needs graph layer                  | ⚠️ Partial via `topic_key` + AutoDream        | 🟡 Partial        |
| Conflict resolution  | Could add `mem_resolve`            | ⚠️ LLM-directed only (AutoDream prompt)       | 🟡 Partial        |
| Confidence scores    | Could add `confidence` column      | Could filter `mem_context`                    | 🟡 Engram gap     |
| Consolidation        | Could add `mem_consolidate`        | ✅ Reflector + AutoDream                      | 🟢 LightCode done |
| Cross-tool sharing   | Already MCP, needs discoverability | ✅ Uses MCP                                   | 🟢 Done           |
| Temporal reasoning   | Could expose `since/until` params  | ⚠️ `mem_timeline` not wired in LightCode      | 🟡 Partial        |
| Prompt caching       | Could expose TTL knobs             | ✅ BP1-4 markers                              | 🟢 Done           |
| Hot/cold separation  | Could add hot flag + LRU           | ✅ Not needed (Observer/Reflector handles it) | 🟢 LightCode done |

---

## Net Assessment

> Last verified against codebase: 2026-04-05

LightCode's 4-layer memory stack (Recall → Observer → Reflector → AutoDream) closes the most critical gaps. However 3 claims in the original analysis were overstated:

**Corrected claims (code-verified):**

- **Memory types**: LightCode uses 🔴/🟡 emoji markers in text — functional separation, but NOT a typed/queryable attribute. `is_assertion` column does not exist.
- **Conflict resolution**: AutoDream's `dream/prompt.txt` instructs the LLM agent to use `mem_update` to merge duplicates. This is prompt-directed, not deterministic code — works in practice but has no fallback if the agent ignores it.
- **Temporal reasoning**: `mem_timeline` is NOT called anywhere in LightCode's code. `mem_get_observation` is used for specific ID lookups. The timeline query capability exists in Engram but is unused.

**What Engram should add for the broader ecosystem:**

1. **Vector embeddings** — semantic similarity search (`mem_similar`)
2. **Confidence scores** — weighted memory retrieval
3. **`mem_resolve`** — deterministic ADD/UPDATE/DELETE/NOOP conflict resolution (currently LightCode relies on LLM judgment in AutoDream)

**What is actually solid in LightCode:**

- Consolidation: ✅ Reflector (40k token threshold, retry loop) + AutoDream (session idle)
- Prompt caching: ✅ BP1-4 with 1h/5min TTLs
- Hot/cold: ✅ Observer/Reflector/Recall pipeline makes explicit hot/cold unnecessary
