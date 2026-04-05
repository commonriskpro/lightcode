# Tasks: Observational Memory Quality — 6 Gaps

## Phase 1: Infrastructure (DB + Types)

- [x] 1.1 Add `current_task text().nullable()` and `suggested_continuation text().nullable()` to `ObservationTable` in `src/session/session.sql.ts`
- [x] 1.2 Run `bun run db generate --name om-quality-columns` from `packages/opencode` — verify migration file created in `migration/<timestamp>_om-quality-columns/`
- [x] 1.3 Add `ThresholdRange = { min: number; max: number }` type export to `src/session/om/buffer.ts`
- [x] 1.4 Add `calculateDynamicThreshold(threshold: number | ThresholdRange, obsTokens: number): number` — when `number`: return as-is; when range: `Math.max(threshold.min, threshold.max - obsTokens)`
- [x] 1.5 Update `OMBuf.check(sid, tok, obsTokens?: number)` — optional third param; when provided and `observer_message_tokens` is a `ThresholdRange`, use `calculateDynamicThreshold` for TRIGGER; otherwise existing constants unchanged
- [x] 1.6 Add `observer_message_tokens?: number | ThresholdRange` to `src/config/config.ts` experimental block

## Phase 2: Degenerate Detection

- [x] 2.1 Implement and export `detectDegenerateRepetition(text: string): boolean` in `src/session/om/observer.ts` — return `false` if `text.length < 2000`; sample 10 chunks of 200 chars at evenly-spaced positions; return `true` if ≥ 8 of 9 consecutive pairs share > 90% character overlap

## Phase 3: Observer — Structured Output + currentTask Round-Trip

- [x] 3.1 Update `PROMPT` in `observer.ts` to require `<observations>`, `<current-task>`, `<suggested-response>` XML sections in output — keep all extraction rules, change only the output format section
- [x] 3.2 Define and export `ObserverResult`: `{ observations: string; currentTask?: string; suggestedContinuation?: string }`
- [x] 3.3 Implement `parseObserverOutput(raw: string): ObserverResult` — regex-extract `<observations>` content; fallback to full `raw` when tag absent; extract `<current-task>` and `<suggested-response>` independently, both optional
- [x] 3.4 Update `Observer.run()` to accept `priorCurrentTask?: string`; append `\n\n## Prior Context — Current Task\n${priorCurrentTask}` to system prompt when present
- [x] 3.5 Update `Observer.run()` return type to `Promise<ObserverResult | undefined>`; call `detectDegenerateRepetition(result.text)` — if true: `log.warn(...)`, return `undefined`; else: return `parseObserverOutput(result.text)`
- [x] 3.6 Update **buffer/activate call site** in `prompt.ts` (~line 1525): pass `priorCurrentTask: rec?.current_task ?? undefined`; destructure `ObserverResult`; upsert with `observations: result.observations, current_task: result.currentTask ?? null, suggested_continuation: result.suggestedContinuation ?? null`
- [x] 3.7 Update **force call site** in `prompt.ts` (~line 1563): identical changes to 3.6
- [x] 3.8 Update `OMBuf.check()` call in `prompt.ts` (~line 1517) to pass `OM.get(sessionID)?.observation_tokens` as third arg

## Phase 4: Reflector — Compression Retry

- [x] 4.1 Define `type CompressionLevel = 0 | 1 | 2 | 3 | 4` in `reflector.ts`
- [x] 4.2 Define `COMPRESSION_GUIDANCE: Record<CompressionLevel, string>` — level 0 = `""`, levels 1–4 progressively more aggressive (port from Mastra `reflector-agent.ts`)
- [x] 4.3 Implement `validateCompression(text: string, target: number): boolean` — `(text.length >> 2) < target`
- [x] 4.4 Import `detectDegenerateRepetition` from `./observer` in `reflector.ts`
- [x] 4.5 Rewrite `Reflector.run()` as retry loop: `best: { text: string; tok: number } | undefined`, `level: CompressionLevel = 0`; while `level <= 4`: generate → catch errors → degenerate check → `validateCompression` → track best; after loop: `OM.reflect(sid, best.text)`

## Phase 5: Observation Context Instructions

- [x] 5.1 Add `OBSERVATION_CONTEXT_INSTRUCTIONS` constant to `src/session/system.ts` — prefer most recent info on date conflicts, assume past planned actions completed, continue naturally without mentioning memory
- [x] 5.2 Update `wrapObservations(body: string, hint?: string): string` — keep existing wrap + `capRecallBody`; append `\n\n${OBSERVATION_CONTEXT_INSTRUCTIONS}` AFTER closing tag (not capped); if `hint`: also append `\n\n<system-reminder>\n${hint}\n</system-reminder>`
- [x] 5.3 Update `SystemPrompt.observations(sid)` to pass `rec.suggested_continuation ?? undefined` as second arg to `wrapObservations`

## Phase 6: Fix Tests

- [x] 6.1 Update all inline `ObservationRecord` literals (in `prompt.ts` and any test files) to include `current_task: null, suggested_continuation: null` — typecheck will list all missing spots
- [x] 6.2 Fix any tests that assert exact `wrapObservations` output format — change `toBe` to `toContain` checks
- [x] 6.3 Add new tests: `detectDegenerateRepetition`, `parseObserverOutput`, `calculateDynamicThreshold`, `validateCompression`, `wrapObservations` with hint, `currentTask` DB round-trip, Reflector retry loop
- [x] 6.4 Run `bun test --cwd packages/opencode` — all pass
- [x] 6.5 Run `bun typecheck --cwd packages/opencode` — zero errors
