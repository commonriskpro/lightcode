# Token Optimization: Lazy Skills Loading and Agent-Mode Based Prompt Construction

## Problem

Each subagent request in OpenCode reconstructs the entire system prompt from scratch, including:

- Agent/base prompt (~2,100 tokens)
- Environment block (~60 tokens)
- Skills listing (~1,853 tokens) - loaded for every agent regardless of need
- Instruction prompt (~variable tokens)
- Plugin hooks (~835 tokens)

This results in significant token overhead, especially in workflows with multiple subagent invocations.

## Solution

Implement two optimizations:

1. **Lazy Skills Loading with Caching**: Cache the skills listing per agent type to avoid regenerating it on every request.
2. **Agent-Mode Based Skills Loading**: Only load skills for agents that actually need them (primary agents or those without skill permissions disabled).

## Implementation

### 1. Modify SystemPrompt.skills() for Lazy Loading

In `/packages/opencode/src/session/system.ts`:

```typescript
export namespace SystemPrompt {
  // Cache for skills listing keyed by agent name
  private static skillsCache = new Map<string, string>();

  export async function skills(agent: Agent.Info) {
    // Check if skills are disabled for this agent via permissions
    if (Permission.disabled(["skill"], agent.permission).has("skill")) return;

    // Check cache first - use agent name as key since skills are agent-agnostic
    const cacheKey = agent.name;
    if (this.skillsCache.has(cacheKey)) {
      return this.skillsCache.get(cacheKey);
    }

    // Generate skills listing if not in cache
    const list = await Skill.available(agent);
    const result = [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
      Skill.fmt(list, { verbose: true }),
    ].join("\n");

    // Cache for future requests of the same agent type
    this.skillsCache.set(cacheKey, result);
    return result;
  }
}
```

### 2. Optimize Prompt Construction in SessionPrompt

In `/packages/opencode/src/session/prompt.ts`, modify the system prompt assembly (around line 682):

```typescript
const skills = await SystemPrompt.skills(agent)
const system = [
  ...(await SystemPrompt.environment(model)),
  // Only include skills for primary agents or agents that haven't disabled skills
  ...(agent.mode === "primary" || !Permission.disabled(["skill"], agent.permission).has("skill")
    ? skills
      ? [skills]
      : []
    : []),
  ...(await InstructionPrompt.system()),
]
```

## Configuration

Users can further optimize by disabling skills for subagents that don't need them in `opencode.json`:

```json
{
  "agent": {
    "sdd-apply": {
      "permission": {
        "skill": "deny"
      }
    },
    "sdd-spec": {
      "permission": {
        "skill": "deny"
      }
    }
  }
}
```

## Benefits

- **Per subagent with skills disabled**: ~1,853 tokens saved (skills listing omitted entirely)
- **Per agent type after first request**: Skills listing generated once and cached
- **Typical SDD workflow** (5 subagents × 3 steps):
  - Without optimization: ~20k overhead × 15 requests = ~300k tokens
  - With optimization: ~13k overhead × 15 requests = ~195k tokens
  - **Savings: ~105k tokens per workflow**

## Edge Cases

- Cache invalidation: Currently, skills are considered static for the session. If skills can change at runtime, we would need a cache invalidation strategy (e.g., based on skill directory timestamps).
- Agent name changes: Uses agent.name as cache key, which is stable for built-in agents. Custom agents with the same name would share the cache (acceptable since skills are agent-agnostic).

## Testing

1. Verify that skills listing is only generated once per agent type in a session
2. Confirm that agents with `"skill": "deny"` in permissions receive no skills component
3. Ensure primary agents still receive skills listing
4. Measure token reduction in typical workflows
