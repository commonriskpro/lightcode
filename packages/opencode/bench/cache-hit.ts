#!/usr/bin/env bun
/**
 * cache-hit benchmark
 *
 * Measures prompt cache effectiveness across a multi-turn session.
 * Works against any LightCode-compatible server (lightcodev2 or upstream opencode)
 * by talking pure HTTP — no internal imports.
 *
 * USAGE
 *   bun bench/cache-hit.ts [options]
 *
 * OPTIONS
 *   --url      Server base URL           (default: http://localhost:4096)
 *   --model    provider/model slug       (default: anthropic/claude-sonnet-4-5)
 *   --turns    Number of conversation turns to run (default: 6)
 *   --dir      Project directory for the session (default: cwd)
 *   --label    Label for this run (e.g. "lightcodev2" or "opencode")
 *   --json     Output raw JSON instead of table
 *   --compare  Path to a previous JSON output to diff against
 *
 * EXAMPLES
 *   # Basic run against default server
 *   bun bench/cache-hit.ts --label lightcodev2
 *
 *   # Compare two servers
 *   bun bench/cache-hit.ts --url http://localhost:4096 --label lightcodev2 --json > /tmp/lc.json
 *   bun bench/cache-hit.ts --url http://localhost:4097 --label opencode    --json > /tmp/oc.json
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
    model: get("--model", process.env.BENCH_MODEL ?? "anthropic/claude-sonnet-4-5"),
    turns: Number(get("--turns", "6")),
    dir: get("--dir", process.cwd()),
    label: get("--label", "unknown"),
    json: a.includes("--json"),
    compare: getAll("--compare"),
  }
})()

// ─── Types (mirrors PromptProfileEntry from prompt-profile.ts) ───────────────

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

// ─── Turn result ──────────────────────────────────────────────────────────────

type TurnResult = {
  turn: number
  prompt: string
  durationMs: number
  profile: Profile | null
  /** cache_read / (cache_read + cache_write + input) — 0 if first turn */
  hitRate: number
  tokens: { read: number; write: number; input: number }
}

// ─── Conversation prompts ─────────────────────────────────────────────────────
// Multi-turn sequence that mimics a realistic coding session.
// Each turn builds on the previous — this is what drives cache hits on BP3/BP4.

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

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${args.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}: ${await r.text()}`)
  return r.json() as Promise<T>
}

async function get<T>(path: string): Promise<T | null> {
  const r = await fetch(`${args.url}${path}`)
  if (!r.ok) return null
  return r.json() as Promise<T>
}

async function createSession(): Promise<string> {
  const data = await post<{ id: string }>("/session", { directory: args.dir })
  return data.id
}

async function sendMessage(sessionID: string, text: string): Promise<void> {
  const [provider, ...rest] = args.model.split("/")
  const model = rest.join("/")
  await post(`/session/${sessionID}/message`, {
    parts: [{ type: "text", text }],
    model: { providerID: provider, modelID: model },
  })
}

async function getProfile(sessionID: string): Promise<Profile | null> {
  return get<Profile>(`/experimental/session/${sessionID}/prompt-profile?sessionID=${sessionID}`)
}

// ─── Cache math ───────────────────────────────────────────────────────────────

function hitRate(p: Profile): number {
  const total = p.cache.read + p.cache.write + p.cache.input
  return total === 0 ? 0 : p.cache.read / total
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function pad(s: string | number, w: number, right = false): string {
  const str = String(s)
  return right ? str.padStart(w) : str.padEnd(w)
}

// ─── Compare mode ─────────────────────────────────────────────────────────────

type BenchResult = {
  label: string
  model: string
  turns: TurnResult[]
  summary: { avgHitRate: number; totalRead: number; totalWrite: number; totalInput: number }
}

function compare(files: string[]) {
  const runs: BenchResult[] = files.map((f) => JSON.parse(require("fs").readFileSync(f, "utf8")))

  console.log("\n╔══════════════════════════════════════════════════════════╗")
  console.log("║           Cache Hit Benchmark — Comparison               ║")
  console.log("╚══════════════════════════════════════════════════════════╝\n")

  for (const r of runs) {
    console.log(`  ${r.label} (${r.model})`)
    console.log(`  ${"─".repeat(50)}`)
    console.log(`  avg hit rate : ${pct(r.summary.avgHitRate)}`)
    console.log(`  total read   : ${r.summary.totalRead.toLocaleString()} tokens`)
    console.log(`  total write  : ${r.summary.totalWrite.toLocaleString()} tokens`)
    console.log(`  total input  : ${r.summary.totalInput.toLocaleString()} tokens (non-cached)`)
    console.log()
  }

  if (runs.length === 2) {
    const [a, b] = runs as [BenchResult, BenchResult]
    const delta = b.summary.avgHitRate - a.summary.avgHitRate
    const sign = delta >= 0 ? "+" : ""
    console.log(`  Delta (${b.label} vs ${a.label}): ${sign}${pct(delta)} hit rate`)
    const readDelta = b.summary.totalRead - a.summary.totalRead
    const sign2 = readDelta >= 0 ? "+" : ""
    console.log(`  Cache reads  : ${sign2}${readDelta.toLocaleString()} tokens\n`)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (args.compare.length > 0) {
    compare(args.compare)
    return
  }

  // Verify server is reachable
  const health = await fetch(`${args.url}/health`).catch(() => null)
  if (!health?.ok) {
    console.error(`✗ Server not reachable at ${args.url}`)
    console.error(`  Start lightcode/opencode server and retry, or pass --url`)
    process.exit(1)
  }

  if (!args.json) {
    console.log("\n╔══════════════════════════════════════════════════════════╗")
    console.log("║              Cache Hit Benchmark                         ║")
    console.log("╚══════════════════════════════════════════════════════════╝")
    console.log(`  label  : ${args.label}`)
    console.log(`  server : ${args.url}`)
    console.log(`  model  : ${args.model}`)
    console.log(`  turns  : ${Math.min(args.turns, TURNS.length)}`)
    console.log(`  dir    : ${args.dir}\n`)
  }

  const sessionID = await createSession()
  if (!args.json) console.log(`  session: ${sessionID}\n`)

  const results: TurnResult[] = []
  const count = Math.min(args.turns, TURNS.length)

  for (let i = 0; i < count; i++) {
    const prompt = TURNS[i]!
    const t0 = Date.now()

    if (!args.json) process.stdout.write(`  turn ${i + 1}/${count} sending...`)

    await sendMessage(sessionID, prompt)

    const durationMs = Date.now() - t0
    const profile = await getProfile(sessionID)
    const rate = profile ? hitRate(profile) : 0
    const tokens = profile
      ? { read: profile.cache.read, write: profile.cache.write, input: profile.cache.input }
      : { read: 0, write: 0, input: 0 }

    results.push({ turn: i + 1, prompt, durationMs, profile, hitRate: rate, tokens })

    if (!args.json) {
      process.stdout.clearLine?.(0)
      process.stdout.cursorTo?.(0)
      const bp = profile?.alignment ? `BP:${profile.alignment.total}/${profile.alignment.limit}` : "     "
      const layers = profile?.layers.map((l) => `${l.key.slice(0, 14)}=${l.tokens}`).join(" ") ?? ""
      console.log(
        `  turn ${pad(i + 1, 2)} │ hit ${pad(pct(rate), 6)} │ read ${pad(tokens.read.toLocaleString(), 8)} │ write ${pad(tokens.write.toLocaleString(), 7)} │ ${bp} │ ${durationMs}ms`,
      )
    }
  }

  // Summary
  const avgHitRate = results.reduce((s, r) => s + r.hitRate, 0) / results.length
  const totalRead = results.reduce((s, r) => s + r.tokens.read, 0)
  const totalWrite = results.reduce((s, r) => s + r.tokens.write, 0)
  const totalInput = results.reduce((s, r) => s + r.tokens.input, 0)

  const summary = { avgHitRate, totalRead, totalWrite, totalInput }
  const out: BenchResult = { label: args.label, model: args.model, turns: results, summary }

  if (args.json) {
    console.log(JSON.stringify(out, null, 2))
    return
  }

  console.log(`\n  ${"─".repeat(60)}`)
  console.log(`  avg hit rate : ${pct(avgHitRate)}`)
  console.log(`  total read   : ${totalRead.toLocaleString()} tokens  (saved from cache)`)
  console.log(`  total write  : ${totalWrite.toLocaleString()} tokens  (written to cache)`)
  console.log(`  total input  : ${totalInput.toLocaleString()} tokens  (non-cached, billed full)`)

  // Per-layer breakdown from last turn (most representative)
  const last = results.at(-1)?.profile
  if (last?.layers?.length) {
    console.log(`\n  Last turn layer breakdown:`)
    for (const l of last.layers) {
      console.log(`    ${pad(l.key, 22)} ${pad(l.tokens.toLocaleString(), 8)} tokens`)
    }
  }

  // Alignment audit from last turn
  if (last?.alignment) {
    const a = last.alignment
    const ok = a.ok ? "✓" : "✗ OVER LIMIT"
    console.log(`\n  Cache alignment: ${a.total}/${a.limit} breakpoints ${ok}`)
    if (a.systemBP.length) console.log(`    system BPs at positions: [${a.systemBP.join(", ")}]`)
    if (a.messageBP.length) console.log(`    message BPs: ${a.messageBP.map((m) => `${m.role}[${m.i}]`).join(", ")}`)
    if (a.toolBP.length) console.log(`    tool BPs: ${a.toolBP.join(", ")}`)
  }

  console.log()
}

main().catch((err) => {
  console.error("benchmark failed:", err instanceof Error ? err.message : String(err))
  process.exit(1)
})
