#!/usr/bin/env bun
/**
 * cache-hit benchmark — OM effectiveness + provider cache hit
 *
 * Measures TWO orthogonal things per turn:
 *
 *   1. PROVIDER CACHE HIT — how many tokens Anthropic/Google served from cache
 *      (cache.read / total_input). This is about prompt caching at the API level.
 *
 *   2. OM EFFECTIVENESS — whether the Observational Memory system is doing its job:
 *      - Did the Observer fire? (generation_count, observation_tokens)
 *      - Are observations reaching BP3? (layers["observations_stable"].tokens)
 *      - Did the Reflector compress? (reflections != null, compression ratio)
 *      - Is the tail shrinking? (tail_msgs / total_msgs)
 *      - Is recall being reused? (recallReused)
 *
 * These are independent: cache hit measures Anthropic's server behavior.
 * OM effectiveness measures whether lightcode/opencode is building good prompts.
 *
 * USAGE
 *   bun bench/cache-hit.ts [options]
 *
 * OPTIONS
 *   --url      Server base URL           (default: http://localhost:4096)
 *   --model    provider/model slug       (default: opencode/big-pickle)
 *   --turns    Number of conversation turns to run (default: 6)
 *   --dir      Project directory for the session (default: cwd)
 *   --label    Label for this run (e.g. "lightcodev2" or "opencode")
 *   --json     Output raw JSON instead of table
 *   --compare  Path to a previous JSON output to diff against
 *
 * EXAMPLES
 *   bun bench/cache-hit.ts --label lightcodev2
 *   bun bench/cache-hit.ts --json > /tmp/lc.json
 *   bun bench/cache-hit.ts --compare /tmp/lc.json --compare /tmp/oc.json
 */

import path from "path"

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = (() => {
  const a = process.argv.slice(2)
  const get = (flag: string, fallback: string) => {
    const i = a.indexOf(flag)
    return i !== -1 && a[i + 1] ? a[i + 1]! : fallback
  }
  const getAll = (flag: string): string[] => {
    const out: string[] = []
    for (let i = 0; i < a.length; i++) if (a[i] === flag && a[i + 1]) out.push(a[i + 1]!)
    return out
  }
  return {
    url: get("--url", process.env.OPENCODE_URL ?? "http://localhost:4096"),
    model: get("--model", process.env.BENCH_MODEL ?? "opencode/big-pickle"),
    turns: Number(get("--turns", "6")),
    dir: get("--dir", process.cwd()),
    label: get("--label", "unknown"),
    json: a.includes("--json"),
    compare: getAll("--compare"),
  }
})()

// ─── API types ────────────────────────────────────────────────────────────────

type Layer = { key: string; tokens: number; hash?: string }

type CacheAlignment = {
  total: number
  limit: number
  ok: boolean
  systemBP: number[]
  messageBP: { i: number; role: string }[]
  toolBP: string[]
}

type Profile = {
  sessionID: string
  requestAt: number
  recallReused: boolean
  layers: Layer[]
  cache: { read: number; write: number; input: number }
  alignment?: CacheAlignment
}

type Memory = {
  observations: string | null
  reflections: string | null
  current_task: string | null
  observation_tokens: number
  generation_count: number
  last_observed_at: number | null
  is_observing: boolean
  is_reflecting: boolean
  is_dreaming: boolean
}

type Message = { info: { id: string; role: string; time?: { created?: number } } }

// ─── Turn result ──────────────────────────────────────────────────────────────

type TurnResult = {
  turn: number
  prompt: string
  durationMs: number

  // Provider cache
  cacheHitRate: number // read / (read + write + input)
  cacheTokens: { read: number; write: number; input: number }

  // OM state after this turn
  om: {
    fired: boolean // Observer ran at least once
    generationCount: number // total Observer invocations
    observationTokens: number // raw observation size in tokens
    reflected: boolean // Reflector has run (reflections != null)
    compressionRatio: number | null // observations_before / reflections — null if no reflections
    tailMsgs: number // messages after last_observed_at boundary
    totalMsgs: number // total messages in session
    tailRatio: number // tailMsgs / totalMsgs (lower = better OM coverage)
  }

  // Layer token breakdown — how the prompt budget is spent
  layers: Layer[]

  // BP alignment
  alignment?: CacheAlignment

  // Memory reuse signals
  recallReused: boolean

  // Observations arrived in the cacheable slot (BP3)
  obsInCacheSlot: boolean // layers["observations_stable"].tokens > 0
  obsSlotTokens: number
}

// ─── Conversation ─────────────────────────────────────────────────────────────
// Multi-turn sequence that mimics a real coding session — accumulates context
// progressively so OM has something meaningful to observe and reflect on.

const TURNS = [
  "What is the difference between a process and a thread in operating systems?",
  "How does the OS scheduler decide which thread to run next? Explain the main scheduling algorithms.",
  "Given what you explained about scheduling, how would you design a work-stealing thread pool in TypeScript?",
  "Show me a minimal implementation of that thread pool using SharedArrayBuffer and Atomics.",
  "What are the trade-offs between that approach vs using worker_threads with message passing?",
  "Summarize everything we discussed today about concurrency in a structured format I can save as notes.",
  "Now compare the concurrency model of Go goroutines vs the TypeScript worker model we discussed.",
  "If I wanted to port the thread pool implementation to Rust using tokio, what would change?",
]

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function post<T>(p: string, body: unknown): Promise<T> {
  const r = await fetch(`${args.url}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`POST ${p} → ${r.status}: ${await r.text()}`)
  return r.json() as Promise<T>
}

async function get<T>(p: string): Promise<T | null> {
  const r = await fetch(`${args.url}${p}`)
  if (r.status === 404) return null
  if (!r.ok) return null
  return r.json() as Promise<T>
}

async function createSession(): Promise<string> {
  const d = await post<{ id: string }>("/session", { directory: args.dir })
  return d.id
}

async function sendMessage(sessionID: string, text: string): Promise<void> {
  const [provider, ...rest] = args.model.split("/")
  await post(`/session/${sessionID}/message`, {
    parts: [{ type: "text", text }],
    model: { providerID: provider, modelID: rest.join("/") },
  })
}

async function getProfile(sid: string): Promise<Profile | null> {
  return get<Profile>(`/experimental/session/${sid}/prompt-profile?sessionID=${sid}`)
}

async function getMemory(sid: string): Promise<Memory | null> {
  return get<Memory>(`/session/${sid}/memory`)
}

async function getMessages(sid: string): Promise<Message[]> {
  const r = await get<Message[]>(`/session/${sid}/messages`)
  return r ?? []
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

function cacheHitRate(p: Profile): number {
  const total = p.cache.read + p.cache.write + p.cache.input
  return total === 0 ? 0 : p.cache.read / total
}

function tailMsgCount(msgs: Message[], lastObservedAt: number | null): number {
  if (!lastObservedAt) return msgs.length
  return msgs.filter((m) => (m.info.time?.created ?? 0) > lastObservedAt).length
}

function obsSlotTokens(profile: Profile): number {
  return profile.layers.find((l) => l.key === "observations_stable")?.tokens ?? 0
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function pct(n: number, decimals = 1): string {
  return `${(n * 100).toFixed(decimals)}%`
}
function pad(s: string | number, w: number, right = false): string {
  const str = String(s)
  return right ? str.padStart(w) : str.padEnd(w)
}
function num(n: number): string {
  return n.toLocaleString()
}
function yn(b: boolean): string {
  return b ? "✓" : "·"
}

// ─── Compare mode ─────────────────────────────────────────────────────────────

type BenchResult = {
  label: string
  model: string
  turns: TurnResult[]
  summary: {
    avgCacheHitRate: number
    avgTailRatio: number
    totalCacheRead: number
    totalCacheWrite: number
    totalCacheInput: number
    omFiredAtTurn: number | null // first turn Observer fired
    reflectorFired: boolean
    finalObsTokens: number
  }
}

function printCompare(files: string[]) {
  const runs: BenchResult[] = files.map((f) => {
    const fs = require("fs")
    return JSON.parse(fs.readFileSync(f, "utf8"))
  })

  console.log("\n╔══════════════════════════════════════════════════════════════════╗")
  console.log("║         Cache Hit + OM Effectiveness — Comparison               ║")
  console.log("╚══════════════════════════════════════════════════════════════════╝\n")

  for (const r of runs) {
    const s = r.summary
    console.log(`  ┌─ ${r.label} (${r.model})`)
    console.log(`  │  provider cache hit   : ${pct(s.avgCacheHitRate)}`)
    console.log(`  │  avg tail ratio       : ${pct(s.avgTailRatio)}   (lower = OM covering more)`)
    console.log(`  │  Observer fired at    : turn ${s.omFiredAtTurn ?? "never"}`)
    console.log(`  │  Reflector ran        : ${s.reflectorFired ? "yes" : "no"}`)
    console.log(`  │  final obs tokens     : ${num(s.finalObsTokens)}`)
    console.log(`  │  total cache reads    : ${num(s.totalCacheRead)} tokens`)
    console.log(`  └─────────────────────────────────────────────\n`)
  }

  if (runs.length === 2) {
    const [a, b] = runs as [BenchResult, BenchResult]
    const dCache = b.summary.avgCacheHitRate - a.summary.avgCacheHitRate
    const dTail = b.summary.avgTailRatio - a.summary.avgTailRatio
    const sign = (n: number) => (n >= 0 ? "+" : "")
    console.log(`  Delta (${b.label} vs ${a.label}):`)
    console.log(`    cache hit rate : ${sign(dCache)}${pct(dCache)}`)
    console.log(`    tail ratio     : ${sign(dTail)}${pct(dTail)}  (negative = ${b.label} sends fewer raw msgs)`)
    console.log(
      `    cache reads    : ${sign(b.summary.totalCacheRead - a.summary.totalCacheRead)}${num(b.summary.totalCacheRead - a.summary.totalCacheRead)} tokens\n`,
    )
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (args.compare.length > 0) {
    printCompare(args.compare)
    return
  }

  const health = await fetch(`${args.url}/health`).catch(() => null)
  if (!health?.ok) {
    console.error(`✗ Server not reachable at ${args.url}`)
    console.error(`  Start the server and retry, or pass --url`)
    process.exit(1)
  }

  if (!args.json) {
    console.log("\n╔══════════════════════════════════════════════════════════════════╗")
    console.log("║         Cache Hit + OM Effectiveness Benchmark                   ║")
    console.log("╚══════════════════════════════════════════════════════════════════╝")
    console.log(`  label  : ${args.label}`)
    console.log(`  server : ${args.url}`)
    console.log(`  model  : ${args.model}`)
    console.log(`  turns  : ${Math.min(args.turns, TURNS.length)}`)
    console.log()
    // Header
    console.log(
      `  ${"turn".padEnd(5)} ${"cache%".padEnd(7)} ${"c.read".padEnd(9)} ${"obs_tok".padEnd(9)} ${"tail".padEnd(6)} ${"obs@BP3".padEnd(8)} ${"gen".padEnd(4)} ${"refl".padEnd(4)} ${"recall".padEnd(7)} ${"ms".padEnd(6)}`,
    )
    console.log(`  ${"─".repeat(72)}`)
  }

  const sid = await createSession()
  if (!args.json) console.log(`  session: ${sid}\n`)

  const results: TurnResult[] = []
  const count = Math.min(args.turns, TURNS.length)

  // Track observation tokens before Reflector runs for compression ratio
  let prevObsTokens = 0

  for (let i = 0; i < count; i++) {
    const prompt = TURNS[i]!
    const t0 = Date.now()

    await sendMessage(sid, prompt)
    const durationMs = Date.now() - t0

    // Fetch all three data sources in parallel
    const [profile, memory, msgs] = await Promise.all([getProfile(sid), getMemory(sid), getMessages(sid)])

    const totalMsgs = msgs.length
    const tailMsgs = tailMsgCount(msgs, memory?.last_observed_at ?? null)

    const obsTokens = memory?.observation_tokens ?? 0
    const genCount = memory?.generation_count ?? 0
    const reflected = (memory?.reflections ?? null) !== null

    // Compression ratio: only meaningful right after Reflector runs
    // We detect it when reflections appear and prevObsTokens was meaningful
    let compressionRatio: number | null = null
    if (reflected && prevObsTokens > 0 && obsTokens < prevObsTokens) {
      compressionRatio = prevObsTokens / obsTokens
    }
    prevObsTokens = obsTokens

    const obsSlot = profile ? obsSlotTokens(profile) : 0
    const hitRate = profile ? cacheHitRate(profile) : 0
    const cacheTokens = profile
      ? { read: profile.cache.read, write: profile.cache.write, input: profile.cache.input }
      : { read: 0, write: 0, input: 0 }

    const result: TurnResult = {
      turn: i + 1,
      prompt,
      durationMs,
      cacheHitRate: hitRate,
      cacheTokens,
      om: {
        fired: genCount > 0,
        generationCount: genCount,
        observationTokens: obsTokens,
        reflected,
        compressionRatio,
        tailMsgs,
        totalMsgs,
        tailRatio: totalMsgs === 0 ? 1 : tailMsgs / totalMsgs,
      },
      layers: profile?.layers ?? [],
      alignment: profile?.alignment,
      recallReused: profile?.recallReused ?? false,
      obsInCacheSlot: obsSlot > 0,
      obsSlotTokens: obsSlot,
    }
    results.push(result)

    if (!args.json) {
      const tailRatio = result.om.totalMsgs > 0 ? `${result.om.tailMsgs}/${result.om.totalMsgs}` : "─/─"
      console.log(
        `  ${pad(i + 1, 5)}` +
          ` ${pad(pct(hitRate, 1), 7)}` +
          ` ${pad(num(cacheTokens.read), 9)}` +
          ` ${pad(num(obsTokens), 9)}` +
          ` ${pad(tailRatio, 6)}` +
          ` ${pad(obsSlot > 0 ? num(obsSlot) : "─", 8)}` +
          ` ${pad(genCount, 4)}` +
          ` ${pad(yn(reflected), 4)}` +
          ` ${pad(yn(result.recallReused), 7)}` +
          ` ${durationMs}ms`,
      )
    }
  }

  // Summary
  const avgCacheHitRate = results.reduce((s, r) => s + r.cacheHitRate, 0) / results.length
  const avgTailRatio = results.reduce((s, r) => s + r.om.tailRatio, 0) / results.length
  const totalCacheRead = results.reduce((s, r) => s + r.cacheTokens.read, 0)
  const totalCacheWrite = results.reduce((s, r) => s + r.cacheTokens.write, 0)
  const totalCacheInput = results.reduce((s, r) => s + r.cacheTokens.input, 0)
  const omFiredAtTurn = results.find((r) => r.om.fired)?.turn ?? null
  const reflectorFired = results.some((r) => r.om.reflected)
  const finalObsTokens = results.at(-1)?.om.observationTokens ?? 0

  const summary = {
    avgCacheHitRate,
    avgTailRatio,
    totalCacheRead,
    totalCacheWrite,
    totalCacheInput,
    omFiredAtTurn,
    reflectorFired,
    finalObsTokens,
  }

  const out: BenchResult = { label: args.label, model: args.model, turns: results, summary }

  if (args.json) {
    console.log(JSON.stringify(out, null, 2))
    return
  }

  // ── Summary table ─────────────────────────────────────────────────────────
  const last = results.at(-1)!
  console.log(`\n  ── Provider cache ───────────────────────────────────────────────`)
  console.log(`  avg hit rate   : ${pct(avgCacheHitRate)}`)
  console.log(`  total read     : ${num(totalCacheRead)} tokens  (served from cache, billed at 10% cost)`)
  console.log(`  total write    : ${num(totalCacheWrite)} tokens  (written to cache this session)`)
  console.log(`  total input    : ${num(totalCacheInput)} tokens  (non-cached, billed full)`)

  console.log(`\n  ── OM effectiveness ─────────────────────────────────────────────`)
  console.log(`  Observer fired : ${omFiredAtTurn ? `turn ${omFiredAtTurn}` : "never  ← OM did not activate"}`)
  console.log(`  generations    : ${last.om.generationCount}  (total Observer invocations)`)
  console.log(`  obs tokens     : ${num(finalObsTokens)}  (current observation size)`)
  console.log(
    `  obs in BP3     : ${last.obsInCacheSlot ? `yes (${num(last.obsSlotTokens)} tokens)` : "no  ← observations not reaching cache slot"}`,
  )
  console.log(`  Reflector ran  : ${reflectorFired ? "yes" : "no"}`)
  if (last.om.compressionRatio) {
    console.log(`  compression    : ${last.om.compressionRatio.toFixed(1)}x  (observations → reflections)`)
  }
  console.log(
    `  avg tail ratio : ${pct(avgTailRatio)}  (${avgTailRatio < 0.5 ? "good — OM covering majority of context" : "high — OM not yet reducing tail"})`,
  )
  console.log(`  recall reused  : ${results.filter((r) => r.recallReused).length}/${results.length} turns`)

  // ── Layer breakdown ───────────────────────────────────────────────────────
  if (last.layers.length > 0) {
    console.log(`\n  ── Last turn prompt budget ──────────────────────────────────────`)
    const totalLayerTokens = last.layers.reduce((s, l) => s + l.tokens, 0)
    for (const l of last.layers) {
      const share = totalLayerTokens > 0 ? l.tokens / totalLayerTokens : 0
      const bar = "█".repeat(Math.round(share * 20))
      console.log(`  ${pad(l.key, 22)} ${pad(num(l.tokens), 8)} ${pad(pct(share, 0), 5)} ${bar}`)
    }
    console.log(`  ${"─".repeat(40)}`)
    console.log(`  ${"total".padEnd(22)} ${pad(num(totalLayerTokens), 8)}`)
  }

  // ── BP alignment ──────────────────────────────────────────────────────────
  if (last.alignment) {
    const a = last.alignment
    console.log(`\n  ── Cache breakpoints (last turn) ────────────────────────────────`)
    console.log(`  ${a.total}/${a.limit} slots used ${a.ok ? "✓" : "✗ OVER LIMIT — extras silently ignored"}`)
    if (a.systemBP.length) console.log(`  system BPs    : positions [${a.systemBP.join(", ")}]`)
    if (a.messageBP.length) console.log(`  message BPs   : ${a.messageBP.map((m) => `${m.role}[${m.i}]`).join(", ")}`)
    if (a.toolBP.length) console.log(`  tool BPs      : ${a.toolBP.join(", ")}`)
  }

  console.log()
}

main().catch((err) => {
  console.error("benchmark failed:", err instanceof Error ? err.message : String(err))
  process.exit(1)
})
