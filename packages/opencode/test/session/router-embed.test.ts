import { describe, expect, test } from "bun:test"
import { augmentMatchedEmbed, CONVERSATION_INTENT_PROTOTYPE, DEFAULT_LOCAL_EMBED_MODEL } from "../../src/session/router-embed"
import { pickTools } from "../../src/session/router-embed-impl"

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
      minScore: 0.34,
      phraseFor: (id) => id,
    })
    expect(out).toBeUndefined()
  })
})

describe("pickTools auto A+C", () => {
  test("keeps candidates near best score then trims by token budget", () => {
    const scored = [
      { id: "a", score: 0.95 },
      { id: "b", score: 0.92 },
      { id: "c", score: 0.80 },
    ]
    const out = pickTools(scored, {
      minScore: 0.3,
      topK: 4,
      auto: { enabled: true, ratio: 0.9, tokenBudget: 20, maxCap: 100 },
      phraseFor: (id) => (id === "a" ? "x".repeat(30) : "short"),
    })
    expect(out).toEqual(["a"])
  })

  test("falls back to topK when auto is disabled", () => {
    const scored = [
      { id: "a", score: 0.8 },
      { id: "b", score: 0.79 },
      { id: "c", score: 0.78 },
    ]
    const out = pickTools(scored, {
      minScore: 0.75,
      topK: 2,
      phraseFor: () => "x",
    })
    expect(out).toEqual(["a", "b"])
  })
})
