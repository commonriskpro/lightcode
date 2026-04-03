# Token Optimization: Orchestrator-Driven System Prompt and Skill Injection for SDD Agents

## Problem Statement

Even with lazy skills loading and agent-mode based filtering, each subagent still receives a system prompt that includes:

- The full environment block (working directory, git status, platform, date)
- A minimal skills description (still ~200 tokens)
- The full instruction prompt from AGENTS.md (which can be several thousand tokens)

For SDD (Spec-Driven Development) agents, each agent is highly specialized for a single task (e.g., sdd-apply only applies specs, sdd-spec only writes specs).
Sending the full environment and instruction prompt to each subagent is wasteful because:

1. The subagent only needs a subset of the environment (e.g., working directory for file operations, but not necessarily git status)
2. The subagent only needs the specific skill it is designed to use (e.g., sdd-apply needs to know how to apply specs, not the entire skill catalog)
3. The instruction prompt may contain irrelevant information for the specific task.

## Solution

Have the orchestrator (parent agent) construct a minimal, task-specific system prompt for each subagent that includes only:

1. A minimal base prompt (the agent's own prompt if any, or a generic task-oriented prompt)
2. Only the essential environment variables required for the specific task
3. A direct reference to the specific skill(s) the subagent is allowed to use (via @skillfile reference)
4. Only the relevant parts of the instruction prompt (possibly none, if the skill reference and agent prompt are sufficient)

## Implementation Approach

### 1. Modify the Orchestrator to Build Custom System Prompts

In the orchestrator (e.g., in the SDD workflow implementation), when creating a subagent session, instead of relying on the default system prompt construction, the orchestrator will:

- Determine the minimal set of environment variables needed for the subagent's task
- Select the specific skill reference(s) the subagent needs
- Optionally, extract only the relevant instructions from AGENTS.md (or none if the skill reference suffices)
- Construct a custom system prompt string to pass to the subagent

### 2. Change SystemPrompt.skills() to Support Skill References

Modify `SystemPrompt.skills()` to accept an optional parameter specifying which skill(s) to reference, or create a new function that returns a skill reference string.

However, to avoid changing the core SystemPrompt interface, we can instead:

- Keep `SystemPrompt.skills()` as is (returning the minimal description) for backward compatibility
- But in the orchestrator, when we want to inject a specific skill reference, we bypass the skills listing entirely and inject our own skill reference text.

### 3. Example: SDD Apply Agent System Prompt

Instead of the default system prompt (~4,000+ tokens), the sdd-apply agent might receive:

```
You are an AI agent tasked with applying specifications to code.
Working directory: /Users/saturno/Documents/openedit2
Today's date: 2026-03-29

You have access to the skill: @skillfile(sdd-apply)
Use this skill to apply specifications to the codebase.
```

This would be under 200 tokens vs. the current ~4,000+ tokens.

### 4. Implementation Steps

#### Step 1: Create a Utility Function for Minimal System Prompt Components

Create a new file `/packages/opencode/src/session/minimal-prompt.ts` with functions to build minimal prompt components.

#### Step 2: Modify the Orchestrator (SDD Workflow)

In the SDD workflow implementation (likely in `/packages/opencode/src/specs/sdd-apply.ts` or similar), when creating a subagent session:

- Instead of using the default `SessionPrompt.prompt` flow, construct a custom system prompt string
- Pass this custom system prompt to the LLM call via the `system` parameter in the prompt input

#### Step 3: Update the SessionPrompt.prompt Function to Accept Custom System Prompt

Modify `SessionPrompt.prompt` to accept an optional `system` override parameter that, if provided, skips the default system prompt construction.

#### Step 4: Test with SDD Agents

Verify that SDD agents still function correctly with the reduced system prompt and that they can still access the specific skill they need.

## Expected Token Savings

For each SDD subagent request:

- **Current**: ~4,000+ tokens (full environment + minimal skills + full instruction prompt)
- **Proposed**: ~150-300 tokens (minimal environment + skill reference + minimal instructions)

**Savings per request**: ~3,700-3,850 tokens

For a typical SDD workflow with 5 subagents × 3 steps each = 15 requests:

- **Current**: ~60,000+ tokens
- **Proposed**: ~2,250-4,500 tokens
- **Savings**: ~55,500-57,750 tokens per workflow

## Files to Create/Modify

1. **New**: `/packages/opencode/src/session/minimal-prompt.ts` - Utility functions for building minimal prompt components
2. **Modify**: `/packages/opencode/src/session/prompt.ts` - Add support for custom system prompt override
3. **Modify**: SDD workflow files (e.g., `/packages/opencode/src/specs/sdd-apply.ts`, `/packages/opencode/src/specs/sdd-spec.ts`, etc.) - Custom system prompt construction
4. **Modify**: `/packages/opencode/test/session/prompt.test.ts` - Add tests for minimal prompt construction
5. **Modify**: `/packages/opencode/test/specs/sdd-apply.test.ts` - Verify SDD agents work with minimal prompts

## Backward Compatibility

- The default `SessionPrompt.prompt` behavior remains unchanged for non-SDD workflows
- SDD workflows explicitly opt-in to the minimal prompt construction
- No changes to agent configurations or permissions required

## Dependencies

- Requires modifying the SDD workflow implementation to construct custom prompts
- No new external dependencies

## Next Steps

1. Implement the minimal-prompt.ts utility functions
2. Modify SessionPrompt.prompt to accept custom system prompt override
3. Update one SDD workflow (e.g., sdd-apply) to use the minimal prompt
4. Test and verify functionality and token savings
5. Roll out to other SDD workflows (sdd-spec, sdd-tasks, sdd-verify, etc.)

This optimization aligns with the goal of reducing token overhead by sending only what is strictly necessary for each subagent to perform its specific task, leveraging the fact that SDD agents are highly specialized.
