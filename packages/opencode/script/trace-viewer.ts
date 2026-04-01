#!/usr/bin/env bun
/**
 * Colored tail of opencode worker log. Pipe to parent stderr so TUI stdout stays clean.
 * Usage: bun script/trace-viewer.ts <logfile>
 */
import { open, stat } from "node:fs/promises"

const R = "\x1b[0m"
const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const GREEN = "\x1b[32m"
const CYAN = "\x1b[36m"
const GRAY = "\x1b[90m"
const MAGENTA = "\x1b[35m"

const wireAt = new Map<string, number>()
const httpAt = new Map<string, number>()
const usageAt = new Map<string, number>()
const alertedWire = new Set<string>()
const alertedHttp = new Set<string>()
const TTL = 60_000
const HANG_MS = 15_000

function serviceHue(service: string): string {
  let h = 0
  for (let i = 0; i < service.length; i++) h = (h * 31 + service.charCodeAt(i)) >>> 0
  const codes = ["\x1b[34m", "\x1b[35m", "\x1b[36m", "\x1b[32m", "\x1b[33m"]
  return codes[h % codes.length]!
}

function colorLine(line: string): string {
  const trimmed = line.trimEnd()
  let severity = ""
  let prefix = ""

  if (/^ERROR\b/.test(trimmed)) {
    severity = RED + BOLD
    prefix = "!! "
  } else if (/^WARN\b/.test(trimmed)) {
    severity = YELLOW + BOLD
    prefix = "!? "
  } else if (/^DEBUG\b/.test(trimmed)) {
    severity = GRAY + DIM
  } else if (/^INFO\b/.test(trimmed)) {
    severity = CYAN
  }

  const critical =
    /\b(stream error|prompt_async failed|exception|rejection|phase=error)\b/i.test(trimmed) ||
    /\bfailed\b/i.test(trimmed) && /\bmcp\b/i.test(trimmed)
  if (critical && !severity) {
    severity = RED + BOLD
    prefix = "!! "
  }

  const warnish =
    /\b(retry|repairing tool call|missing cached tools)\b/i.test(trimmed) && !/^ERROR\b/.test(trimmed)
  if (warnish && !severity) {
    severity = YELLOW
    prefix = "!? "
  }

  const milestone =
    /\bphase=(wire|http|usage)\b/.test(trimmed) ||
    /\btoken_breakdown\b/.test(trimmed) ||
    /\bdebug_request\b/.test(trimmed)
  if (milestone && !severity) {
    severity = GREEN
  }

  const m = trimmed.match(/\bservice=([^\s]+)/)
  if (severity) {
    return prefix + severity + line + R + "\n"
  }
  if (m && m[1]) {
    const svcColor = serviceHue(m[1])
    return line.split(/(service=\S+)/).map((p, i) => (i % 2 === 1 && p.startsWith("service=") ? svcColor + p + R : p)).join("") + (line.endsWith("\n") ? "" : "\n")
  }
  return line.endsWith("\n") ? line : line + "\n"
}

function sessionID(line: string) {
  const m = line.match(/\bsessionID=([^\s]+)/)
  return m?.[1]
}

function phase(line: string): "wire" | "http" | "usage" | undefined {
  const m = line.match(/\bphase=(wire|http|usage)\b/)
  const p = m?.[1]
  if (p === "wire" || p === "http" || p === "usage") return p
}

function prune(now: number) {
  for (const [k, v] of wireAt) if (now - v > TTL) wireAt.delete(k)
  for (const [k, v] of httpAt) if (now - v > TTL) httpAt.delete(k)
  for (const [k, v] of usageAt) if (now - v > TTL) usageAt.delete(k)
}

function pipelineAlerts(line: string): string[] {
  const now = Date.now()
  prune(now)
  const sid = sessionID(line)
  const p = phase(line)
  if (!sid || !p) return []
  if (p === "wire") {
    wireAt.set(sid, now)
    alertedWire.delete(sid)
    alertedHttp.delete(sid)
    return []
  }
  if (p === "http") {
    httpAt.set(sid, now)
    alertedHttp.delete(sid)
    return []
  }
  usageAt.set(sid, now)
  return []
}

function sweepAlerts(): string[] {
  const now = Date.now()
  prune(now)
  const out: string[] = []
  for (const [sid, t] of wireAt) {
    if (now - t < HANG_MS) continue
    const h = httpAt.get(sid)
    if (h && h >= t) continue
    if (alertedWire.has(sid)) continue
    alertedWire.add(sid)
    out.push(`${MAGENTA}${BOLD}!? pipeline_incomplete sessionID=${sid} phase=wire_without_http age_ms=${now - t}${R}\n`)
  }
  for (const [sid, t] of httpAt) {
    if (now - t < HANG_MS) continue
    const u = usageAt.get(sid)
    if (u && u >= t) continue
    if (alertedHttp.has(sid)) continue
    alertedHttp.add(sid)
    out.push(`${MAGENTA}${BOLD}!? pipeline_incomplete sessionID=${sid} phase=http_without_usage age_ms=${now - t}${R}\n`)
  }
  return out
}

async function waitForFile(p: string, maxMs: number) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    try {
      await stat(p)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  process.stderr.write(`${RED}trace-viewer: log not found: ${p}${R}\n`)
  process.exit(1)
}

async function main() {
  const logPath = process.argv[2]
  if (!logPath) {
    process.stderr.write("usage: bun script/trace-viewer.ts <logfile>\n")
    process.exit(2)
  }

  await waitForFile(logPath, 30_000)

  let pos = 0
  try {
    pos = (await stat(logPath)).size
  } catch {
    pos = 0
  }

  let carry = ""

  const tick = async () => {
    const h = await open(logPath, "r")
    try {
      const st = await h.stat()
      if (st.size < pos) pos = 0
      const n = st.size - pos
      if (n <= 0) return
      const buf = Buffer.alloc(n)
      await h.read(buf, 0, n, pos)
      pos = st.size
      carry += buf.toString("utf8")
      const lines = carry.split("\n")
      carry = lines.pop() ?? ""
      for (const line of lines) {
        for (const alert of pipelineAlerts(line + "\n")) process.stdout.write(alert)
        process.stdout.write(colorLine(line + "\n"))
      }
      for (const alert of sweepAlerts()) process.stdout.write(alert)
    } finally {
      await h.close()
    }
  }

  await tick()
  setInterval(() => {
    tick().catch(() => {})
  }, 200)
}

main().catch((e) => {
  process.stderr.write(String(e) + "\n")
  process.exit(1)
})
