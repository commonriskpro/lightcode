/**
 * Same cases as `router-embed-transformers-real.test.ts` but with `node:test` + Node (no Bun).
 * Bun can panic after ONNX teardown; use this for real-model CI.
 *
 *   cd packages/opencode
 *   RUN_TRANSFORMERS_INTENT_TESTS=1 npx --yes tsx --test test/session/router-embed-transformers-real.node.test.ts
 *
 * Optional: OPENCODE_PORTABLE_ROOT for onnx dylibs (see bin/opencode).
 */
import assert from "node:assert"
import { describe, test } from "node:test"
import {
  classifyIntentEmbed,
  DEFAULT_LOCAL_EMBED_MODEL,
  ROUTER_INTENT_PROTOTYPES,
} from "../../src/session/router-embed"

const wantRun =
  process.env.RUN_TRANSFORMERS_INTENT_TESTS === "1" || process.env.RUN_XENOVA_INTENT_TESTS === "1"

const run = wantRun ? test : test.skip

describe("classifyIntentEmbed real Transformers.js (Node)", () => {
  run(
    "classifies prototype-aligned phrases",
    { timeout: 300_000 },
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
        assert(r !== undefined, `no result for "${text.slice(0, 48)}"`)
        assert.strictEqual(r!.label, want)
      }
    },
  )
})
