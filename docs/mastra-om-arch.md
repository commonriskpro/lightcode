# Mastra Observational Memory — Architecture Deep Dive & Fork Integration Plan

> Repo source: `mastra-ai/mastra` (22.7k ★, Apache-2.0)  
> Analyzed: `packages/memory`, `packages/core/src/memory`, `docs/src/content/en/docs/memory`  
> Relevant to: lightcodev2 fork — `packages/opencode/src/session/`  
> **Code-verified against lightcodev2 real implementation** (2026-04-05)  
> **Implementation status**: Phase 1 (recall + AutoDream) ✅ · Phase 2 (Observer + ObservationTable) ✅ · Phase 3 (Reflector) ✅ · Gap D+C (BP3 slot order) ✅ · Gap E (tool parts) ✅ · Gap F (tail boundary) ✅ · Gap 1 (continuation hint) ✅ · Gap 2 (timing fix) ✅ · Gap 3 (lastMessages cap) ✅  
> **Emergency compaction removed**: `compaction.ts`, `cut-point.ts`, `overflow.ts` deleted — OM is now the sole context management mechanism.

---

## 1. What Is Observational Memory (OM)?

OM is Mastra's solution to the **context rot problem**: as raw message history grows, LLM performance degrades and context fills up. Instead of naive truncation or sliding windows, OM uses **two background LLM agents** that watch conversations and compress old content into dense observations — like how the human brain subconsciously processes and consolidates long-term memory.

> "You don't remember every word of every conversation you've ever had. You observe what happened subconsciously, then your brain reflects — reorganizing, combining, and condensing into long-term memory."
> — Mastra docs

### Key insight: this is NOT summarization

Summarization loses fidelity. OM **preserves** facts via observation bullets with temporal anchoring:

```md
Date: 2026-01-15

- 🔴 12:10 User is building a Next.js app with Supabase auth, due in 1 week (meaning January 22nd 2026)
  - 🔴 12:10 App uses server components with client-side hydration
  - 🟡 12:12 User asked about middleware configuration for protected routes
  - 🔴 12:15 User stated the app name is "Acme Dashboard"
```

Compression ratio: **5–40×** depending on content density.

---

## 2. System Architecture

### Three-Tier Memory Model

```
┌─────────────────────────────────────────────────────────────────┐
│                     AGENT CONTEXT WINDOW                        │
├─────────────────────────────────────────────────────────────────┤
│  TIER 3: Reflections (condensed observations when obs grows)    │
│  ──────────────────────────────────────────────────────────────  │
│  TIER 2: Observations (compressed message history)              │
│  ──────────────────────────────────────────────────────────────  │
│  TIER 1: Recent Messages (exact verbatim, unobserved)           │
└─────────────────────────────────────────────────────────────────┘
```

### Component Diagram

```
packages/memory/src/
├── index.ts                    ← Memory class (entry point)
│   └── _initOMEngine()         ← lazy init of OM engine
│
└── processors/observational-memory/
    ├── observational-memory.ts  ← ObservationalMemory class (core engine)
    ├── observer-runner.ts       ← runs Observer LLM calls
    ├── reflector-runner.ts      ← runs Reflector LLM calls
    ├── buffering-coordinator.ts ← async background buffering state machine
    ├── token-counter.ts         ← fast local token estimation (tokenx)
    ├── thresholds.ts            ← dynamic threshold computation
    ├── observation-groups.ts    ← group ↔ raw message pointer management
    ├── markers.ts               ← typed data stream parts (data-om-*)
    ├── types.ts                 ← all TS types/interfaces
    ├── constants.ts             ← defaults (30k obs threshold, 40k refl)
    ├── observer-agent.ts        ← prompt construction + output parsing
    ├── reflector-agent.ts       ← prompt construction + output parsing
    ├── model-by-input-tokens.ts ← token-tiered model routing
    └── tools/om-tools.ts        ← `recall` tool (retrieval mode)
```

---

## 3. Data Flow — Step by Step

### 3.1 Normal turn (under threshold)

```
User message → saveMessages() → getContext()
                                    ↓
                        load unobserved messages
                        inject observations into system prompt
                        inject continuation hint
                        return {systemMessage, messages}
```

### 3.2 Threshold crossed (Observer fires)

```
Token counter checks unobserved messages
  ↓ tokens > messageTokens (default: 30k)
BufferingCoordinator:
  IF async buffering active → activate pre-computed chunk (instant, no LLM call)
  IF no buffer → fire ObserverRunner (blocking LLM call)
    ↓
  ObserverRunner calls Observer LLM:
    - system prompt: extraction instructions (CRITICAL DISTINGUISH assertions/questions)
    - user prompt: formatted message history with timestamps
    - output: observation log with 🔴🟡 priority markers + currentTask + suggestedResponse
    ↓
  Observations stored in OM record (DB)
  Observed messages flagged with lastObservedAt boundary
  Messages removed from context window
```

### 3.3 Background buffering (default, enabled)

```
Every bufferTokens interval (default: 20% of 30k = every ~6k tokens):
  BufferingCoordinator fires background Observer LLM call (non-blocking)
    → stores result as "buffered chunk"

When messageTokens threshold reached:
  Activation: buffered chunks move to active observation log
  Corresponding raw messages removed from context
  Zero blocking time for the main agent
```

### 3.4 Reflection (observations threshold: 40k)

```
observations tokens > observationTokens threshold
  ↓
ReflectorRunner fires Reflector LLM:
  - Receives full observation log
  - Condenses, combines related items, reflects on patterns
  - Returns compressed observation log
    ↓
  Old observations replaced by reflection
  Generation count incremented
```

---

## 4. Key Implementation Details

### 4.1 Observer Prompt Engineering

The Observer distinguishes:

- **User assertions** (`🔴` = high priority): "I work at Acme" → hard fact
- **User questions** (`🟡` = medium priority): "Can you help me..." → request
- **State changes**: marks explicit superseding ("replacing old approach")
- **Temporal anchoring**: resolves relative dates ("next week" → "June 17-18, 2026")

This is what makes OM dramatically better than summarization — facts are preserved with intent classification.

### 4.2 Token Counting

- Uses `tokenx` for fast local estimation (no API call)
- Image parts: provider-aware heuristics
- Caches estimates in `message.metadata.providerMetadata.mastra`
- Avoids re-counting on repeated passes

### 4.3 Scopes

| Scope                     | Description             | Use case              |
| ------------------------- | ----------------------- | --------------------- |
| `thread` (default)        | Per-thread observations | Most agentic uses     |
| `resource` (experimental) | Cross-thread per-user   | Long-term user memory |

### 4.4 Retrieval Mode (experimental)

When `retrieval: true`, each observation group stores a `range` pointer (`startId:endId`) to the raw messages it was derived from. A `recall` tool is auto-registered so the agent can page through the original messages behind any observation.

With `retrieval: { vector: true }`, observation groups are also indexed into the vector store for semantic search.

### 4.5 ModelByInputTokens

Token-tiered model routing — use cheap fast models for small contexts, strong models for large ones:

```typescript
new ModelByInputTokens({
  upTo: {
    5_000: "mistralai/ministral-8b",
    20_000: "mistralai/mistral-small",
    40_000: "openai/gpt-4o-mini",
    1_000_000: "google/gemini-2.5-flash",
  },
})
```

### 4.6 Streaming Data Parts

OM emits typed `data-*` parts during streaming for real-time UI feedback:

| Part type                    | When emitted                               |
| ---------------------------- | ------------------------------------------ |
| `data-om-status`             | Every step — token counts, buffering state |
| `data-om-observation-start`  | Observer/Reflector begins                  |
| `data-om-observation-end`    | Observer/Reflector completes               |
| `data-om-observation-failed` | Observer/Reflector fails                   |
| `data-om-buffering-start`    | Background buffering begins                |
| `data-om-buffering-end`      | Background buffering complete              |
| `data-om-activation`         | Buffered chunks activated                  |

---

## 5. Storage Requirements

OM requires storage adapters that support `supportsObservationalMemory = true`:

- `@mastra/pg` (PostgreSQL)
- `@mastra/libsql` (SQLite/Turso)
- `@mastra/mongodb`

Key DB operations:

- `getOMRecord(threadId, resourceId)` — load active observations
- `saveOMRecord(record)` — persist observations after Observer run
- `listMessages({ filter: { dateRange: { start: lastObservedAt } } })` — load only unobserved messages
- `saveBufferedChunk(chunk)` — async buffer storage
- `activateBufferedChunks(chunks)` — atomically move buffered → active

---

## 6. What lightcodev2 Does Today — FULLY IMPLEMENTED (CODE-VERIFIED 2026-04-05)

> ⚠️ The previous version of this section described an older state. Everything described as "missing" or "planned" has been implemented.

### Context Management: OM replaces compaction

The emergency compaction system (`compaction.ts`, `cut-point.ts`, `overflow.ts`) was **deleted entirely** on 2026-04-05. OM is now the sole context management mechanism.

| Aspect       | Old lightcodev2 (deleted)                       | lightcodev2 current (Mastra-aligned)                  |
| ------------ | ----------------------------------------------- | ----------------------------------------------------- |
| Trigger      | Token overflow (context window full — reactive) | Token threshold (~30k, proactive)                     |
| Approach     | LLM-generated summary (blocking)                | Background Observer agents creating observation log   |
| Timing       | Reactive (blocks when overflow)                 | Proactive (async background buffering)                |
| Message tail | Full history re-sent until ~192k                | Only unobserved tail (`last_observed_at` boundary)    |
| Safety net   | Emergency compaction at overflow                | `lastMessages` cap (default 40) before first Observer |

### Current Prompt Caching (`src/session/llm.ts` + `src/provider/transform.ts`)

4 cache breakpoints, applied in `applyCaching()`:

```
BP1: Last tool definition (1h TTL, Anthropic) — tools[] alphabetically sorted
BP2: system[0] — agent prompt + env + skills + instructions (1h TTL)
BP3: system[1] — OM observations OR sentinel "<!-- ctx -->" (5min TTL)
BP4: conversation[N-2] — penultimate message (5min TTL)
system[2] — Engram recall (session-frozen, NOT cached — ~2k tokens, acceptable)
system[last] — volatile: date + model identity — DELIBERATELY NOT CACHED
```

### Current Session Storage

SQLite via Drizzle. `ObservationTable` and `ObservationBufferTable` are fully implemented and active.

### OM Implementation Status

All components shipped:

| Component                       | File                                  | Status     |
| ------------------------------- | ------------------------------------- | ---------- |
| ObservationTable                | `src/session/session.sql.ts`          | ✅         |
| ObservationBufferTable          | `src/session/session.sql.ts`          | ✅         |
| Observer (background LLM agent) | `src/session/om/observer.ts`          | ✅         |
| Reflector (condense when large) | `src/session/om/reflector.ts`         | ✅         |
| OMBuf state machine             | `src/session/om/buffer.ts`            | ✅         |
| OM CRUD                         | `src/session/om/record.ts`            | ✅         |
| Observation groups              | `src/session/om/groups.ts`            | ✅         |
| Recall tool                     | `src/tool/recall.ts`                  | ✅         |
| System prompt injection (BP3)   | `src/session/llm.ts:131-138`          | ✅ Gap D+C |
| Tool parts in Observer          | `src/session/om/observer.ts:249-262`  | ✅ Gap E   |
| Tail boundary filter            | `src/session/prompt.ts:1776-1789`     | ✅ Gap F   |
| Continuation hint               | `src/session/system.ts` + `prompt.ts` | ✅ Gap 1   |
| Timing fix (last_observed_at)   | `src/session/prompt.ts`               | ✅ Gap 2   |
| lastMessages safety cap         | `src/session/prompt.ts` + `config.ts` | ✅ Gap 3   |

---

## 7. Integration Plan for lightcodev2

### Phase 1: Foundation (DB + Token Counting)

**Goal:** Add OM record + buffered chunks to the DB schema.

```typescript
// New table: session_om_record
const om_record = sqliteTable("session_om_record", {
  id: text().primaryKey(),
  session_id: text().notNull(), // maps to lightcodev2 sessionID
  active_observations: text(), // the current observation log (markdown)
  active_reflections: text(), // condensed observation log (when tier-3 active)
  last_observed_at: integer(), // timestamp boundary for unobserved messages
  generation_count: integer().default(0), // reflection generation counter
  observation_tokens: integer().default(0), // cached token count of active_observations
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
})

// New table: session_om_buffer
const om_buffer = sqliteTable("session_om_buffer", {
  id: text().primaryKey(),
  session_id: text().notNull(),
  observations: text().notNull(), // buffered observation chunk
  message_tokens: integer().notNull(), // tokens this chunk covers
  observation_tokens: integer().notNull(), // tokens this chunk produces
  starts_at: integer().notNull(), // first message timestamp covered
  ends_at: integer().notNull(), // last message timestamp covered
  created_at: integer().notNull(),
})
```

### Phase 2: Observer Agent

**Goal:** Implement the background LLM agent that generates observations.

Key prompt engineering (from Mastra's `observer-agent.ts`):

- CRITICAL: distinguish user assertions from questions
- Temporal anchoring (resolve relative dates)
- State change detection (mark superseding information)
- Priority markers: 🔴 (high — facts) vs 🟡 (medium — requests)

```typescript
// packages/opencode/src/session/om/observer.ts
export namespace Observer {
  const SYSTEM_PROMPT = `/* extraction instructions */`

  export async function run(input: {
    sessionID: SessionID
    messages: MessageV2.WithParts[]
    previousObservations?: string
  }): Promise<{
    observations: string
    currentTask?: string
    suggestedResponse?: string
  }> {
    // call LLM with structured observation prompt
    // parse output (observations block + metadata)
  }
}
```

### Phase 3: BufferingCoordinator

**Goal:** Async background pre-computation of observations.

```typescript
// packages/opencode/src/session/om/buffer.ts
export namespace OMBuffer {
  // State machine:
  // idle → running (when bufferTokens threshold reached) → complete
  // complete → activation (when messageTokens threshold reached)

  export async function maybeBuffer(sessionID: SessionID, currentTokens: number) {
    // check if bufferTokens interval has been crossed
    // if yes: fire background Observer call (non-blocking)
    // store result as buffered chunk
  }

  export async function activate(sessionID: SessionID): Promise<void> {
    // move buffered chunks to active_observations
    // update last_observed_at
    // remove observed messages from context load
  }
}
```

### Phase 4: getContext() Integration

**Goal:** Inject OM observations into the system prompt before each LLM call.

The key integration point is in `packages/opencode/src/session/prompt.ts` or wherever the system prompt is assembled before an LLM call:

```typescript
// In system prompt assembly:
const omRecord = await OM.getRecord(sessionID)
if (omRecord?.active_observations) {
  systemParts.push(`
<observations>
${omRecord.active_observations}
</observations>

Please continue naturally. Use observations as background context.
Do not mention the memory system.
  `)
}

// For messages: only load unobserved messages
const messages = await loadMessages(sessionID, {
  after: omRecord?.last_observed_at, // only newer messages
})
```

### Phase 5: Reflector Agent

**Goal:** Second-tier condensation when observations grow too large.

```typescript
// packages/opencode/src/session/om/reflector.ts
export namespace Reflector {
  const OBSERVATION_THRESHOLD = 40_000 // tokens

  export async function maybeReflect(sessionID: SessionID) {
    const record = await getRecord(sessionID)
    const tokens = estimateTokens(record.active_observations)
    if (tokens < OBSERVATION_THRESHOLD) return

    // call Reflector LLM
    // replace active_observations with condensed version
    // increment generation_count
  }
}
```

---

## 8. Configuration API (Proposed for lightcodev2)

In `~/.config/opencode/config.json` or the agent config:

```json
{
  "observationalMemory": {
    "enabled": true,
    "model": "google/gemini-2.5-flash",
    "observation": {
      "messageTokens": 30000,
      "bufferTokens": 0.2
    },
    "reflection": {
      "observationTokens": 40000
    }
  }
}
```

---

## 9. Benefits for lightcodev2

### lightcodev2 Real Caching Implementation (CODE-VERIFIED)

> Analizado en: `src/session/llm.ts`, `src/provider/transform.ts`

lightcodev2 ya tiene un sistema de prompt caching sofisticado y correcto. Esto **no era** lo que afirmamos inicialmente. Los hechos reales:

**4 cache breakpoints activos:**

| BP      | Ubicación                      | TTL            | Qué se cachea                                                                |
| ------- | ------------------------------ | -------------- | ---------------------------------------------------------------------------- |
| **BP1** | Último tool definido           | 1h (Anthropic) | Tool definitions — más estables, cambian solo cuando se agrega/quita un tool |
| **BP2** | `system[0]` — agent prompt     | 1h (Anthropic) | Prompt del agente — solo cambia al cambiar de agente                         |
| **BP3** | `system[1]` — env + skills     | 5min           | Env/skills — estable dentro de una sesión                                    |
| **BP4** | Penúltimo mensaje conversación | 5min           | Historial reciente — siempre será cache READ en el turno N+1                 |

**Diseño intencional:**

- `system[2]` (fecha + model identity) es **deliberadamente NO cacheado** — es volátil (cambia cada turno)
- Tools se ordenan **alfabéticamente** antes de enviar → orden determinístico → mayor hit rate
- `system[0]` y `system[1]` se mantienen separados con joins explícitos para no invalidar el breakpoint

**Proveedores soportados:** Anthropic (native), OpenRouter, AWS Bedrock, GitHub Copilot, OpenAI-compatible

### vs Current Compaction (corrected)

| Aspecto            | lightcodev2 hoy                                     | Con OM                                                                         |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| Context rot        | Historia completa hasta overflow                    | Resuelto — solo mensajes post-lastObservedAt                                   |
| UX blocking        | LLM call bloqueante al overflow                     | No — async pre-buffering, activación instantánea                               |
| Fidelidad          | Resumen narrativo (Goal/Discoveries)                | Fact-level con prioridad 🔴🟡 y anchoring temporal                             |
| Sessions largas    | Compaction reactiva → salto visible para el usuario | Observaciones continuas, sin saltos perceptibles                               |
| **Prompt caching** | **YA EXISTE** y está bien implementado (BP1-BP4)    | **COMPLEMENTARIO** — observations son estables, mejoran el hit rate de BP2/BP3 |
| Costo tokens input | Caching activo; historia completa en contexto       | Menos tokens en contexto (5–40× compresión)                                    |

### Prompt Caching synergy (corrected)

lightcodev2 **ya** cachea el system prompt correctamente. La ganancia de OM no es "agregar caching" — es que al reducir los mensajes en el contexto, el **BP4 (penúltimo mensaje)** apunta más atrás en el historial, y los tokens observados ya no viajan en el payload. La compresión 5–40× reduce tokens de input directamente, lo que baja costos en providers que cobran por input tokens incluso con cache misses.

---

## 10. Risks & Considerations

| Risk                      | Mitigation                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------- |
| Observer LLM adds latency | Async buffering eliminates blocking; only pays cost when threshold crossed            |
| Observer LLM costs        | Use cheap models (Gemini Flash, GPT-4o-mini); `ModelByInputTokens` for tiered routing |
| Storage migration         | OM reads messages lazily — existing sessions auto-migrate on first threshold cross    |
| Observer model quality    | Use temp=0.3 for Observer, temp=0 for Reflector for consistency                       |
| Observation accuracy      | Prompt engineering is key (distinguish assertions vs questions)                       |
| DB adapter requirements   | Must add `supportsObservationalMemory` flag to lightcodev2's libsql storage           |

---

## 11. Files to Create/Modify

### New files

```
packages/opencode/src/session/om/
├── index.ts          ← OM namespace exports
├── observer.ts       ← Observer agent (LLM calls + prompt)
├── reflector.ts      ← Reflector agent (LLM calls + prompt)
├── buffer.ts         ← BufferingCoordinator state machine
├── record.ts         ← OM record CRUD
└── token.ts          ← Token counting (extends existing Token util)

packages/opencode/src/storage/schema.sql.ts  ← add om_record, om_buffer tables
```

### Modified files

```
packages/opencode/src/session/prompt.ts        ← inject observations into system
packages/opencode/src/session/compaction.ts    ← integrate with OM flow
packages/opencode/src/session/schema.ts        ← OM-related types
packages/opencode/src/config/config.ts         ← observationalMemory config option
```

---

## 12. Reference: Mastra OM Default Values

| Parameter                            | Default                   | Notes                                   |
| ------------------------------------ | ------------------------- | --------------------------------------- |
| `observation.messageTokens`          | 30,000                    | Trigger for Observer                    |
| `observation.bufferTokens`           | 0.2 (20%)                 | Interval: every 6k tokens               |
| `observation.bufferActivation`       | 0.8                       | Keep 20% of messages after activation   |
| `observation.blockAfter`             | 1.2x                      | Apply backpressure when OM falls behind |
| `observation.previousObserverTokens` | 2,000                     | Context for Observer                    |
| `reflection.observationTokens`       | 40,000                    | Trigger for Reflector                   |
| `reflection.bufferActivation`        | 0.5                       | Start background reflection at 50%      |
| `reflection.blockAfter`              | 1.2x                      | Force sync at 48k tokens                |
| Observer temperature                 | 0.3                       | Consistent but not rigid                |
| Reflector temperature                | 0.0                       | Maximum consistency                     |
| Default model                        | `google/gemini-2.5-flash` | Fast, 128k context, cheap               |

---

## 13. Quick Start Prototype

Minimal proof-of-concept for lightcodev2 to validate the approach before full implementation:

```typescript
// packages/opencode/src/session/om/prototype.ts
// Phase 1 PoC: manual trigger, no async buffering, no reflection

import { Session } from "@/session"
import { Provider } from "@/provider/provider"
import { Token } from "@/util/token"

const THRESHOLD = 30_000

export async function maybeObserve(sessionID: string) {
  const messages = await Session.messages({ sessionID })
  const tokens = messages.reduce((sum, m) => sum + Token.estimate(JSON.stringify(m)), 0)

  if (tokens < THRESHOLD) return

  const observations = await runObserver(messages)
  await saveObservations(sessionID, observations)
  await markMessagesAsObserved(sessionID, messages)
}

async function runObserver(messages: any[]) {
  // Call LLM with observation prompt
  // Return markdown observation log
}
```

This prototype validates:

1. Token estimation accuracy
2. Observer LLM quality with lightcodev2 message format
3. System prompt injection effect on agent behavior
4. DB schema suitability

---

_Analysis date: 2026-04-04_  
_Mastra version: `@mastra/memory@1.10.0+`_  
_lightcodev2 branch: dev_
