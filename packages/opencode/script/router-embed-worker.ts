/**
 * Node-only subprocess: runs ONNX (@huggingface/transformers) so the Bun parent never loads onnxruntime-node.
 * Started by `router-embed-ipc.ts`. Protocol: one JSON object per stdin line; one JSON response per stdout line.
 */
process.env.OPENCODE_ROUTER_EMBED_WORKER = "1"
import * as readline from "node:readline"
import {
  augmentMatchedEmbed,
  classifyIntentEmbed,
} from "../src/session/router-embed-impl.ts"

type Req =
  | { id: number; method: "classifyIntentEmbed"; payload: {
      userText: string
      model: string
      minScore: number
      prototypes: import("../src/session/router-embed-impl.ts").IntentPrototype[]
    } }
  | { id: number; method: "augmentMatchedEmbed"; payload: {
      userText: string
      matched: string[]
      allowedBuiltin: string[]
      model: string
      topK: number
      minScore: number
      auto?: {
        enabled: boolean
        ratio: number
        tokenBudget: number
        maxCap: number
      }
      phrases: Record<string, string>
    } }

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

for await (const line of rl) {
  if (!line.trim()) continue
  let id = 0
  try {
    const req = JSON.parse(line) as Req
    id = req.id
    if (req.method === "classifyIntentEmbed") {
      const r = await classifyIntentEmbed(req.payload)
      process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: r === undefined ? null : r }) + "\n")
      continue
    }
    if (req.method === "augmentMatchedEmbed") {
      const p = req.payload
      const r = await augmentMatchedEmbed({
        userText: p.userText,
        matched: new Set(p.matched),
        allowedBuiltin: new Set(p.allowedBuiltin),
        model: p.model,
        topK: p.topK,
        minScore: p.minScore,
        auto: p.auto,
        phraseFor: (tid) => p.phrases[tid] ?? "",
      })
      process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: r === undefined ? null : r }) + "\n")
      continue
    }
    process.stdout.write(
      JSON.stringify({
        id,
        ok: false,
        error: `unknown method: ${String((req as { method?: string }).method)}`,
      }) + "\n",
    )
  } catch (e) {
    process.stdout.write(JSON.stringify({ id, ok: false, error: String(e) }) + "\n")
  }
}
