import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Handoff } from "../../src/memory/handoff"
import { Instance } from "../../src/project/instance"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, SessionID } from "../../src/session/schema"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
import { SubagentLaunch } from "../../src/subagent/launch"
import { SUBAGENT_LAUNCH_MODE, SUBAGENT_LAUNCH_STATE, SubagentLaunchTable } from "../../src/subagent/launch.sql"
import { tmpdir } from "../fixture/fixture"
import { eq } from "drizzle-orm"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("SubagentLaunch", () => {
  test("prepare persists handoff launch and marks it prepared", async () => {
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
        const agent = await Agent.get("helper")
        if (!agent) throw new Error("helper agent not found")

        const launch = await SubagentLaunch.prepare({
          parent_session_id: SessionID.make("session_parent"),
          parent_message_id: MessageID.make("message_parent"),
          agent,
          description: "task",
          prompt: "do work",
          caller: "build",
          model: { modelID: "test/different-model", providerID: "test" },
          parentModel: { modelID: "parent-model", providerID: "test" },
          abort: new AbortController().signal,
          permission: [],
        })

        const row = await SubagentLaunch.get(launch.launchId)
        const handoff = await Handoff.getHandoff(launch.sessionId)

        expect(row?.state).toBe(SUBAGENT_LAUNCH_STATE.PREPARED)
        expect(row?.mode).toBe(SUBAGENT_LAUNCH_MODE.HANDOFF)
        expect(handoff?.child_session_id).toBe(launch.sessionId)
      },
    })
  })

  test("prepare persists fork context for same-model child", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          helper: {
            mode: "subagent",
            model: "parent-model",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("helper")
        if (!agent) throw new Error("helper agent not found")

        const launch = await SubagentLaunch.prepare({
          parent_session_id: SessionID.make("session_parent"),
          parent_message_id: MessageID.make("message_parent"),
          agent,
          description: "task",
          prompt: "do work",
          caller: "build",
          model: { modelID: "parent-model", providerID: "test" },
          parentModel: { modelID: "parent-model", providerID: "test" },
          abort: new AbortController().signal,
          permission: [],
        })

        const row = await SubagentLaunch.get(launch.launchId)
        const fork = await Handoff.getFork(launch.sessionId)

        expect(row?.mode).toBe(SUBAGENT_LAUNCH_MODE.FORK)
        expect(fork?.session_id).toBe(launch.sessionId)
      },
    })
  })

  test("start marks launch started before prompting", async () => {
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
        const agent = await Agent.get("helper")
        if (!agent) throw new Error("helper agent not found")
        const launch = await SubagentLaunch.prepare({
          parent_session_id: SessionID.make("session_parent"),
          parent_message_id: MessageID.make("message_parent"),
          agent,
          description: "task",
          prompt: "do work",
          caller: "build",
          model: { modelID: "test/different-model", providerID: "test" },
          parentModel: { modelID: "parent-model", providerID: "test" },
          abort: new AbortController().signal,
          permission: [],
        })

        const parts = spyOn(SessionPrompt, "resolvePromptParts").mockResolvedValue([{ type: "text", text: "do work" }])
        const prompt = spyOn(SessionPrompt, "prompt").mockImplementation(async () => {
          const row = await SubagentLaunch.get(launch.launchId)
          expect(row?.state).toBe(SUBAGENT_LAUNCH_STATE.STARTED)
          return { parts: [{ type: "text", text: "done" }] } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
        })

        const result = await SubagentLaunch.start({
          launchId: launch.launchId,
          abort: new AbortController().signal,
          tools: {},
        })

        expect(result.parts[0]?.type).toBe("text")

        parts.mockRestore()
        prompt.mockRestore()
      },
    })
  })

  test("start marks launch failed when prompt resolution fails", async () => {
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
        const agent = await Agent.get("helper")
        if (!agent) throw new Error("helper agent not found")
        const launch = await SubagentLaunch.prepare({
          parent_session_id: SessionID.make("session_parent"),
          parent_message_id: MessageID.make("message_parent"),
          agent,
          description: "task",
          prompt: "do work",
          caller: "build",
          model: { modelID: "test/different-model", providerID: "test" },
          parentModel: { modelID: "parent-model", providerID: "test" },
          abort: new AbortController().signal,
          permission: [],
        })

        const parts = spyOn(SessionPrompt, "resolvePromptParts").mockRejectedValue(new Error("boom"))

        await expect(
          SubagentLaunch.start({
            launchId: launch.launchId,
            abort: new AbortController().signal,
            tools: {},
          }),
        ).rejects.toThrow("boom")

        const row = await SubagentLaunch.get(launch.launchId)
        expect(row?.state).toBe(SUBAGENT_LAUNCH_STATE.FAILED)

        parts.mockRestore()
      },
    })
  })

  test("prepare rollback removes child session when launch hydration fails", async () => {
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
        const agent = await Agent.get("helper")
        if (!agent) throw new Error("helper agent not found")
        const parent = SessionID.make(`session_parent_${Date.now()}`)
        const handoff = spyOn(Handoff, "writeHandoff").mockRejectedValue(new Error("handoff boom"))

        await expect(
          SubagentLaunch.prepare({
            parent_session_id: parent,
            parent_message_id: MessageID.make("message_parent"),
            agent,
            description: "task",
            prompt: "do work",
            caller: "build",
            model: { modelID: "test/different-model", providerID: "test" },
            parentModel: { modelID: "parent-model", providerID: "test" },
            abort: new AbortController().signal,
            permission: [],
          }),
        ).rejects.toThrow("handoff boom")

        const launches = await Database.read((db) =>
          db.select().from(SubagentLaunchTable).where(eq(SubagentLaunchTable.parent_session_id, parent)).all(),
        )
        const kids = await Database.read((db) =>
          db.select().from(SessionTable).where(eq(SessionTable.parent_id, parent)).all(),
        )

        expect(launches.length).toBe(0)
        expect(kids.length).toBe(0)

        handoff.mockRestore()
      },
    })
  })

  test("listPending returns only pending states", async () => {
    await Database.write((db) =>
      db
        .insert(SubagentLaunchTable)
        .values([
          {
            id: "launch_prepared",
            parent_session_id: "parent",
            parent_message_id: "message",
            child_session_id: "child_prepared",
            agent: "helper",
            mode: SUBAGENT_LAUNCH_MODE.HANDOFF,
            state: SUBAGENT_LAUNCH_STATE.PREPARED,
            description: "task",
            prompt: "do work",
            model_id: "m",
            provider_id: "p",
            time_created: Date.now(),
            time_updated: Date.now(),
          },
          {
            id: "launch_started",
            parent_session_id: "parent",
            parent_message_id: "message",
            child_session_id: "child_started",
            agent: "helper",
            mode: SUBAGENT_LAUNCH_MODE.HANDOFF,
            state: SUBAGENT_LAUNCH_STATE.STARTED,
            description: "task",
            prompt: "do work",
            model_id: "m",
            provider_id: "p",
            time_created: Date.now(),
            time_updated: Date.now(),
          },
        ])
        .run(),
    )

    const rows = await SubagentLaunch.listPending()

    expect(rows.map((item) => item.id)).toContain("launch_prepared")
    expect(rows.map((item) => item.id)).not.toContain("launch_started")
  })
})
