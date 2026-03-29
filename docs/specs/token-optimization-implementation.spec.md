# Token Optimization Implementation Spec: Lazy Skills Loading for OpenCode Subagents

## Problem Statement

Each subagent request in OpenCode reconstructs the entire system prompt from scratch, including the skills listing (~1,853 tokens) even when the subagent doesn't need or use skills. This creates significant token overhead in workflows with multiple subagent invocations.

## Solution Implemented

Implemented two key optimizations:

1. **Lazy Skills Loading with Caching**: Cache the skills listing per agent type to avoid regenerating it on every request
2. **Agent-Mode Based Skills Loading**: Only load skills for agents that actually need them (primary agents or those without skill permissions disabled)

## Detailed Implementation Steps

### Step 1: Modify SystemPrompt.skills() for Lazy Loading

**File**: `/packages/opencode/src/session/system.ts`

**Changes**:

1. Add a static cache for skills listings
2. Check if skills are disabled via permissions before processing
3. Return cached skills if available for the agent type
4. Generate and cache skills listing if not present

**Code Changes**:

```typescript
export namespace SystemPrompt {
  // ADD: Cache for skills listing keyed by agent name
  private static skillsCache = new Map<string, string>();

  export function provider(model: Provider.Model) {
    // ... existing code unchanged ...
  }

  export async function environment(model: Provider.Model) {
    // ... existing code unchanged ...
  }

  // MODIFY: Add lazy loading and caching to skills function
  export async function skills(agent: Agent.Info) {
    // Check if skills are disabled for this agent via permissions
    if (Permission.disabled(["skill"], agent.permission).has("skill")) return

    // ADD: Check cache first - use agent name as key since skills are agent-agnostic
    const cacheKey = agent.name
    if (this.skillsCache.has(cacheKey)) {
      return this.skillsCache.get(cacheKey)
    }

    // ... existing skills generation code ...

    // MODIFY: Cache for future requests of the same agent type
    this.skillsCache.set(cacheKey, result)
    return result
  }
}
```

### Step 2: Optimize Prompt Construction Based on Agent Mode

**File**: `/packages/opencode/src/session/prompt.ts`

**Location**: Around line 682 where the system prompt is constructed

**Changes**:
Modify the system prompt assembly to only include skills for agents that need them:

- Primary agents (mode: "primary") always get skills
- Any agent (including subagents) without skill permissions disabled gets skills
- Subagents with skill permissions disabled (default for explore, general, etc.) omit skills

**Code Changes**:

```typescript
// Build system prompt, adding structured output instruction if needed
const skills = await SystemPrompt.skills(agent)
const system = [
  ...(await SystemPrompt.environment(model)),
  // MODIFY: Only include skills for primary agents or agents that haven't disabled skills
  ...(agent.mode === "primary" || !Permission.disabled(["skill"], agent.permission).has("skill")
    ? skills
      ? [skills]
      : []
    : []),
  ...(await InstructionPrompt.system()),
]
```

## Verification Steps

### Manual Verification:

1. Create a test skill directory:

   ```bash
   mkdir -p .opencode/skill/test-skill
   echo -e "---\nname: test-skill\ndescription: Test skill.\n---\n\n# Test skill" > .opencode/skill/test-skill/SKILL.md
   ```

2. Create a test agent configuration with skill:deny:

   ```json
   {
     "agent": {
       "test-agent": {
         "permission": {
           "skill": "deny"
         }
       }
     }
   }
   ```

   Save as `.opencode/opencode.json`

3. Run the system tests to verify implementation:
   ```bash
   bun test test/session/system.test.ts
   ```

### Expected Test Results:

- `skills output is sorted by name and stable across calls`: PASS
- `skills caching works across different agent instances of same type`: PASS
- `skills are omitted for agents with skill:deny permission`: PASS
- `skills are included for primary agents without skill:deny`: PASS
- `skills are omitted for subagents with default explore configuration`: PASS

## Expected Token Savings

Based on the OPENCODE_TOKEN_OPTIMIZATION.md guide:

| Optimization                                       | Tokens Saved | Applies To               |
| -------------------------------------------------- | ------------ | ------------------------ |
| Skills deny in subagents                           | ~1,853       | Each session of subagent |
| **Total per subagent session**                     | **~1,853**   |                          |
| **Total per SDD workflow** (5 subagents × 3 steps) | **~27,795**  |                          |

Note: This is conservative - actual savings are higher when combining with other optimizations from the guide (MCP tool reduction, AGENTS.md splitting, etc.) for a total of ~7,085 tokens per subagent session.

## Files Modified

1. **`/packages/opencode/src/session/system.ts`**:
   - Added skills caching mechanism
   - Maintained existing functionality for skills generation

2. **`/packages/opencode/src/session/prompt.ts`**:
   - Modified system prompt construction to conditionally include skills based on agent mode and permissions

3. **`/packages/opencode/test/session/system.test.ts`**:
   - Updated existing tests
   - Added new tests to verify lazy loading and permission-based filtering

## Reproducible Steps for Another Agent

To reproduce this implementation:

1. **Clone the OpenCode repository**:

   ```bash
   git clone https://github.com/anomalyco/opencode.git
   cd opencode
   ```

2. **Modify SystemPrompt.skills()** (`src/session/system.ts`):
   - Add the static skillsCache declaration
   - Add permission check at the start of the function
   - Add cache lookup before skills generation
   - Add cache storage after skills generation

3. **Modify prompt construction** (`src/session/prompt.ts`):
   - Locate the system prompt assembly around line 682
   - Replace the unconditional skills inclusion with the conditional logic based on agent.mode and permission checks

4. **Update tests** (`test/session/system.test.ts`):
   - Keep existing "skills output is sorted by name" test
   - Add test for skills caching across agent instances
   - Add test for skills omission with skill:deny permission
   - Update primary agent test to verify skills inclusion
   - Add/update subagent test to verify skills omission (explore agent by default has skills denied)

5. **Run tests to verify**:

   ```bash
   bun test test/session/system.test.ts
   ```

6. **Verify token savings** by comparing system prompt sizes before and after implementation for various agent types.

## Backward Compatibility

- No breaking changes to existing APIs
- All existing agent configurations continue to work
- Performance improvement is purely additive (caching)
- Behavioral change: subagents with default configurations (explore, general, etc.) no longer receive skills listing in their system prompt, which is the intended optimization

## Dependencies

- Requires TypeScript
- Uses existing Effect, Permission, and Skill systems
- No new external dependencies
