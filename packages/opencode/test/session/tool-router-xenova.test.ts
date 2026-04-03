import { describe, expect, mock, test } from "bun:test"

mock.module("../../src/session/router-embed", () => ({
  DEFAULT_LOCAL_EMBED_MODEL: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  CONVERSATION_INTENT_LABEL: "conversation",
  ROUTER_INTENT_PROTOTYPES: [],
  BUILTIN_INTENT_PROTOTYPES: [],
  classifyIntentEmbedMerged: async () => ({
    primary: "conversation",
    score: 0.95,
    merged: [],
    labels: ["conversation"],
    conversationExclusive: true,
  }),
  augmentMatchedEmbed: async () => undefined,
}))

const { ToolRouter } = await import("../../src/session/tool-router")
import type { Tool as AITool } from "ai"
import type { Config } from "../../src/config/config"
import type { MessageV2 } from "../../src/session/message-v2"

function dummyTool(id: string): AITool {
  return { description: `Tool ${id}` } as AITool
}

function userMsg(text: string) {
  return {
    info: {
      id: "u1" as any,
      sessionID: "s1" as any,
      role: "user" as const,
      time: { created: 1 },
      agent: "build",
      model: { providerID: "opencode" as any, modelID: "m1" as any },
    },
    parts: [{ type: "text" as const, text, id: "p1" as any, sessionID: "s1" as any, messageID: "u1" as any }],
  } as MessageV2.WithParts
}

describe("ToolRouter local-embed conversation tier", () => {
  test("hybrid + local_intent_embed + local_embed: mocked conversation intent clears tools", async () => {
    const tools = {
      read: dummyTool("read"),
      bash: dummyTool("bash"),
      skill: dummyTool("skill"),
      task: dummyTool("task"),
      grep: dummyTool("grep"),
    }
    const out = await ToolRouter.apply({
      tools,
      messages: [userMsg("cualquier cosa")],
      agent: { name: "build", mode: "primary" },
      cfg: {
        experimental: {
          tool_router: {
            enabled: true,
            mode: "hybrid",
            local_embed: true,
            local_intent_embed: true,
            local_embed_model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
            max_tools: 12,
          },
        },
      } as Config.Info,
      mcpIds: new Set(),
      skip: false,
    })
    expect(out.contextTier).toBe("conversation")
    expect(Object.keys(out.tools)).toHaveLength(0)
  })
})
