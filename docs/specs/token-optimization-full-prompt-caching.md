# Token Optimization: Full System Prompt On-Demand Loading with Caching

## Problem

Even with lazy skills loading, OpenCode still reconstructs most of the system prompt on every request:

- Agent/base prompt (~2,100 tokens)
- Environment block (~60 tokens) - changes with working directory/git status
- Instruction prompt (~variable tokens) - changes with project AGENTS.md
- Plugin hooks (~835 tokens) - can change based on session state

While skills loading optimization saves ~1,853 tokens when disabled, the majority of the prompt overhead remains.

## Solution

Implement true on-demand loading of the entire system prompt by:

1. Identifying all inputs that affect the system prompt
2. Creating a cache key based on these inputs
3. Computing and caching the complete system prompt when inputs change
4. Returning the cached prompt when inputs are unchanged

## Implementation

### 1. Identify System Prompt Inputs

From `/packages/opencode/src/session/prompt.ts` lines 682-688, the system prompt consists of:

- `SystemPrompt.environment(model)` - depends on model and environment state (working directory, git status, platform, date)
- `SystemPrompt.skills(agent)` - depends on agent (already optimized with lazy loading)
- `InstructionPrompt.system()` - depends on project AGENTS.md and global AGENTS.md
- Plugin hook "system.transform" - depends on session state and plugins

### 2. Create System Prompt Cache Service

Create a new service in `/packages/opencode/src/session/system-prompt-cache.ts`:

```typescript
import { Effect, Layer } from "effect"
import { SystemPrompt } from "./system"
import { InstructionPrompt } from "./instruction"
import { Plugin } from "@/plugin"
import { Instance } from "../project/instance"
import { Provider } from "@/provider/provider"
import { Agent } from "@/agent/agent"
import { Session } from "."

export namespace SystemPromptCache {
  export interface Interface {
    readonly get: (input: { agent: Agent.Info; model: Provider.Model; sessionID: string }) => Effect.Effect<string>
  }

  type State = {
    cache: Map<string, { prompt: string; timestamp: number }>
    maxAgeMs: number // Cache entries older than this are considered stale
  }

  export const layer: Layer.Layer<
    Interface,
    never,
    | typeof SystemPrompt.Layer
    | typeof InstructionPrompt.Layer
    | typeof Plugin.Layer
    | typeof Instance.Layer
    | typeof Provider.Layer
    | typeof Agent.Layer
    | typeof Session.Layer
  > = Layer.effect(
    Interface,
    Effect.gen(function* () {
      const systemPrompt = yield* SystemPrompt.Service
      const instructionPrompt = yield* InstructionPrompt.Service
      const plugin = yield* Plugin.Service
      const instance = yield* Instance.Service
      const provider = yield* Provider.Service
      const agent = yield* Agent.Service
      const session = yield* Session.Service

      const state = yield* Effect.sync(() => ({
        cache: new Map<string, { prompt: string; timestamp: number }>(),
        maxAgeMs: 5 * 60 * 1000, // 5 minutes - adjust based on how frequently inputs change
      })) satisfies State

      // Generate cache key from all inputs that affect the system prompt
      const generateCacheKey = Effect.fn("SystemPromptCache.generateCacheKey")(function* (input: {
        agent: Agent.Info
        model: Provider.Model
        sessionID: string
      }) {
        // Get environment details
        const environment = yield* systemPrompt.environment(input.model)

        // Get skills (will use cached version from SystemPrompt.skills if available)
        const skills = yield* systemPrompt.skills(input.agent)

        // Get instruction prompt
        const instruction = yield* instructionPrompt.system()

        // Create a string representation of all variable inputs
        return JSON.stringify({
          agent: input.agent.name,
          model: `${input.model.providerID}/${input.model.api.id}`,
          environment: environment.join("\n"),
          skills: skills ?? "",
          instruction: instruction,
          // Include session-specific data that might affect plugins
          sessionID: input.sessionID,
          // Include current working directory and git status for environment changes
          directory: yield* instance.directory,
          worktree: yield* instance.worktree,
          // Platform and date are part of environment but included explicitly for clarity
          platform: process.platform,
          date: new Date().toDateString(),
        })
      })

      // Get cached prompt or compute and cache new one
      const get = Effect.fn("SystemPromptCache.get")(function* (input: {
        agent: Agent.Info
        model: Provider.Model
        sessionID: string
      }) {
        const cacheKey = yield* generateCacheKey(input)
        const now = Date.now()

        // Check if we have a valid cached entry
        const cached = state.cache.get(cacheKey)
        if (cached && now - cached.timestamp < state.maxAgeMs) {
          return cached.prompt
        }

        // Compute new system prompt
        const [providerPrompt, environmentParts, skillsPart, instructionPart] = yield* Effect.all([
          systemPrompt.provider(input.model),
          systemPrompt.environment(input.model),
          systemPrompt.skills(input.agent),
          instructionPrompt.system(),
        ])

        // Construct the base system prompt
        let system = [
          ...providerPrompt,
          ...environmentParts,
          ...(skillsPart ? [skillsPart] : []),
          ...(instructionPart ? [instructionPart] : []),
        ].join("\n")

        // Apply plugin transformations
        const transformed = yield* plugin.trigger(
          "experimental.chat.system.transform",
          { model: input.model },
          { system },
        )

        // Cache the result
        state.cache.set(cacheKey, { prompt: transformed, timestamp: now })

        // Optional: cleanup old cache entries (simple LRU-like behavior)
        if (state.cache.size > 100) {
          // Remove oldest entries when cache gets too large
          const entries = Array.from(state.cache.entries())
            .sort(([, a], [, b]) => a.timestamp - b.timestamp)
            .slice(0, 50) // Remove oldest 50 entries
          for (const [key] of entries) {
            state.cache.delete(key)
          }
        }

        return transformed
      })

      return Service.of({ get })
    }),
  )
}
```

### 3. Modify Session Prompt to Use Cache

Update `/packages/opencode/src/session/prompt.ts` to use the new cache service:

```typescript
// Add import
import { SystemPromptCache } from "./system-prompt-cache"

// In the prompt construction section (around line 682):
const systemPromptCache = yield * SystemPromptCache.Service
const system =
  yield *
  systemPromptCache.get({
    agent,
    model,
    sessionID: input.sessionID,
  })

// The rest of the prompt processing remains the same
const result = await processor.process({
  user: lastUser,
  agent,
  permission: session.permission,
  abort,
  sessionID,
  system, // <-- Now using cached system prompt
  // ... rest unchanged
})
```

### 4. Update Dependencies

Add the new layer to the appropriate provider in `/packages/opencode/src/session/index.ts` or wherever services are composed.

## Benefits

- **True on-demand loading**: System prompt is only computed when its inputs actually change
- **Significant savings**: In workflows where the same agent/model combination is used repeatedly with minimal environmental changes, the system prompt is computed once and reused
- **Particularly effective for**:
  - Sequences of subagents of the same type
  - Interactive sessions where working directory changes infrequently
  - Workflows with consistent model usage

## Cache Invalidation Strategy

The cache invalidates based on:

1. Time-based expiration (default 5 minutes)
2. Changes to any of the inputs:
   - Agent type
   - Model provider/id
   - Working directory
   - Git repository status
   - Platform (unlikely to change mid-session)
   - Date (changes daily)
   - Session ID (different sessions get different caches)
   - Any changes that would affect plugin system.transform hook

## Implementation Complexity

Medium: Requires creating a new service and modifying the prompt construction flow, but leverages existing Effect patterns used throughout the codebase.

## Testing Requirements

1. Verify that identical requests return cached prompts
2. Verify that changing inputs (directory, agent, etc.) produces new prompts
3. Measure token savings in typical workflows
4. Ensure plugin hooks still receive and can transform the system prompt
5. Verify cache doesn't grow indefinitely (cleanup implementation)
