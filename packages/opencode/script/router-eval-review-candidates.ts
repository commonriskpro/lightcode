/**
 * Deterministic list of expanded-dataset rows worth manual label review.
 * Usage: bun run router:eval:review-candidates [--dataset path] [--out path]
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFile, writeFile } from "node:fs/promises"
import { loadRouterEvalJsonl } from "../src/session/router-eval-types"
import { selectReviewCandidates } from "../src/session/router-eval-expand"

const dir = path.dirname(fileURLToPath(import.meta.url))
const defaultDataset = path.join(dir, "../test/fixtures/router-eval-expanded.jsonl")
const defaultOut = path.join(dir, "../test/fixtures/router-eval-candidates.json")

function parseArgs(argv: string[]) {
  let dataset = defaultDataset
  let out = defaultOut
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--dataset" && argv[i + 1]) {
      dataset = argv[++i]
      continue
    }
    if (a === "--out" && argv[i + 1]) {
      out = argv[++i]
      continue
    }
  }
  return { dataset, out }
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  const raw = await readFile(path.resolve(o.dataset), "utf8")
  const rows = loadRouterEvalJsonl(raw)
  const candidates = selectReviewCandidates(rows)
  const payload = {
    generated_from: path.basename(o.dataset),
    row_count: rows.length,
    candidate_count: candidates.length,
    candidates,
  }
  await writeFile(path.resolve(o.out), JSON.stringify(payload, null, 2), "utf8")
  console.log(`Wrote ${candidates.length} candidates → ${path.resolve(o.out)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
