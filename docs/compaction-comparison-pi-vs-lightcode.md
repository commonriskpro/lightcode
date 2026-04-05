# Context Compaction: Pi vs LightCode — Honest Comparison

> ⚠️ **OBSOLETE — 2026-04-05**
> LightCode's emergency compaction system (`compaction.ts`, `cut-point.ts`, `overflow.ts`) was **deleted entirely** and replaced by OM-based context management (tail filtering via `lastObservedAt`, `lastMessages` safety cap, Observer tool compression). The LightCode side of every comparison in this document now describes deleted code.
>
> For the current architecture see: `docs/om-replace-compaction.md` and `docs/om-gap-implementations.md`.

---

> An evidence-based, side-by-side analysis of two approaches to context window management.

---

## TL;DR Verdict

**Neither system is categorically "better." They optimize for different things.**

- **Pi wins on**: information preservation across compactions, programmatic file tracking, branch navigation, and post-compaction state correctness.
- **LightCode wins on**: defense-in-depth (3 layers vs 2), tool output management (pruning), plugin extensibility, and overflow pattern coverage.
- **Both are equivalent on**: core compaction strategy (cut-point + LLM summary), token estimation (chars/4), overflow detection patterns, and configuration flexibility.

---

## 1. Architecture Comparison

### Layers of Defense

| Layer                          | Pi                                  | LightCode                                                                                       |
| ------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Tool output truncation**     | None                                | Yes — 2,000 lines / 50KB per tool output                                                        |
| **Tool output pruning**        | None                                | Yes — erases old tool outputs, keeps recent 40K tokens                                          |
| **Proactive threshold check**  | `contextTokens > window - reserve`  | `count >= usable` (with input limit awareness)                                                  |
| **LLM summary compaction**     | Cut-point + summary                 | Full history + summary                                                                          |
| **Reactive overflow recovery** | 1 retry                             | Compact + replay (no retry limit on compaction itself, but compaction-of-compaction fails fast) |
| **Provider error detection**   | 18 regex patterns + silent overflow | 28 regex patterns + structural checks (HTTP 413, error.code)                                    |

**Verdict**: LightCode has **3 layers** (truncation → pruning → compaction) vs Pi's **1 layer** (compaction only). This means LightCode sessions survive longer before needing a full compaction. Pi compensates with a more sophisticated compaction algorithm.

---

## 2. Core Compaction Strategy

### What Gets Fed to the Summary LLM

| Aspect                  | Pi                                                                  | LightCode                                           |
| ----------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| **Input to summarizer** | Messages before cut point only (~everything except last 20K tokens) | Entire visible conversation history                 |
| **Approach**            | Selective: only old context needs summarizing                       | Full: the whole conversation is re-summarized       |
| **Efficiency**          | More token-efficient (smaller input to compaction LLM)              | Less token-efficient (sends more to compaction LLM) |
| **Risk**                | Summary may miss connections between old and new context            | Summary sees the full picture but costs more        |

**Pi's approach**: Find a cut point → summarize everything before it → keep everything after it verbatim.

**LightCode's approach**: Send everything to the compaction agent → get a full summary → replace everything with the summary.

**Verdict**: Pi is more **token-efficient** per compaction call. LightCode is **simpler** and gets a more holistic summary because the LLM sees the full conversation. However, LightCode's approach can itself overflow if the conversation is very long (it handles this by failing fast with an error).

---

## 3. Iterative vs Fresh Summaries

| Aspect                    | Pi                                                                            | LightCode                                                   |
| ------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **On re-compaction**      | Updates the previous summary (iterative)                                      | Generates a fresh summary from visible history              |
| **Information loss risk** | Low — previous summary is preserved and updated                               | Higher — if the LLM misses details, they're gone            |
| **Summary quality**       | Accumulates over time, may get bloated                                        | Fresh each time, but may drop older details                 |
| **Prompt**                | "UPDATE the existing structured summary... PRESERVE all existing information" | "Provide a detailed prompt for continuing our conversation" |

**Pi's advantage**: After 5 compactions, Pi's summary still contains information from compaction #1 because each update preserves the previous summary. LightCode's summary after compaction #5 only contains what the LLM can extract from the post-compaction-#4 context.

**LightCode's counter**: LightCode's pruning layer means compaction fires less frequently. And since it sends the full visible history (including the previous compaction summary), the LLM CAN carry information forward — it just isn't explicitly instructed to preserve it.

**Verdict**: **Pi wins here.** Iterative updates are objectively better for long-running sessions. The explicit "PRESERVE all existing information" instruction is a meaningful improvement.

---

## 4. Cut Point vs Full Replacement

### Pi: Cut Point Algorithm

```
[msg1][msg2][msg3][msg4][msg5][msg6][msg7][msg8]
                    ↑ cut point
[SUMMARY of msg1-4] [msg5][msg6][msg7][msg8]
```

Recent messages (msg5-8, ~20K tokens) are kept **verbatim**. The summary only covers old messages.

### LightCode: Full Replacement

```
[msg1][msg2][msg3][msg4][msg5][msg6][msg7][msg8]
[SUMMARY of msg1-8]
```

Everything is summarized. The last user message is then **replayed** if it was an overflow-triggered compaction.

| Aspect                       | Pi (cut point)                                    | LightCode (full replacement)                   |
| ---------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| **Recent context fidelity**  | Perfect — kept verbatim                           | Lost — summarized, then last user msg replayed |
| **Tool call/result pairing** | Preserved in kept region                          | Lost in summary (LLM must reconstruct)         |
| **Code snippets**            | Preserved in kept region                          | Lost (LLM summarizes, may omit code)           |
| **Complexity**               | Higher (cut point selection, split turn handling) | Lower (summarize everything, replay last)      |

**Verdict**: **Pi wins.** Keeping recent messages verbatim preserves exact tool calls, code snippets, and error messages. LightCode's full replacement relies on the LLM to faithfully reproduce this detail in the summary, which it often doesn't.

---

## 5. Tool Output Management

| Aspect                     | Pi                                       | LightCode                                                                  |
| -------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| **Pre-emptive truncation** | None                                     | 2,000 lines / 50KB per tool output                                         |
| **Pruning old outputs**    | None                                     | Yes — `[Old tool result content cleared]` after 40K token threshold        |
| **Pruning protection**     | N/A                                      | Last 2 user turns + last 40K tokens of tool output protected               |
| **Protected tools**        | N/A                                      | `skill` tool never pruned                                                  |
| **Result**                 | Large tool outputs stay until compaction | Large outputs truncated at creation + old outputs pruned before compaction |

**Verdict**: **LightCode wins.** The two-layer defense (truncation + pruning) means the context window degrades gracefully. Pi sessions with many large tool outputs will hit compaction sooner because there's no intermediate cleanup.

---

## 6. File Tracking Across Compactions

| Aspect              | Pi                                                          | LightCode                                                 |
| ------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| **Mechanism**       | Programmatic extraction from tool calls (read/write/edit)   | LLM-generated in summary ("Relevant files / directories") |
| **Format**          | XML tags: `<read-files>`, `<modified-files>`                | Markdown section in summary template                      |
| **Reliability**     | 100% — extracted from actual tool call data                 | Depends on LLM faithfulness                               |
| **Carried forward** | `CompactionDetails.fileOps` stored in each compaction entry | Only if LLM includes it in the summary                    |

**Verdict**: **Pi wins.** Programmatic file tracking is deterministic and reliable. LightCode's approach relies on the LLM to list files, which can miss files or hallucinate.

---

## 7. Overflow Detection

| Aspect                   | Pi                                    | LightCode                                                   |
| ------------------------ | ------------------------------------- | ----------------------------------------------------------- |
| **Regex patterns**       | 18 patterns                           | 28 patterns (superset of Pi's + more)                       |
| **Silent overflow**      | z.ai `usage.input > contextWindow`    | Not implemented                                             |
| **Structural checks**    | None                                  | HTTP 413 status, `error.code === "context_length_exceeded"` |
| **Anti-patterns**        | 3 exclusions (rate limit, throttling) | None explicit (handled by retry classification)             |
| **Stream error parsing** | Basic                                 | Full JSON streaming error object parsing                    |

**Verdict**: **LightCode has broader coverage** (28 vs 18 patterns + structural checks). Pi has the z.ai silent overflow detection which LightCode lacks, but that's a niche case.

---

## 8. Overflow Recovery

| Aspect                          | Pi                                                       | LightCode                                                               |
| ------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Recovery attempts**           | Exactly 1                                                | No limit on compaction retries, but compaction-of-compaction fails fast |
| **Error message handling**      | Removes error from agent state, keeps in session history | Error published to UI (fixed in fork: suppressed for overflow)          |
| **Auto-retry after compaction** | Yes (100ms delay → `agent.continue()`)                   | Yes (replays last user message in new turn)                             |
| **Message replay**              | Not explicit                                             | Explicit replay of last user message with parts                         |
| **Model switch guard**          | Yes — checks if overflow was from current model          | No explicit guard                                                       |
| **Stale compaction guard**      | Yes — checks if assistant predates last compaction       | No explicit guard                                                       |

**Verdict**: **Pi is more defensive** with its model switch and stale compaction guards. LightCode's replay mechanism is more complete (replays the full user message with all parts, minus compaction parts), but lacks the safety guards.

---

## 9. Session Structure

| Aspect                     | Pi                                                        | LightCode                                                             |
| -------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| **Structure**              | Tree (entries with id + parentId)                         | Linear chain (messages with parentID)                                 |
| **Branching**              | Native — fork, navigate, branch summaries                 | No native branching (fork via subagents only)                         |
| **Branch summaries**       | Yes — when switching branches, old branch is summarized   | N/A                                                                   |
| **Context reconstruction** | Tree walk from leaf to root, resolving compaction entries | `filterCompacted()` walks newest-to-oldest, stops at compaction point |

**Verdict**: **Pi wins for interactive exploration.** Tree-structured sessions allow branching and backtracking with context-aware summaries. LightCode's linear sessions are simpler but less flexible.

---

## 10. Plugin/Extension System

| Aspect                         | Pi                                                     | LightCode                                      |
| ------------------------------ | ------------------------------------------------------ | ---------------------------------------------- |
| **Compaction prompt override** | Extension hook: `session_before_compact`               | Plugin hook: `experimental.session.compacting` |
| **Cancel compaction**          | Yes — extensions can return a custom summary or cancel | No — plugins can only modify prompt/context    |
| **Per-LLM-call context hook**  | `context` event → transform messages before every call | `experimental.chat.messages.transform`         |
| **Post-compaction hook**       | `session_compact` event                                | `session.compacted` bus event                  |

**Verdict**: **Roughly equal.** Both have pre/post hooks. Pi can cancel compaction; LightCode can't. LightCode's plugin system is more mature (npm packages, TUI integration).

---

## 11. Configuration

| Parameter                   | Pi Default                  | LightCode Default                                        |
| --------------------------- | --------------------------- | -------------------------------------------------------- |
| **Enable auto-compaction**  | `compaction.enabled = true` | `compaction.auto = true`                                 |
| **Reserve tokens**          | `16,384`                    | `min(20,000, maxOutputTokens)`                           |
| **Keep recent tokens**      | `20,000`                    | N/A (full replacement, not cut-point)                    |
| **Enable pruning**          | N/A                         | `compaction.prune = true`                                |
| **Prune threshold**         | N/A                         | `PRUNE_MINIMUM = 20,000`                                 |
| **Prune protection**        | N/A                         | `PRUNE_PROTECT = 40,000`                                 |
| **Max retries (transient)** | `3`                         | Unlimited (with backoff)                                 |
| **Base retry delay**        | `2,000ms`                   | `2,000ms`                                                |
| **Max retry delay**         | `60,000ms`                  | `30,000ms` (no headers) / `2^31` (with headers)          |
| **Env var overrides**       | None                        | `OPENCODE_DISABLE_AUTOCOMPACT`, `OPENCODE_DISABLE_PRUNE` |

---

## 12. Summary Prompt Quality

### Pi's Initial Compaction Prompt

```
## Goal
## Constraints & Preferences
## Progress (Done / In Progress / Blocked)
## Key Decisions
## Next Steps
## Critical Context
```

### LightCode's Compaction Prompt

```
## Goal
## Instructions
## Discoveries
## Accomplished
## Relevant files / directories
```

**Notable differences**:

- Pi separates "Constraints & Preferences" from "Key Decisions" — LightCode merges them into "Instructions"
- Pi has "Progress" with Done/InProgress/Blocked status — LightCode has "Accomplished" (no status tracking)
- Pi has "Critical Context" — LightCode has "Discoveries"
- Pi's iterative update prompt explicitly says "move items from In Progress to Done" — tracks progress over time
- LightCode asks for file/directory tracking explicitly — Pi does it programmatically

**Verdict**: **Pi's prompt template is better structured for long-running sessions** because it tracks progress status. LightCode's is more natural/flexible.

---

## 13. Final Scorecard

| Category                            | Pi                              | LightCode                             | Winner        |
| ----------------------------------- | ------------------------------- | ------------------------------------- | ------------- |
| **Defense layers**                  | 1 (compaction only)             | 3 (truncation + pruning + compaction) | **LightCode** |
| **Token efficiency per compaction** | Selective (old msgs only)       | Full history                          | **Pi**        |
| **Information preservation**        | Iterative updates               | Fresh each time                       | **Pi**        |
| **Recent context fidelity**         | Verbatim (cut-point)            | Summarized (full replacement)         | **Pi**        |
| **File tracking**                   | Programmatic                    | LLM-generated                         | **Pi**        |
| **Tool output management**          | None                            | Truncation + pruning                  | **LightCode** |
| **Overflow patterns**               | 18 regex                        | 28 regex + structural                 | **LightCode** |
| **Recovery guards**                 | Model switch + stale compaction | None explicit                         | **Pi**        |
| **Session branching**               | Tree + branch summaries         | Linear                                | **Pi**        |
| **Plugin system**                   | Extension hooks                 | npm plugin ecosystem                  | **LightCode** |
| **Configuration**                   | 3 params                        | 5 params + env vars                   | **LightCode** |
| **Retry policy**                    | Max 3                           | Unlimited + backoff                   | **Tie**       |

### Score: Pi 5 — LightCode 4 — Tie 1

---

## 14. Recommendations for LightCode

### High Value, Low Effort

1. **Iterative summary updates** — When re-compacting, pass the previous summary to the LLM with "PRESERVE all existing information, UPDATE with new" instructions. ~20 lines of code in `processCompaction()`.

2. **Model switch guard** — Before treating an overflow as recoverable, check that the assistant message came from the current model. Prevents stale errors from a smaller model being misinterpreted. ~5 lines in `processor.ts`.

3. **Stale compaction guard** — Skip compaction check for assistant messages that predate the latest compaction. ~5 lines in the overflow check.

### Medium Value, Medium Effort

4. **Programmatic file tracking** — Extract read/write/edit file paths from tool calls during compaction prep, append as structured data to the summary. ~50 lines in `compaction.ts`.

5. **Post-compaction usage = null** — Report token usage as unknown after compaction until fresh data arrives. Prevents stale numbers in the TUI. ~10 lines in the UI layer.

### High Value, High Effort

6. **Cut-point based compaction** — Switch from full-replacement to cut-point strategy, keeping recent messages verbatim. Major refactor of `processCompaction()` and `filterCompacted()`. Would require significant testing.

### Not Recommended

7. **Tree-structured sessions** — Pi's tree model enables branching but adds significant complexity. LightCode's linear model with subagent forking is simpler and sufficient for most workflows. The cost/benefit ratio is unfavorable.
