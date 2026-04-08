/**
 * LightCode Memory — Working Memory Tool
 *
 * Exposes Memory.setWorkingMemory() to the LLM as an agent tool.
 * Allows agents to persist stable facts, goals, constraints, and decisions
 * to project-scope, agent-scope, or thread-scope working memory.
 *
 * Exposed scopes:
 * - "thread"   — this conversation only (cleared when thread ends)
 * - "agent"    — this agent's memory across sessions (keyed by agent name)
 * - "project"  — shared across all agents and sessions for this project
 *
 * Explicit/gated scopes:
 * - "user"           — user-wide preferences via dedicated tool + approval gate
 * - "global_pattern" — cross-project reusable patterns
 */

import z from "zod"
import { Tool } from "./tool"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"

export const UpdateWorkingMemoryTool = Tool.define("update_working_memory", {
  description:
    "Persist a fact, goal, or decision to working memory. scope=thread for this session, agent for this agent, project for all agents.",
  parameters: z.object({
    scope: z
      .enum(["thread", "agent", "project"])
      .describe("thread=this session, agent=across sessions, project=all sessions"),
    key: z.string().min(1).max(100).describe("Short identifier for this memory entry"),
    value: z.string().min(1).max(10_000).describe("Content to remember"),
  }),
  async execute({ scope, key, value }, ctx) {
    const scopeRef =
      scope === "project"
        ? { type: "project" as const, id: Instance.project.id }
        : scope === "agent"
          ? { type: "agent" as const, id: ctx.agent }
          : { type: "thread" as const, id: ctx.sessionID as string }

    Memory.setWorkingMemory(scopeRef, key, value)

    const label =
      scope === "project"
        ? `project (${Instance.project.id})`
        : scope === "agent"
          ? `agent (${ctx.agent})`
          : `this session`
    return {
      title: "update_working_memory",
      output: `Working memory updated: ${key} (${label})`,
      metadata: { scope, key, valueLength: value.length },
    }
  },
})

export const UpdateUserMemoryTool = Tool.define("update_user_memory", {
  description: "Persist a durable user-wide preference or habit. Only when user explicitly asks. Requires approval.",
  parameters: z.object({
    key: z.string().min(1).max(100).describe("Short identifier for this user memory entry"),
    value: z.string().min(1).max(10_000).describe("Durable user-wide memory content"),
  }),
  async execute({ key, value }, ctx) {
    const scope = Memory.userScope()

    await ctx.ask({
      permission: "memory.user.write",
      patterns: [`${scope.id}:${key}`],
      always: [],
      metadata: {
        scope: scope.type,
        scopeID: scope.id,
        key,
        value,
      },
    })

    Memory.setUserMemory(key, value)

    return {
      title: "update_user_memory",
      output: `User memory updated: ${key} (${scope.id})`,
      metadata: { scope: scope.type, scopeID: scope.id, key, valueLength: value.length },
    }
  },
})
