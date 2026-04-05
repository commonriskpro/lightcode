/**
 * LightCode Memory Core V2 — Working Memory Tool
 *
 * Exposes Memory.setWorkingMemory() to the LLM as an agent tool.
 * Allows agents to persist stable facts, goals, constraints, and decisions
 * to project-scope or thread-scope working memory during a session.
 *
 * Only "thread" and "project" scopes are exposed to agents — user and
 * global_pattern scopes require explicit user intent.
 */

import z from "zod"
import { Tool } from "./tool"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"

export const UpdateWorkingMemoryTool = Tool.define("update_working_memory", {
  description:
    "Store or update a persistent fact, goal, constraint, or architectural decision in working memory. " +
    "Use this to remember important information that should persist across turns or even sessions. " +
    "Examples: technology choices, project goals, user preferences, active constraints, decisions made.",
  parameters: z.object({
    scope: z
      .enum(["thread", "project"])
      .describe(
        '"thread" = this conversation only, "project" = persists for the whole project across all future sessions',
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
        : { type: "thread" as const, id: ctx.sessionID as string }

    Memory.setWorkingMemory(scopeRef, key, value)

    const label = scope === "project" ? `project (${Instance.project.id})` : `this session`
    return {
      title: "update_working_memory",
      output: `Working memory updated: ${key} (${label})`,
      metadata: { scope, key, valueLength: value.length },
    }
  },
})
