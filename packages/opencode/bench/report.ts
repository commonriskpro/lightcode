#!/usr/bin/env bun
/**
 * om-report — post-session OM effectiveness report
 *
 * Reads the lightcode SQLite DB directly and produces a report for one or
 * more sessions. No server needed, no prompts sent — pure analysis of what
 * already happened.
 *
 * USAGE
 *   bun bench/report.ts [options]
 *
 * OPTIONS
 *   --db       Path to lightcode.db  (default: ~/.local/share/lightcode/lightcode.db)
 *   --session  Session ID to analyse (repeatable; default: last N sessions)
 *   --last     Analyse last N sessions from the current directory (default: 1)
 *   --dir      Filter sessions by project directory (default: cwd)
 *   --all      Include all directories, not just cwd
 *   --json     Output raw JSON instead of table
 *   --compare  Path to a previous JSON output to diff against (repeatable)
 *
 * EXAMPLES
 *   # Report on last session in current project
 *   bun bench/report.ts
 *
 *   # Last 5 sessions
 *   bun bench/report.ts --last 5
 *
 *   # Specific session
 *   bun bench/report.ts --session ses_29a570095ffelfAZ1bqNfP1q55
 *
 *   # Export and compare two runs (e.g. before/after a change)
 *   bun bench/report.ts --json > /tmp/before.json
 *   # ... make changes, start new session ...
 *   bun bench/report.ts --json > /tmp/after.json
 *   bun bench/report.ts --compare /tmp/before.json --compare /tmp/after.json
 */

import { Database } from "bun:sqlite"
import os from "os"
import path from "path"

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = (() => {
  const a = process.argv.slice(2)
  const get = (flag: string, fallback: string) => {
    const i = a.indexOf(flag)
    return i !== -1 && a[i + 1] ? a[i + 1]! : fallback
  }
  const getAll = (flag: string) => {
    const out: string[] = []
    for (let i = 0; i < a.length; i++) if (a[i] === flag && a[i + 1]) out.push(a[i + 1]!)
    return out
  }
  const defaultDb = path.join(
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
    "lightcode",
    "lightcode.db",
  )
  return {
    db: get("--db", process.env.LIGHTCODE_DB ?? defaultDb),
    sessions: getAll("--session"),
    last: Number(get("--last", "1")),
    dir: get("--dir", process.cwd()),
    all: a.includes("--all"),
    json: a.includes("--json"),
    compare: getAll("--compare"),
  }
})()

// ─── Types ────────────────────────────────────────────────────────────────────

type MsgRow = {
  id: string
  time_created: number
  cache_read: number
  cache_write: number
  input: number
  output: number
  cost: number
  model: string | null
}

type SessionData = {
  id: string
  title: string
  directory: string
  time_created: number
  // OM state
  obs_tokens: number
  gen_count: number
  has_observations: boolean
  has_reflections: boolean
  last_observed_at: number | null
  // Buffer chunks
  buffer_chunks: number
  buffer_msg_tokens: number
  // Messages
  total_msgs: number
  assistant_msgs: number
  tail_msgs: number // messages after last_observed_at
  // Per-message cache data
  turns: MsgRow[]
}

type Report = {
  session: SessionData
  // Aggregate cache metrics
  cache: {
    total_read: number
    total_write: number
    total_input: number
    total_output: number
    total_cost: number
    avg_hit_rate: number // avg(read / (read+write+input)) per assistant turn
    first_hit_turn: number // first turn where cache.read > 0
  }
  // OM metrics
  om: {
    observer_fired: boolean
    observer_gen_count: number
    obs_tokens: number
    reflector_fired: boolean
    tail_ratio: number // tail_msgs / total_msgs — lower = better OM coverage
    buffer_chunks: number
  }
}

// ─── DB queries ───────────────────────────────────────────────────────────────

function openDb(): Database {
  if (!Bun.file(args.db).size) {
    console.error(`✗ DB not found: ${args.db}`)
    console.error(`  Use --db to specify a path, or check your XDG_DATA_HOME`)
    process.exit(1)
  }
  return new Database(args.db, { readonly: true })
}

function querySessions(db: Database, ids?: string[]): string[] {
  if (ids?.length) return ids

  const where = args.all ? "" : `AND s.directory = ?`
  const rows = db
    .query<{ id: string }, string[]>(
      `SELECT s.id FROM session s
       WHERE s.time_archived IS NULL ${where}
       ORDER BY s.time_created DESC
       LIMIT ?`,
    )
    .all(...(args.all ? [String(args.last)] : [args.dir, String(args.last)]))

  return rows.map((r) => r.id)
}

function loadSession(db: Database, sid: string): SessionData | null {
  // Session info
  const sess = db
    .query<
      { id: string; title: string; directory: string; time_created: number },
      string
    >(`SELECT id, title, directory, time_created FROM session WHERE id = ?`)
    .get(sid)
  if (!sess) return null

  // OM record
  const om = db
    .query<
      {
        obs_tokens: number
        gen_count: number
        has_obs: number
        has_refl: number
        last_observed_at: number | null
      },
      string
    >(
      `SELECT
         observation_tokens as obs_tokens,
         generation_count   as gen_count,
         observations IS NOT NULL as has_obs,
         reflections  IS NOT NULL as has_refl,
         last_observed_at
       FROM session_observation WHERE session_id = ?`,
    )
    .get(sid)

  // Buffer chunks
  const buf = db
    .query<{ count: number; msg_tokens: number }, string>(
      `SELECT COUNT(*) as count, COALESCE(SUM(message_tokens),0) as msg_tokens
       FROM session_observation_buffer WHERE session_id = ?`,
    )
    .get(sid)

  // Per-assistant-message cache tokens (aggregated from step-finish parts)
  const turns = db
    .query<MsgRow, string>(
      `SELECT
         m.id,
         m.time_created,
         COALESCE(SUM(CASE WHEN json_extract(p.data,'$.type')='step-finish'
                     THEN CAST(json_extract(p.data,'$.tokens.cache.read')  AS INTEGER) ELSE 0 END), 0) AS cache_read,
         COALESCE(SUM(CASE WHEN json_extract(p.data,'$.type')='step-finish'
                     THEN CAST(json_extract(p.data,'$.tokens.cache.write') AS INTEGER) ELSE 0 END), 0) AS cache_write,
         COALESCE(SUM(CASE WHEN json_extract(p.data,'$.type')='step-finish'
                     THEN CAST(json_extract(p.data,'$.tokens.input')       AS INTEGER) ELSE 0 END), 0) AS input,
         COALESCE(SUM(CASE WHEN json_extract(p.data,'$.type')='step-finish'
                     THEN CAST(json_extract(p.data,'$.tokens.output')      AS INTEGER) ELSE 0 END), 0) AS output,
         COALESCE(SUM(CASE WHEN json_extract(p.data,'$.type')='step-finish'
                     THEN CAST(json_extract(p.data,'$.cost')               AS REAL)    ELSE 0 END), 0) AS cost,
         COALESCE(
           json_extract(m.data,'$.metadata.assistant.modelID'),
           (SELECT json_extract(p2.data,'$.model')
            FROM part p2
            WHERE p2.message_id = m.id
              AND json_extract(p2.data,'$.model') IS NOT NULL
            LIMIT 1)
         ) AS model
       FROM message m
       JOIN part p ON p.message_id = m.id
       WHERE m.session_id = ?
         AND json_extract(m.data,'$.role') = 'assistant'
         AND json_extract(m.data,'$.metadata.assistant.summary') IS NOT 1
       GROUP BY m.id
       ORDER BY m.time_created`,
    )
    .all(sid)

  // Total messages and tail count
  const allMsgs = db
    .query<{ count: number }, string>(
      `SELECT COUNT(*) as count FROM message
       WHERE session_id = ? AND json_extract(data,'$.role') IN ('user','assistant')`,
    )
    .get(sid)

  const lastObservedAt = om?.last_observed_at ?? null
  const tailMsgs = lastObservedAt
    ? (db
        .query<{ count: number }, [string, number]>(
          `SELECT COUNT(*) as count FROM message
           WHERE session_id = ? AND time_created > ?
             AND json_extract(data,'$.role') IN ('user','assistant')`,
        )
        .get(sid, lastObservedAt)?.count ?? 0)
    : (allMsgs?.count ?? 0)

  return {
    id: sess.id,
    title: sess.title,
    directory: sess.directory,
    time_created: sess.time_created,
    obs_tokens: om?.obs_tokens ?? 0,
    gen_count: om?.gen_count ?? 0,
    has_observations: Boolean(om?.has_obs),
    has_reflections: Boolean(om?.has_refl),
    last_observed_at: lastObservedAt,
    buffer_chunks: buf?.count ?? 0,
    buffer_msg_tokens: buf?.msg_tokens ?? 0,
    total_msgs: allMsgs?.count ?? 0,
    assistant_msgs: turns.length,
    tail_msgs: tailMsgs,
    turns,
  }
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

function hitRate(r: MsgRow): number {
  const total = r.cache_read + r.cache_write + r.input
  return total === 0 ? 0 : r.cache_read / total
}

function buildReport(s: SessionData): Report {
  const totalRead = s.turns.reduce((a, r) => a + r.cache_read, 0)
  const totalWrite = s.turns.reduce((a, r) => a + r.cache_write, 0)
  const totalInput = s.turns.reduce((a, r) => a + r.input, 0)
  const totalOutput = s.turns.reduce((a, r) => a + r.output, 0)
  const totalCost = s.turns.reduce((a, r) => a + r.cost, 0)
  const avgHit = s.turns.length === 0 ? 0 : s.turns.reduce((a, r) => a + hitRate(r), 0) / s.turns.length
  const firstHit = s.turns.findIndex((r) => r.cache_read > 0) + 1 // 1-indexed, 0 = never

  return {
    session: s,
    cache: {
      total_read: totalRead,
      total_write: totalWrite,
      total_input: totalInput,
      total_output: totalOutput,
      total_cost: totalCost,
      avg_hit_rate: avgHit,
      first_hit_turn: firstHit,
    },
    om: {
      observer_fired: s.gen_count > 0,
      observer_gen_count: s.gen_count,
      obs_tokens: s.obs_tokens,
      reflector_fired: s.has_reflections,
      tail_ratio: s.total_msgs === 0 ? 1 : s.tail_msgs / s.total_msgs,
      buffer_chunks: s.buffer_chunks,
    },
  }
}

// ─── Format ───────────────────────────────────────────────────────────────────

function pct(n: number, d = 1) {
  return `${(n * 100).toFixed(d)}%`
}
function num(n: number) {
  return n.toLocaleString()
}
function pad(s: string | number, w: number, r = false) {
  const str = String(s)
  return r ? str.padStart(w) : str.padEnd(w)
}
function usd(n: number) {
  return `$${n.toFixed(4)}`
}
function date(ts: number) {
  return new Date(ts).toISOString().slice(0, 19).replace("T", " ")
}
function bar(ratio: number, width = 20) {
  const filled = Math.round(ratio * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

function printReport(r: Report) {
  const s = r.session
  const msgs = s.turns

  console.log(`\n  ╔${"═".repeat(68)}╗`)
  console.log(`  ║  ${pad(s.title.slice(0, 60), 66)}║`)
  console.log(`  ║  ${pad(s.id, 66)}║`)
  console.log(`  ║  ${pad(date(s.time_created) + "  " + s.directory.slice(-40), 66)}║`)
  console.log(`  ╚${"═".repeat(68)}╝`)

  // Per-turn table
  console.log(
    `\n  ${"turn".padEnd(5)} ${"model".padEnd(22)} ${"cache%".padEnd(7)} ${"c.read".padEnd(9)} ${"c.write".padEnd(9)} ${"input".padEnd(8)} ${"output".padEnd(7)} ${"cost".padEnd(8)}`,
  )
  console.log(`  ${"─".repeat(76)}`)

  msgs.forEach((m, i) => {
    const rate = hitRate(m)
    const model = (m.model ?? "unknown").slice(0, 21)
    console.log(
      `  ${pad(i + 1, 5)}` +
        ` ${pad(model, 22)}` +
        ` ${pad(pct(rate), 7)}` +
        ` ${pad(num(m.cache_read), 9)}` +
        ` ${pad(num(m.cache_write), 9)}` +
        ` ${pad(num(m.input), 8)}` +
        ` ${pad(num(m.output), 7)}` +
        ` ${usd(m.cost)}`,
    )
  })

  // Cache summary
  console.log(`\n  ── Provider cache ──────────────────────────────────────────────────`)
  console.log(`  avg hit rate   : ${pct(r.cache.avg_hit_rate)}`)
  console.log(`  first hit turn : ${r.cache.first_hit_turn || "never"}`)
  console.log(`  total read     : ${num(r.cache.total_read)} tokens  (served from cache)`)
  console.log(`  total write    : ${num(r.cache.total_write)} tokens  (written to cache)`)
  console.log(`  total input    : ${num(r.cache.total_input)} tokens  (non-cached, billed full)`)
  console.log(`  total output   : ${num(r.cache.total_output)} tokens`)
  console.log(`  total cost     : ${usd(r.cache.total_cost)}`)

  // OM summary
  console.log(`\n  ── Observational Memory ────────────────────────────────────────────`)
  const omOk = r.om.observer_fired ? "✓" : "✗ did not fire"
  console.log(
    `  Observer       : ${omOk}  (${r.om.observer_gen_count} generation${r.om.observer_gen_count !== 1 ? "s" : ""})`,
  )
  console.log(`  obs tokens     : ${num(r.om.obs_tokens)}`)
  console.log(`  Reflector      : ${r.om.reflector_fired ? "✓ ran" : "✗ did not run"}`)
  console.log(`  buffer chunks  : ${r.om.buffer_chunks}  (pending, not yet activated)`)

  const tailLabel =
    r.om.tail_ratio < 0.4
      ? "good — OM covering most context"
      : r.om.tail_ratio < 0.7
        ? "moderate"
        : "high — OM not reducing tail yet"
  console.log(`  tail ratio     : ${pct(r.om.tail_ratio)}  ${tailLabel}`)
  console.log(`  msgs in tail   : ${s.tail_msgs} / ${s.total_msgs}`)

  // Read vs write vs input visual
  const totalTokens = r.cache.total_read + r.cache.total_write + r.cache.total_input
  if (totalTokens > 0) {
    const readRatio = r.cache.total_read / totalTokens
    const writeRatio = r.cache.total_write / totalTokens
    const inputRatio = r.cache.total_input / totalTokens
    console.log(`\n  ── Token budget breakdown ──────────────────────────────────────────`)
    console.log(`  read  ${pad(pct(readRatio, 0), 5)} ${bar(readRatio)}  ${num(r.cache.total_read)}`)
    console.log(`  write ${pad(pct(writeRatio, 0), 5)} ${bar(writeRatio)}  ${num(r.cache.total_write)}`)
    console.log(`  input ${pad(pct(inputRatio, 0), 5)} ${bar(inputRatio)}  ${num(r.cache.total_input)}`)
  }

  console.log()
}

function printCompare(files: string[]) {
  const reports: Report[] = files.map((f) => {
    const raw = JSON.parse(require("fs").readFileSync(f, "utf8"))
    // Support both single report and array
    return Array.isArray(raw) ? raw[raw.length - 1] : raw
  })

  console.log(`\n  ── Comparison ──────────────────────────────────────────────────────\n`)

  const cols = ["label", "avg hit%", "obs fired", "reflector", "tail%", "read tok", "cost"]
  const widths = [24, 10, 10, 10, 8, 10, 10]
  console.log("  " + cols.map((c, i) => pad(c, widths[i]!)).join(" "))
  console.log("  " + "─".repeat(widths.reduce((a, b) => a + b + 1, 0)))

  for (const r of reports) {
    const label = r.session.title.slice(0, 23)
    console.log(
      "  " +
        [
          pad(label, widths[0]!),
          pad(pct(r.cache.avg_hit_rate), widths[1]!),
          pad(r.om.observer_fired ? "yes" : "no", widths[2]!),
          pad(r.om.reflector_fired ? "yes" : "no", widths[3]!),
          pad(pct(r.om.tail_ratio, 0), widths[4]!),
          pad(num(r.cache.total_read), widths[5]!),
          pad(usd(r.cache.total_cost), widths[6]!),
        ].join(" "),
    )
  }

  if (reports.length === 2) {
    const [a, b] = reports as [Report, Report]
    const dHit = b.cache.avg_hit_rate - a.cache.avg_hit_rate
    const dTail = b.om.tail_ratio - a.om.tail_ratio
    const dRead = b.cache.total_read - a.cache.total_read
    const dCost = b.cache.total_cost - a.cache.total_cost
    const sign = (n: number) => (n >= 0 ? "+" : "")
    console.log(`\n  Delta (${reports[1]?.session.id.slice(0, 12)} vs ${reports[0]?.session.id.slice(0, 12)}):`)
    console.log(`    cache hit rate : ${sign(dHit)}${pct(dHit)}`)
    console.log(`    tail ratio     : ${sign(dTail)}${pct(dTail)}`)
    console.log(`    cache reads    : ${sign(dRead)}${num(dRead)} tokens`)
    console.log(`    cost           : ${sign(dCost)}$${dCost.toFixed(4)}`)
  }
  console.log()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  if (args.compare.length > 0) {
    printCompare(args.compare)
    return
  }

  const db = openDb()
  const ids = querySessions(db, args.sessions.length ? args.sessions : undefined)

  if (ids.length === 0) {
    console.error("✗ No sessions found.")
    console.error(`  Try --all to include all directories, or --last N for more sessions.`)
    process.exit(1)
  }

  const reports: Report[] = []
  for (const id of ids) {
    const s = loadSession(db, id)
    if (!s) {
      console.warn(`  ⚠ Session ${id} not found in DB`)
      continue
    }
    reports.push(buildReport(s))
  }

  db.close()

  if (args.json) {
    console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2))
    return
  }

  for (const r of reports) printReport(r)
}

main()
