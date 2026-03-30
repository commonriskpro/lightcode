import { describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { tmpdir } from "../fixture/fixture"

function evalPerm(agent: Agent.Info | undefined, permission: string): string {
  if (!agent) return "undefined"
  const result = Permission.disabled([permission], agent.permission)
  return result.has(permission) ? "deny" : "allow"
}

describe("agent.sdd", () => {
  test("defaultAgent throws when all primary agents are disabled", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          build: { disable: true },
          plan: { disable: true },
          "sdd-orchestrator": { disable: true },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Agent.defaultAgent()).rejects.toThrow("no primary visible agent found")
      },
    })
  })

  test("sdd-orchestrator agent is primary native", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const o = await Agent.get("sdd-orchestrator")
        expect(o).toBeDefined()
        expect(o?.mode).toBe("primary")
        expect(o?.native).toBe(true)
        expect(o?.description?.length).toBeGreaterThan(0)
        expect(evalPerm(o, "edit")).toBe("allow")
        expect(evalPerm(o, "bash")).toBe("allow")
        expect(evalPerm(o, "read")).toBe("allow")
        expect(evalPerm(o, "webfetch")).toBe("allow")
        expect(evalPerm(o, "websearch")).toBe("allow")
      },
    })
  })

  test("sdd-explore agent has correct properties", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sddExplore = await Agent.get("sdd-explore")
        expect(sddExplore).toBeDefined()
        expect(sddExplore?.mode).toBe("subagent")
        expect(sddExplore?.native).toBe(true)
        expect(sddExplore?.description).toContain("Investigate codebase")
        expect(evalPerm(sddExplore, "edit")).toBe("allow")
        expect(evalPerm(sddExplore, "write")).toBe("allow")
        expect(evalPerm(sddExplore, "grep")).toBe("allow")
        expect(evalPerm(sddExplore, "glob")).toBe("allow")
        expect(evalPerm(sddExplore, "webfetch")).toBe("allow")
        expect(evalPerm(sddExplore, "websearch")).toBe("allow")
      },
    })
  })

  test("sdd-spec agent has correct properties", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sddSpec = await Agent.get("sdd-spec")
        expect(sddSpec).toBeDefined()
        expect(sddSpec?.mode).toBe("subagent")
        expect(sddSpec?.native).toBe(true)
        expect(sddSpec?.description).toContain("specifications")
        expect(evalPerm(sddSpec, "edit")).toBe("allow")
        expect(evalPerm(sddSpec, "write")).toBe("allow")
        expect(evalPerm(sddSpec, "read")).toBe("allow")
      },
    })
  })

  test("sdd-apply agent has correct properties", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sddApply = await Agent.get("sdd-apply")
        expect(sddApply).toBeDefined()
        expect(sddApply?.mode).toBe("subagent")
        expect(sddApply?.native).toBe(true)
        expect(sddApply?.description).toContain("task")
        expect(evalPerm(sddApply, "read")).toBe("allow")
        expect(evalPerm(sddApply, "grep")).toBe("allow")
        expect(evalPerm(sddApply, "glob")).toBe("allow")
        expect(evalPerm(sddApply, "edit")).toBe("allow")
        expect(evalPerm(sddApply, "write")).toBe("allow")
        expect(evalPerm(sddApply, "todowrite")).toBe("deny")
      },
    })
  })

  test("sdd-verify agent has correct properties", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sddVerify = await Agent.get("sdd-verify")
        expect(sddVerify).toBeDefined()
        expect(sddVerify?.mode).toBe("subagent")
        expect(sddVerify?.native).toBe(true)
        expect(sddVerify?.description).toContain("Validate implementation")
        expect(evalPerm(sddVerify, "edit")).toBe("allow")
        expect(evalPerm(sddVerify, "write")).toBe("allow")
        expect(evalPerm(sddVerify, "read")).toBe("allow")
      },
    })
  })
})
