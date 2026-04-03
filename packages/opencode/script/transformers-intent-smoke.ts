/**
 * Smoke test for real @huggingface/transformers embeddings (run with Node + tsx; Bun often breaks onnxruntime).
 *   cd packages/opencode && npx --yes tsx ./script/transformers-intent-smoke.ts
 */
import {
  classifyIntentEmbed,
  DEFAULT_LOCAL_EMBED_MODEL,
  ROUTER_INTENT_PROTOTYPES,
} from "../src/session/router-embed"
import { shutdownRouterEmbedIpc } from "../src/session/router-embed-ipc"

const minScore = 0.38
const cases: [string, string][] = [
  ["hola cómo estás", "conversation"],
  ["refactor and edit the source code", "edit/refactor"],
  ["delete this file permanently", "delete/remove"],
  ["run unit tests and verify CI", "test"],
  ["search the web for documentation", "web/research"],
]

const model = process.env.OPENCODE_TOOL_ROUTER_EMBED_MODEL?.trim() || DEFAULT_LOCAL_EMBED_MODEL
if (model !== DEFAULT_LOCAL_EMBED_MODEL) console.log("model:", model)

let ok = 0
for (const [text, want] of cases) {
  const r = await classifyIntentEmbed({
    userText: text,
    model,
    minScore,
    prototypes: ROUTER_INTENT_PROTOTYPES,
  })
  const pass = r?.label === want
  if (pass) ok++
  console.log(pass ? "ok" : "fail", { text: text.slice(0, 40), want, got: r?.label, score: r?.score?.toFixed(3) })
}
shutdownRouterEmbedIpc()
if (ok !== cases.length) process.exit(1)
console.log(`transformers-intent-smoke: ${ok}/${cases.length} passed`)
