/**
 * Expand offline router eval dataset: seed + synthetic + optional gzip JSONL corpus sample.
 * Usage: bun run router:eval:expand [--seed path] [--out path] [--sample-file path] [--sample-limit n] ...
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createReadStream } from "node:fs"
import { createGunzip } from "node:zlib"
import { createInterface } from "node:readline"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import os from "node:os"
import type { RouterEvalRow } from "../src/session/router-eval-types"
import {
  ROUTER_EVAL_FULL_PALETTE,
  balanceByFloorsAndCaps,
  buildReviewedSubset,
  buildSyntheticRows,
  computeManifestExtended,
  corpusPositiveToolId,
  dedupeRouterEvalRows,
  DEFAULT_CATEGORY_CAPS,
  DEFAULT_CATEGORY_FLOORS,
  fnv1a32,
  labelFromCorpusTool,
  normalizePromptForDedupe,
  selectReviewCandidates,
  tagSeedRows,
} from "../src/session/router-eval-expand"
import { loadRouterEvalJsonl } from "../src/session/router-eval-types"

const dir = path.dirname(fileURLToPath(import.meta.url))
const defaultSeed = path.join(dir, "../test/fixtures/router-eval.jsonl")
const defaultOut = path.join(dir, "../test/fixtures/router-eval-expanded.jsonl")
const defaultReviewedOut = path.join(dir, "../test/fixtures/router-eval-reviewed.jsonl")
const defaultCandidatesOut = path.join(dir, "../test/fixtures/router-eval-candidates.json")

const HEURISTIC_NOTE =
  "sampled_heuristic: labels from corpus positive prefix; conservative; not production ground truth."

function parseArgs(argv: string[]) {
  const o: {
    seed: string
    out: string
    manifest?: string
    skippedOut?: string
    sampleFile?: string
    sampleLimit: number
    perToolCap: number
    sampleStride: number
    syntheticLimit: number
    includeSampled: boolean
    includeSynthetic: boolean
    verbose: boolean
    balance: boolean
    writeReviewed: boolean
    reviewedOut: string
    candidatesOut: string
  } = {
    seed: defaultSeed,
    out: defaultOut,
    sampleLimit: 220,
    perToolCap: 22,
    sampleStride: 0,
    syntheticLimit: 10_000,
    includeSampled: true,
    includeSynthetic: true,
    verbose: false,
    balance: true,
    writeReviewed: true,
    reviewedOut: defaultReviewedOut,
    candidatesOut: defaultCandidatesOut,
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--seed" && argv[i + 1]) {
      o.seed = argv[++i]
      continue
    }
    if (a === "--out" && argv[i + 1]) {
      o.out = argv[++i]
      continue
    }
    if (a === "--manifest" && argv[i + 1]) {
      o.manifest = argv[++i]
      continue
    }
    if (a === "--skipped-out" && argv[i + 1]) {
      o.skippedOut = argv[++i]
      continue
    }
    if (a === "--sample-file" && argv[i + 1]) {
      o.sampleFile = argv[++i]
      continue
    }
    if (a === "--sample-limit" && argv[i + 1]) {
      o.sampleLimit = Math.max(0, Number(argv[++i]) || 0)
      continue
    }
    if (a === "--per-tool-cap" && argv[i + 1]) {
      o.perToolCap = Math.max(1, Number(argv[++i]) || 22)
      continue
    }
    if (a === "--sample-stride" && argv[i + 1]) {
      o.sampleStride = Math.max(0, Number(argv[++i]) || 0)
      continue
    }
    if (a === "--synthetic-limit" && argv[i + 1]) {
      o.syntheticLimit = Math.max(0, Number(argv[++i]) || 0)
      continue
    }
    if (a === "--include-sampled") {
      o.includeSampled = true
      continue
    }
    if (a === "--no-sampled") {
      o.includeSampled = false
      continue
    }
    if (a === "--include-synthetic") {
      o.includeSynthetic = true
      continue
    }
    if (a === "--no-synthetic") {
      o.includeSynthetic = false
      continue
    }
    if (a === "--verbose") {
      o.verbose = true
      continue
    }
    if (a === "--no-balance") {
      o.balance = false
      continue
    }
    if (a === "--no-reviewed") {
      o.writeReviewed = false
      continue
    }
    if (a === "--reviewed-out" && argv[i + 1]) {
      o.reviewedOut = argv[++i]
      continue
    }
    if (a === "--candidates-out" && argv[i + 1]) {
      o.candidatesOut = argv[++i]
      continue
    }
  }
  return o
}

function corpusCandidates(explicit?: string): string[] {
  const c: string[] = []
  if (explicit) c.push(explicit)
  c.push(path.join(os.homedir(), "Downloads", "tool_routing_embeddings_500k_unique.jsonl.gz"))
  c.push(path.join(process.cwd(), "tool_routing_embeddings_500k_unique.jsonl.gz"))
  c.push(path.join(dir, "../tool_routing_embeddings_500k_unique.jsonl.gz"))
  return c
}

async function resolveCorpusPath(explicit?: string): Promise<string | undefined> {
  const { access } = await import("node:fs/promises")
  for (const p of corpusCandidates(explicit)) {
    if (await access(p).then(() => true).catch(() => false)) return p
  }
  return undefined
}

async function* iterateGzipJsonl(filePath: string): AsyncGenerator<{ line: string; lineNo: number }> {
  const stream = createReadStream(filePath).pipe(createGunzip())
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  let lineNo = 0
  for await (const line of rl) {
    lineNo++
    const t = line.trim()
    if (t) yield { line: t, lineNo }
  }
}

async function sampleFromCorpus(
  filePath: string,
  limit: number,
  perCap: number,
  stride: number,
  verbose: boolean,
): Promise<{ rows: RouterEvalRow[]; skipped: { reason: string; line_no?: number }[] }> {
  const rows: RouterEvalRow[] = []
  const skipped: { reason: string; line_no?: number }[] = []
  const perTool = new Map<string, number>()
  const seenPrompt = new Set<string>()
  const palette = [...ROUTER_EVAL_FULL_PALETTE]

  for await (const { line, lineNo } of iterateGzipJsonl(filePath)) {
    if (rows.length >= limit) break
    if (stride > 0 && lineNo % stride !== 0) continue

    let o: { prompt?: string; positive?: string }
    try {
      o = JSON.parse(line) as { prompt?: string; positive?: string }
    } catch {
      skipped.push({ reason: "json_parse", line_no: lineNo })
      continue
    }
    if (typeof o.prompt !== "string" || typeof o.positive !== "string") {
      skipped.push({ reason: "shape", line_no: lineNo })
      continue
    }
    const trimmed = o.prompt.trim()
    if (trimmed.length < 14) {
      skipped.push({ reason: "short_prompt", line_no: lineNo })
      continue
    }

    const pk = normalizePromptForDedupe(trimmed)
    if (seenPrompt.has(pk)) continue
    seenPrompt.add(pk)

    const tool = corpusPositiveToolId(o.positive)
    const lab = labelFromCorpusTool(tool)
    if ("skip" in lab) {
      skipped.push({ reason: lab.reason, line_no: lineNo })
      continue
    }

    const n = perTool.get(tool) ?? 0
    if (n >= perCap) continue
    perTool.set(tool, n + 1)

    const id = `corpus-${tool}-${fnv1a32(`${lineNo}:${o.prompt}`).toString(16)}`
    rows.push({
      id,
      source: "sampled_heuristic",
      category: "sampled_heuristic",
      prompt: trimmed,
      agent: "build",
      available_tools: palette,
      required_tools: lab.required_tools,
      allowed_tools: lab.allowed_tools,
      forbidden_tools: lab.forbidden_tools,
      expect_conversation: lab.expect_conversation,
      notes: `${HEURISTIC_NOTE} corpus_tool=${tool}`,
    })
    if (verbose && rows.length % 25 === 0) console.error(`sampled ${rows.length}…`)
  }

  return { rows, skipped }
}

async function main() {
  const argv = process.argv.slice(2)
  const o = parseArgs(argv)
  const rawSeed = await readFile(o.seed, "utf8")
  const seedRows = tagSeedRows(loadRouterEvalJsonl(rawSeed))

  let synthetic: RouterEvalRow[] = []
  if (o.includeSynthetic) {
    synthetic = buildSyntheticRows()
    if (o.syntheticLimit >= 0 && o.syntheticLimit < synthetic.length) synthetic = synthetic.slice(0, o.syntheticLimit)
  }

  let sampled: RouterEvalRow[] = []
  const skipped: { reason: string; line_no?: number }[] = []
  if (o.includeSampled && o.sampleLimit > 0) {
    const corpusPath = await resolveCorpusPath(o.sampleFile)
    if (corpusPath) {
      if (o.verbose) console.error(`Corpus: ${corpusPath}`)
      const r = await sampleFromCorpus(corpusPath, o.sampleLimit, o.perToolCap, o.sampleStride, o.verbose)
      sampled = r.rows
      skipped.push(...r.skipped)
    } else if (o.verbose) console.error("No corpus file found; skipping sampled rows.")
  }

  let merged = dedupeRouterEvalRows([...seedRows, ...sampled, ...synthetic])
  if (o.balance) merged = balanceByFloorsAndCaps(merged, DEFAULT_CATEGORY_FLOORS, DEFAULT_CATEGORY_CAPS)

  const jsonl = merged.map((r) => JSON.stringify(r)).join("\n") + "\n"
  const outDir = path.dirname(o.out)
  await mkdir(outDir, { recursive: true })
  await writeFile(o.out, jsonl, "utf8")

  const manifestPath = o.manifest ?? o.out.replace(/\.jsonl$/i, ".manifest.json")
  const manifest = computeManifestExtended(merged, DEFAULT_CATEGORY_FLOORS)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8")

  if (o.writeReviewed) {
    const reviewed = buildReviewedSubset(merged)
    await writeFile(o.reviewedOut, reviewed.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8")
    console.log(`Reviewed subset (${reviewed.length}) → ${o.reviewedOut}`)
  }

  const candidates = selectReviewCandidates(merged)
  const candPayload = {
    generated_from: path.basename(o.out),
    row_count: merged.length,
    candidate_count: candidates.length,
    candidates,
  }
  await writeFile(o.candidatesOut, JSON.stringify(candPayload, null, 2), "utf8")
  console.log(`Review candidates (${candidates.length}) → ${o.candidatesOut}`)

  const skippedPath = o.skippedOut ?? o.out.replace(/\.jsonl$/i, ".skipped.json")
  const skipSummary = {
    total_skipped_lines: skipped.length,
    by_reason: skipped.reduce<Record<string, number>>((acc, s) => {
      acc[s.reason] = (acc[s.reason] ?? 0) + 1
      return acc
    }, {}),
    sample: skipped.slice(0, 80),
  }
  await writeFile(skippedPath, JSON.stringify(skipSummary, null, 2), "utf8")

  console.log(`Wrote ${merged.length} rows → ${o.out}`)
  console.log(`Manifest → ${manifestPath}`)
  console.log(`Skipped summary → ${skippedPath} (${skipped.length} parse/skip events)`)
  if (manifest.underrepresented_categories.length)
    console.log(`Underrepresented vs floor: ${manifest.underrepresented_categories.join(", ")}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
