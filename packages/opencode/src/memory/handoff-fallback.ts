import { appendFile, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { Instance } from "@/project/instance"
import type { AgentHandoff, ForkContext } from "./contracts"
import { Handoff } from "./handoff"

const FILE = ".lightcode/memory-handoff-fallback.ndjson"
const done = new Set<string>()

type ForkRow = {
  kind: "fork"
  payload: Omit<ForkContext, "id" | "time_created">
  time: number
  tries: number
  error: string
}

type HandoffRow = {
  kind: "handoff"
  payload: Omit<AgentHandoff, "id" | "time_created">
  time: number
  tries: number
  error: string
}

type Row = ForkRow | HandoffRow

function file() {
  return path.join(Instance.worktree, FILE)
}

function message(err: unknown) {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}

function parse(line: string): Row | undefined {
  try {
    const row = JSON.parse(line) as Row
    if (row.kind !== "fork" && row.kind !== "handoff") return undefined
    if (!row.payload || typeof row.payload !== "object") return undefined
    return {
      ...row,
      tries: Number.isFinite(row.tries) ? row.tries : 0,
      time: Number.isFinite(row.time) ? row.time : Date.now(),
      error: typeof row.error === "string" ? row.error : "",
    }
  } catch {
    return undefined
  }
}

async function run(row: Row) {
  if (row.kind === "fork") {
    await Handoff.writeFork({
      sessionId: row.payload.session_id,
      parentSessionId: row.payload.parent_session_id,
      context: row.payload.context,
    })
    return
  }
  await Handoff.writeHandoff(row.payload)
}

export namespace HandoffFallback {
  export function filePath() {
    return file()
  }

  export async function append(
    kind: "fork",
    payload: Omit<ForkContext, "id" | "time_created">,
    err: unknown,
  ): Promise<void>
  export async function append(
    kind: "handoff",
    payload: Omit<AgentHandoff, "id" | "time_created">,
    err: unknown,
  ): Promise<void>
  export async function append(
    kind: "fork" | "handoff",
    payload: Omit<ForkContext, "id" | "time_created"> | Omit<AgentHandoff, "id" | "time_created">,
    err: unknown,
  ): Promise<void> {
    const out = file()
    await mkdir(path.dirname(out), { recursive: true })
    await appendFile(
      out,
      JSON.stringify({
        kind,
        payload,
        time: Date.now(),
        tries: 0,
        error: message(err),
      }) + "\n",
    )
  }

  export async function replay() {
    const out = file()
    const txt = await Bun.file(out)
      .text()
      .catch(() => "")
    const rows = txt
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .map(parse)
      .filter((x): x is Row => Boolean(x))
    if (!rows.length) {
      await rm(out, { force: true }).catch(() => {})
      return { total: 0, applied: 0, kept: 0, path: out }
    }

    let applied = 0
    const kept: Row[] = []

    for (const row of rows) {
      try {
        await run(row)
        applied++
      } catch (err) {
        kept.push({
          ...row,
          tries: row.tries + 1,
          time: Date.now(),
          error: message(err),
        })
      }
    }

    if (!kept.length) {
      await rm(out, { force: true }).catch(() => {})
      return { total: rows.length, applied, kept: 0, path: out }
    }

    await Bun.write(out, kept.map((x) => JSON.stringify(x)).join("\n") + "\n")
    return { total: rows.length, applied, kept: kept.length, path: out }
  }

  export async function ensure() {
    const out = file()
    if (done.has(out)) return
    done.add(out)
    await replay().catch(() => {})
  }
}
