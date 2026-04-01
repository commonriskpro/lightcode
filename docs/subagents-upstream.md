# Upstream Subagents - Complete Reference

## Overview

Claude Code (upstream) implements a sophisticated multi-agent system with specialized agents for different tasks.

---

## Agent Architecture

### Agent Types

| Mode | Description | Example |
|------|-------------|---------|
| `primary` | Main execution agent | `build`, `plan`, `sdd-orchestrator` |
| `subagent` | Specialized worker | `explore`, `verify`, `general` |
| `all` | Can be both primary and subagent | N/A |

### Built-in Agent List

| Agent Name | Mode | Description |
|------------|------|-------------|
| `build` | primary | Default executor for general tasks |
| `plan` | primary | Planning mode (read-only, no edits) |
| `explore` | subagent | Fast read-only codebase exploration |
| `general` | subagent | General-purpose worker for arbitrary tasks |
| `verify` | subagent | Adversarial testing specialist |
| `title` | primary | Session title generation |
| `summary` | primary | Session summarization |
| `compaction` | primary | Context compaction agent |

---

## 1. Explore Agent (`explore`)

**Purpose**: Fast read-only code exploration using embedded tools.

**Capabilities**:
- Uses `BFS` (Breadth-First Search) for fast file finding
- Uses `ugrep` for ultra-fast content searching
- Read-only operations only
- Optimized for quick context gathering

**Tool Allowlist**:
```
Read, Grep, Glob, Bash (ls, find only), Task (for sub-agents)
```

**Use Cases**:
- Investigating codebase structure
- Finding relevant files for a task
- Gathering context without making changes

**Speed**: Ultra-fast (10x faster than standard glob/grep)

---

## 2. Plan Agent (`plan`)

**Purpose**: Software architecture and implementation planning.

**Capabilities**:
- Read-only mode (no edit/write operations)
- Can use all read tools
- Special planning instructions in system prompt
- Focuses on design decisions and tradeoffs

**Tool Allowlist**:
```
Read, Grep, Glob, Bash, Task, WebFetch, WebSearch
```

**Use Cases**:
- Initial project planning
- Architecture design reviews
- Technical decision documentation

---

## 3. Verification Agent (`verify`)

**Purpose**: Adversarial testing specialist that produces structured verdicts.

**Capabilities**:
- Generates PASS/FAIL/PARTIAL verdicts
- Tests code against specifications
- Identifies edge cases and failure modes
- Can spawn sub-agents for parallel testing

**Verdict System**:
```typescript
type Verdict = {
  result: 'PASS' | 'FAIL' | 'PARTIAL'
  details: string[]
  recommendations?: string[]
  confidence: number
}
```

**Tool Allowlist**:
```
Read, Grep, Glob, Bash, Edit, Write, Task
```

**Use Cases**:
- Code review automation
- Pre-deployment verification
- Regression testing
- Security audits

---

## 4. General Purpose Agent (`general`)

**Purpose**: Default agent for arbitrary tasks.

**Capabilities**:
- Full tool access (except restricted operations)
- Can delegate to sub-agents
- Standard Claude Code capabilities
- Memory and context management

**Tool Allowlist**:
```
All tools (respects permission rules)
```

**Use Cases**:
- Most development tasks
- Mixed operations (read + write)
- Agent coordination

---

## 5. Build Agent (`build`)

**Purpose**: Default executor for general tasks.

**Capabilities**:
- Full tool access
- Can spawn sub-agents
- Context management
- Session memory

**Tool Allowlist**:
```
All tools (respects permission rules)
```

---

## 6. Title Agent (`title`)

**Purpose**: Session title generation.

**Capabilities**:
- Generates concise session titles
- Based on conversation context
- Used for session listing

---

## 7. Summary Agent (`summary`)

**Purpose**: Session summarization.

**Capabilities**:
- Summarizes conversation context
- Used for compaction
- Extracts key points

---

## 8. Compaction Agent (`compaction`)

**Purpose**: Context compaction for long conversations.

**Capabilities**:
- Summarizes conversation history
- Preserves key context
- Reduces token usage

---

## Agent Teams

### Team Creation

Agents can be organized into teams with:

```typescript
TeamCreate({
  name: "my-team",
  members: ["explorer", "verifier", "implementer"],
  sharedMemory: true,  // Agents share context
  coordination: "sequential" | "parallel"
})
```

### Team Memory

- **Session Memory**: Shared across team members
- **Memory Sync**: Automatic synchronization of findings
- **Snapshots**: Persistent memory across sessions

### Team Communication

- `SendMessage`: Direct agent-to-agent messaging
- `Delegate`: Async task delegation with results
- `Task`: Sync blocking task execution

---

## Background Agents

### Spawning Background Agents

```typescript
Bash("opencode --agent verify --background")
```

### Monitoring Progress

```typescript
TaskList()  // List all background tasks
TaskOutput({taskId: "xxx"})  // Get task progress
TaskStop({taskId: "xxx"})  // Cancel task
```

### Scheduling (Cron)

```typescript
// Create scheduled task
ScheduleCreate({
  cron: "0 9 * * *",  // Daily at 9 AM
  agent: "verify",
  prompt: "Run daily security audit"
})

// List scheduled tasks
ScheduleList()

// Delete scheduled task
ScheduleDelete({id: "xxx"})
```

---

## Worktree Isolation

Agents can be spawned in isolated git worktrees:

```typescript
AgentSpawn({
  name: "feature-x",
  worktree: "feature-x-impl",  // Creates: git worktree add ../feature-x-impl
  prompt: "Implement feature X"
})
```

**Benefits**:
- Isolated file system changes
- No interference with main branch
- Parallel feature development

---

## Remote Agents (CCR)

### Remote Agent Launch

```typescript
AgentSpawn({
  remote: "user@remote-host",
  prompt: "Debug production issue"
})
```

### Session Teleport

Switch between local and remote sessions:

```bash
claude teleconnect ws://remote-host:8080
claude ssh user@remote-host
```

### Mobile Access

- QR code generation for mobile sessions
- WebSocket streaming for real-time interaction

---

## Agent Memory System

### Memory Types

| Type | Scope | Persistence |
|------|-------|-------------|
| Session Memory | Current session | In-memory |
| Team Memory | Team members | Shared storage |
| Memory Snapshots | Across sessions | Persistent |

### Memory Operations

```typescript
// Save observation
MemorySave({
  content: "API design decision: use REST over GraphQL",
  tags: ["architecture", "api"]
})

// Search memory
MemorySearch({
  query: "API design decisions",
  limit: 5
})

// Get specific observation
MemoryGet({
  id: "obs-xxx"
})
```

---

## Agent Configuration

### Settings per Agent

```json
{
  "agent": {
    "build": {
      "model": "claude-sonnet-4-6",
      "maxTokens": 4096,
      "temperature": 0.7
    },
    "explore": {
      "model": "claude-haiku-3",
      "tools": ["Read", "Grep", "Glob"]
    }
  }
}
```

### Permission Rules per Agent

```json
{
  "agent": {
    "verify": {
      "permissions": {
        "allow": ["Bash(npm test)", "Bash(npm run *)"],
        "deny": ["Bash(rm -rf *)", "Write(~/**)"]
      }
    }
  }
}
```

---

## Tool Filtering per Agent

Agents can have restricted tool access:

```typescript
const exploreAgent = {
  name: "explore",
  tools: {
    allowed: ["Read", "Grep", "Glob", "Task"],
    denied: ["Write", "Edit", "Bash"]
  }
}
```

---

## Subagent Spawning Pattern

### Fork Subagents

Recursive parallelization using parent's system prompt cache:

```typescript
// Parent agent spawns children
const results = await Promise.all([
  AgentSpawn({name: "task-1", inheritPrompt: true}),
  AgentSpawn({name: "task-2", inheritPrompt: true}),
  AgentSpawn({name: "task-3", inheritPrompt: true})
])
```

### Sequential Delegation

```typescript
// Delegate with results
const result = await Delegate({
  agent: "verify",
  task: "Verify implementation",
  blocking: true  // Wait for result
})
```

---

## Summary: Agent Capability Matrix

| Capability | build | explore | verify | general |
|------------|-------|---------|--------|---------|
| Read Files | ✅ | ✅ | ✅ | ✅ |
| Write Files | ✅ | ❌ | ✅ | ✅ |
| Execute Bash | ✅ | Limited | ✅ | ✅ |
| Spawn Agents | ✅ | ❌ | ✅ | ✅ |
| Memory Access | ✅ | ✅ | ✅ | ✅ |
| Tool Restriction | No | Yes | No | No |
| Async Execution | ✅ | ❌ | ✅ | ✅ |
| Planning Mode | ❌ | ❌ | ❌ | ❌ |
| Remote Execution | ✅ | ❌ | ✅ | ✅ |
| Worktree Isolation | ✅ | ❌ | ✅ | ✅ |
| Background Tasks | ✅ | ❌ | ✅ | ✅ |
| Scheduling (Cron) | ✅ | ❌ | ✅ | ✅ |

---

## Comparison with Fork SDD Agents

| Feature | Upstream | Fork SDD |
|---------|----------|----------|
| **Orchestration** | Free-form | DAG-enforced |
| **Specs** | No | Delta specs (RFC 2119) |
| **Design docs** | Basic | Structured with rationale |
| **TDD support** | No | RED→GREEN→REFACTOR |
| **Verification** | PASS/FAIL/PARTIAL | Compliance matrix |
| **Persistence** | Session-only | Engram + OpenSpec |
| **Explore speed** | Ultra-fast (BFS) | Medium |
| **Remote agents** | CCR/SSH/Mobile | No |
| **Agent teams** | Advanced | Basic |
| **Worktree isolation** | Yes | No |

---

## References

- Main agent definitions: `src/agents/`
- Agent tool implementations: `src/tools/AgentTool/`
- Agent spawning: `src/services/agents/`
- Team coordination: `src/services/teams/`
