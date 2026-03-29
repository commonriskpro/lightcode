# Orchestrator-Driven Token Optimization: Next Steps

## Current State

We have implemented:

1. Lazy skills loading with caching in `SystemPrompt.skills()` (saves ~1,850 tokens after first use per agent type)
2. Agent-mode based skills filtering in session prompt construction (saves ~1,850 tokens for subagents with skill:deny permission)

## Next Step: Orchestrator-Driven System Prompt for SDD Agents

Goal: Have the orchestrator (parent agent) construct a minimal, task-specific system prompt for each subagent, sending only what is strictly necessary for the subagent to perform its specific task.

### Why This Is Needed for SDD Agents

SDD agents are highly specialized:

- `sdd-apply`: Only applies specifications to code
- `sdd-spec`: Only writes specifications
- `sdd-tasks`: Only breaks down specs into tasks
- `sdd-verify`: Only verifies implementation against specs

Each agent only needs:

- A minimal base prompt describing its specific task
- Only the essential environment variables required for that task (e.g., working directory for file operations, but not necessarily git status for all agents)
- A direct reference to the specific skill(s) it is allowed to use (via @skillfile reference)
- Possibly minimal instructions from AGENTS.md that are directly relevant to its task

### Expected Token Savings

For each SDD subagent request:

- **Current with our optimizations**: ~500-800 tokens (minimal skills description + environment + instruction prompt)
- **Orchestrator-driven**: ~100-200 tokens (minimal base + essential environment + skill reference)

**Additional savings per request**: ~400-600 tokens

For a typical SDD workflow with 5 subagents × 3 steps each = 15 requests:

- **Current with our optimizations**: ~7,500-12,000 tokens
- **Orchestrator-driven**: ~1,500-3,000 tokens
- **Additional savings**: ~6,000-9,000 tokens per workflow

### Implementation Approach

#### 1. Modify SessionPrompt to Accept Custom System Prompt

**File**: `/packages/opencode/src/session/prompt.ts`
**Change**: Modify the `SessionPrompt.prompt` function to accept an optional `system` override in the input.

- If `input.system` is provided, use it as the system prompt and skip the default construction
- Otherwise, build the system prompt as before (for backward compatibility)

#### 2. Create Orchestrator Prompt Utilities

**File**: `/packages/opencode/src/session/orchestrator-prompt.ts`
**Functions**:

- `buildMinimalBasePrompt(agent: Agent.Info): string` - Returns a minimal base prompt for the agent
- `buildEssentialEnvironment(model: Provider.Model): string[]` - Returns only the essential environment variables needed for most agent tasks (working directory, date, etc.)
- `buildSkillReference(skillName: string): string` - Returns a string like `You have access to the skill: @skillfile(${skillName})`
- `buildRelevantInstructions(agent: Agent.Info, relevantSections: string[]): string` - Extracts only relevant sections from AGENTS.md

#### 3. Modify SDD Workflow to Use Custom System Prompts

**Example**: In `sdd-apply` workflow (likely in `/packages/opencode/src/specs/sdd-apply.ts` or when using the `agent` tool to call sdd-apply):

- Instead of letting the subagent use the default system prompt construction, build a custom system prompt:

  ```
  You are an AI agent tasked with applying specifications to code.
  Working directory: /Users/saturno/Documents/openedit2
  Today's date: 2026-03-29

  You have access to the skill: @skillfile(sdd-apply)
  Apply the specification provided in the user's message to the codebase.
  ```

- Pass this custom system prompt as the `system` override when invoking the subagent via the `agent` tool or direct session creation.

#### 4. Update Tests

- Add tests for the new orchestrator-prompt utilities
- Verify that SDD agents still function correctly with the custom system prompt
- Ensure backward compatibility is maintained for non-SDD workflows

### Backward Compatibility

- The default `SessionPrompt.prompt` behavior remains unchanged when no `system` override is provided
- SDD workflows explicitly opt-in to the orchestrator-driven construction
- No changes to agent configurations or permissions required for existing workflows

### Files to Create/Modify

1. **Modify**: `/packages/opencode/src/session/prompt.ts` - Add support for custom system prompt override
2. **Create**: `/packages/opencode/src/session/orchestrator-prompt.ts` - Utility functions for building minimal prompts
3. **Modify**: SDD workflow files (e.g., `/packages/opencode/src/specs/sdd-apply.ts`, `/packages/opencode/src/specs/sdd-spec.ts`, etc.) - Custom system prompt construction
4. **Modify**: `/packages/opencode/test/session/prompt.test.ts` - Add tests for custom system prompt override
5. **Modify**: `/packages/opencode/test/specs/sdd-apply.test.ts` - Verify SDD agents work with custom prompts

### Example Implementation Snippet

In `src/session/prompt.ts`:

```typescript
export namespace SessionPrompt {
  // ... existing code ...

  export const PromptInput = z.object({
    // ... existing fields ...
    system: z.string().optional(), // NEW: Optional system prompt override
  })

  // ... existing code ...

  export const prompt = Effect.fn("SessionPrompt.prompt")(function* (input: PromptInput) {
    // ... existing code up to agent retrieval ...

    // NEW: Use provided system prompt if available, otherwise build default
    const system = input.system ?? [
      ...(await SystemPrompt.environment(model)),
      ...(agent.mode === "primary" || !Permission.disabled(["skill"], agent.permission).has("skill")
        ? skills
          ? [skills]
          : []
        : []),
      ...(await InstructionPrompt.system()),
    ]

    // ... rest of the function unchanged ...
  })
}
```

In an SDD workflow (e.g., when sdd-apply calls the explore agent to find files):

```typescript
// Instead of letting explore use its default system prompt, build a custom one
const customSystem = [
  "You are an AI agent specialized in exploring codebases to find specific patterns.",
  `Working directory: ${Instance.directory}`,
  `Today's date: ${new Date().toDateString()}`,
  "",
  "You have access to the skill: @skillfile(explore)",
  "Use the glob and grep skills to find files matching the following pattern:",
  userRequest,
].join("\n")

// Then call the explore agent with this custom system prompt
const result = await Agent.generate({
  description: "Find files matching the pattern",
  agent: "explore",
  // ... other parameters ...
  // Pass the custom system prompt via the session or context - implementation dependent
})
```

### Dependencies

- Requires modifying the SDD workflow implementations to construct custom prompts
- No new external dependencies
- Maintains full backward compatibility

### Next Steps

1. Implement the orchestrator-prompt utilities
2. Modify SessionPrompt.prompt to accept custom system prompt override
3. Update one SDD workflow (e.g., sdd-apply) to use the custom system prompt
4. Test and verify functionality and token savings
5. Roll out to other SDD workflows (sdd-spec, sdd-tasks, sdd-verify, etc.)

This optimization completes the token reduction strategy by ensuring that each subagent receives only the information strictly necessary for its specific task, leveraging the orchestrator's knowledge of the workflow and the agent's specialization.
