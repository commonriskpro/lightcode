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
 * Reserved scopes (not exposed to agents — require explicit user action):
 * - "user"           — user-wide preferences
 * - "global_pattern" — cross-project reusable patterns
 */

import z from "zod"
import { Tool } from "./tool"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"

export const UpdateWorkingMemoryTool = Tool.define("update_working_memory", {
  description:
    "Store or update a persistent fact, goal, constraint, or architectural decision in working memory. " +
    "Use this to remember important information that should persist across turns or even sessions. " +
    "Examples: technology choices, project goals, user preferences, active constraints, decisions made. " +
    'Use scope="project" for decisions that affect all agents on this project. ' +
    'Use scope="agent" for your own operational memory as this specific agent. ' +
    'Use scope="thread" for information relevant only to this conversation.',
  parameters: z.object({
    scope: z
      .enum(["thread", "agent", "project"])
      .describe(
        '"thread" = this conversation only | "agent" = this agent across sessions | "project" = all agents and sessions for this project',
      ),
    key: z
      .string()
      .min(1)
      .max(100)
      .describe(
        'Short identifier for this memory entry (e.g. "current_goal", "tech_stack", "auth_decision", "constraints")',
      ),
    value: z.string().min(1).max(10_000).describe("The content to remember. Be concise and factual."),
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
