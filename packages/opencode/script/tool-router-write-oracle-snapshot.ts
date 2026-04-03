/**
 * Writes `tool-router-oracle-snapshot.json`: each row's **expect** = sorted tool ids from ToolRouter.apply
 * under the canonical offline benchmark config (dyn+ptm+cal + dynamic_ratio 0.97/0.74 + 0.86 / 0.18).
 *
 *   CASES=500 bun run script/tool-router-write-oracle-snapshot.ts
 *
 * Then switch `buildRows` in `tool-router-benchmark-shared.ts` to read the snapshot (see comment there).
 */
import { ToolRouter } from "../src/session/tool-router"
import { shutdownRouterEmbedIpc } from "../src/session/router-embed-ipc"
import {
  baseCfg,
  buildRowsLegacy,
  comboFromBits,
  tools,
  msg,
} from "./tool-router-benchmark-shared"
import type { BenchRow } from "./tool-router-benchmark-shared"

const cases = Math.min(500, Math.max(1, Number(process.env.CASES ?? "500") || 500))
const rows = buildRowsLegacy(cases)
const exact = {
  ...comboFromBits(19),
  dynamic_ratio_simple: 0.97,
  dynamic_ratio_composite: 0.74,
}
const cfg = baseCfg({
  exact,
  auto_score_ratio: 0.86,
  local_embed_min_score: 0.18,
})

const out: BenchRow[] = []
for (const row of rows) {
  const ret = await ToolRouter.apply({
    tools: tools as any,
    messages: msg(row.text) as any,
    agent: { name: "build", mode: "primary" },
    cfg: cfg as any,
    mcpIds: new Set(),
    skip: false,
  })
  out.push({ text: row.text, expect: Object.keys(ret.tools).sort() })
}

const path = `${import.meta.dir}/tool-router-oracle-snapshot.json`
await Bun.write(path, JSON.stringify(out, null, 2))
console.log(JSON.stringify({ wrote: path, rows: out.length }, null, 2))
shutdownRouterEmbedIpc()
