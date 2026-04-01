/**
 * Real @huggingface/transformers + `classifyIntentEmbed`. Opt-in:
 *   RUN_TRANSFORMERS_INTENT_TESTS=1 bun test …   (Bun parent spawns Node for ONNX — no in-process onnxruntime-node)
 *   RUN_XENOVA_INTENT_TESTS=1 also accepted (legacy alias).
 *
 * **Node (same cases):** `RUN_TRANSFORMERS_INTENT_TESTS=1 npx --yes tsx --test test/session/router-embed-transformers-real.node.test.ts`
 * or `npx --yes tsx ./script/transformers-intent-smoke.ts`
 *
 * If inference still fails, fix onnx/sharp in the environment (OS-specific).
 */
import { describe, expect, test } from "bun:test"
import {
  classifyIntentEmbed,
  DEFAULT_LOCAL_EMBED_MODEL,
  ROUTER_INTENT_PROTOTYPES,
} from "../../src/session/router-embed"

const wantRun =
  process.env.RUN_TRANSFORMERS_INTENT_TESTS === "1" || process.env.RUN_XENOVA_INTENT_TESTS === "1"
const skip = !wantRun

describe.skipIf(skip)("classifyIntentEmbed real Transformers.js", () => {
  test(
    "classifies prototype-aligned phrases",
    async () => {
      const minScore = 0.38
      const cases: [string, string][] = [
        ["hola cómo estás", "conversation"],
        ["refactor and edit the source code", "edit/refactor"],
        ["delete this file permanently", "delete/remove"],
        ["run unit tests and verify CI", "test"],
        ["search the web for documentation", "web/research"],
      ]
      for (const [text, want] of cases) {
        const r = await classifyIntentEmbed({
          userText: text,
          model: DEFAULT_LOCAL_EMBED_MODEL,
          minScore,
          prototypes: ROUTER_INTENT_PROTOTYPES,
        })
        expect(r, `no result for "${text.slice(0, 48)}"`).toBeDefined()
        expect(r!.label).toBe(want)
      }
    },
    { timeout: 300_000 },
  )
})
