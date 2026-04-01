import { describe, expect, test } from "bun:test"
import { augmentMatchedEmbed, CONVERSATION_INTENT_PROTOTYPE, DEFAULT_LOCAL_EMBED_MODEL } from "../../src/session/router-embed"

describe("conversation intent prototypes", () => {
  test("includes short anchors for single-token greetings", () => {
    for (const w of ["hola", "hi", "hey", "hello", "buenas"]) {
      expect(CONVERSATION_INTENT_PROTOTYPE.phrases).toContain(w)
    }
  })

  test("includes emotional check-in phrases for conversation intent", () => {
    for (const w of ["cómo te sientes", "how do you feel"]) {
      expect(CONVERSATION_INTENT_PROTOTYPE.phrases).toContain(w)
    }
  })
})

describe("augmentMatchedEmbed", () => {
  test("returns undefined when no candidates (skips loading model)", async () => {
    const out = await augmentMatchedEmbed({
      userText: "run the test suite",
      matched: new Set(["read", "bash", "skill", "task"]),
      allowedBuiltin: new Set(["read", "bash", "skill", "task"]),
      model: DEFAULT_LOCAL_EMBED_MODEL,
      topK: 4,
      minScore: 0.32,
      phraseFor: (id) => id,
    })
    expect(out).toBeUndefined()
  })
})
