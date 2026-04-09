import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { TaskTool } from "../../src/tool/task"
import { tmpdir } from "../fixture/fixture"
import { Memory } from "../../src/memory"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID } from "../../src/session/schema"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.task", () => {
  test("description sorts subagents by name and is stable across calls", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const first = await TaskTool.init({ agent: build })
        const second = await TaskTool.init({ agent: build })

        expect(first.description).toBe(second.description)

        const alpha = first.description.indexOf("- alpha: Alpha agent")
        const explore = first.description.indexOf("- explore:")
        const general = first.description.indexOf("- general:")
        const zebra = first.description.indexOf("- zebra: Zebra agent")

        expect(alpha).toBeGreaterThan(-1)
        expect(explore).toBeGreaterThan(alpha)
        expect(general).toBeGreaterThan(explore)
        expect(zebra).toBeGreaterThan(general)
      },
    })
  })

  test("cancel between session create and handoff write aborts before child prompt", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          helper: {
            mode: "subagent",
            model: "test/different-model",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        if (!build) throw new Error("build agent not found")
        const tool = await TaskTool.init({ agent: build })

        const hit = Promise.withResolvers<void>()
        const hold = Promise.withResolvers<void>()

        const msg = spyOn(MessageV2, "get").mockResolvedValue({
          info: {
            role: "assistant",
            modelID: "parent-model",
            providerID: "test",
          },
        } as Awaited<ReturnType<typeof MessageV2.get>>)
        const handoff = spyOn(Memory, "writeHandoff").mockImplementation(async () => {
          hit.resolve()
          await hold.promise
          return "handoff_test"
        })
        const parts = spyOn(SessionPrompt, "resolvePromptParts")
        const prompt = spyOn(SessionPrompt, "prompt")

        const ac = new AbortController()
        const run = tool.execute(
          {
            description: "task",
            prompt: "do work",
            subagent_type: "helper",
          },
          {
            ask: async () => {},
            metadata: () => {},
            abort: ac.signal,
            sessionID: SessionID.make("session_parent"),
            messageID: MessageID.make("message_parent"),
            agent: "build",
            extra: {},
          } as unknown as Parameters<typeof tool.execute>[1],
        )

        await hit.promise
        ac.abort()
        hold.resolve()

        await expect(run).rejects.toThrow("Aborted")
        expect(handoff).toHaveBeenCalled()
        expect(parts).not.toHaveBeenCalled()
        expect(prompt).not.toHaveBeenCalled()

        msg.mockRestore()
        handoff.mockRestore()
        parts.mockRestore()
        prompt.mockRestore()
      },
    })
  })
})
