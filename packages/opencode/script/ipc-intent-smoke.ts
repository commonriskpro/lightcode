/**
 * One-shot: parent calls router-embed-ipc (same subprocess path as Bun). Run:
 *   cd packages/opencode && bunx tsx ./script/ipc-intent-smoke.ts
 */
import { classifyIntentEmbed, shutdownRouterEmbedIpc } from "../src/session/router-embed-ipc"
import { DEFAULT_LOCAL_EMBED_MODEL, ROUTER_INTENT_PROTOTYPES } from "../src/session/router-embed-impl"

const minScore = 0.38
const cases: [string, string][] = [
  ["hola cómo estás", "conversation"],
  ["refactor and edit the source code", "edit/refactor"],
  ["delete this file permanently", "delete/remove"],
  ["run unit tests and verify CI", "test"],
  ["search the web for documentation", "web/research"],
]

let ok = 0
for (const [text, want] of cases) {
  const r = await classifyIntentEmbed({
    userText: text,
    model: DEFAULT_LOCAL_EMBED_MODEL,
    minScore,
    prototypes: ROUTER_INTENT_PROTOTYPES,
  })
  const pass = r?.label === want
  if (pass) ok++
  console.log(pass ? "ok" : "fail", { text: text.slice(0, 40), want, got: r?.label, score: r?.score?.toFixed(3) })
}
shutdownRouterEmbedIpc()
if (ok !== cases.length) process.exit(1)
console.log(`ipc-intent-smoke: ${ok}/${cases.length} passed`)
