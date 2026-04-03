# Task Completion: Token Optimization for OpenCode Subagents

## Overview

Successfully implemented token optimization for OpenCode subagents by:

1. Adding lazy loading with caching for skills listing
2. Implementing agent-mode based skills filtering in system prompt construction

## Changes Made

### 1. SystemPrompt.skills() Lazy Loading with Caching

**File**: `/packages/opencode/src/session/system.ts`

- Added a static cache (`skillsCache`) keyed by agent name
- Added early return when skills are disabled via permissions (`Permission.disabled(["skill"], agent.permission).has("skill")`)
- Return cached skills if available for the agent type
- Generate and cache skills listing only on first request per agent type

### 2. Agent-Mode Based Skills Filtering

**File**: `/packages/opencode/src/session/prompt.ts`

- Modified system prompt construction (around line 682)
- Skills are only included for:
  - Primary agents (`agent.mode === "primary"`)
  - OR agents that haven't disabled skills via permissions
- Subagents with default configurations (like explore, general) that have skills denied via permissions now omit the ~1,853 token skills listing

### 3. Test Updates

**File**: `/packages/opencode/test/session/system.test.ts`

- Updated existing tests to reflect that explore agent by default has skills denied
- Added tests for:
  - Skills caching across agent instances
  - Skills omission for agents with skill:deny permission
  - Skills inclusion for primary agents without skill:deny
  - Skills omission for subagents with default explore configuration

## Token Savings Achieved

Based on the OPENCODE_TOKEN_OPTIMIZATION.md guide:

- **Per subagent with skills disabled**: ~1,853 tokens saved (skills listing omitted entirely)
- **Per agent type after first request**: Skills listing generated once and cached
- **Typical SDD workflow** (5 subagents × 3 steps): ~27,795 tokens saved
- **Combined with other optimizations** from the guide: Up to ~7,085 tokens per subagent session

## Verification

All tests pass:

- ✅ Skills output is sorted by name and stable across calls
- ✅ Skills caching works across different agent instances of same type
- ✅ Skills are omitted for agents with skill:deny permission
- ✅ Skills are included for primary agents without skill:deny
- ✅ Skills are omitted for subagents with default explore configuration

## Next Steps for Further Optimization

As outlined in our orchestrator-driven optimization spec, future work could include:

1. Having the orchestrator construct minimal, task-specific system prompts for each subagent
2. Sending only essential environment variables and specific skill references (@skillfile) instead of full listings
3. Particularly beneficial for SDD agents which are highly specialized for single tasks

## Files Modified

1. `/packages/opencode/src/session/system.ts` - Core lazy skills loading implementation
2. `/packages/opencode/src/session/prompt.ts` - Agent-mode based skills filtering
3. `/packages/opencode/test/session/system.test.ts` - Updated test suite

The implementation is complete, tested, and ready for use. All primary objectives have been met.
