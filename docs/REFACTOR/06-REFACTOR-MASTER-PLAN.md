# Plan Maestro de Refactorización SDD Agents

## Resumen de Features a Integrar

### De Upstream → Fork

| Feature | Prioridad | Impacto | Complejidad |
|---------|-----------|---------|-------------|
| BFS + ugrep para explore | 🔴 CRÍTICA | Alto | Media |
| Remote execution | 🟡 Media | Alto | Alta |
| Worktree isolation | 🟡 Media | Medio | Media |
| Parallel test execution | 🟡 Media | Medio | Media |
| Agent spawning en verify | 🟢 Baja | Medio | Baja |
| Tool restriction per phase | 🟢 Baja | Bajo | Baja |

### De Fork → Upstream (Integración)

| Feature | Recomendación |
|---------|--------------|
| SDD Workflow DAG | Mantener como opcional |
| Delta specs (RFC 2119) | Integrar como skill |
| Compliance matrix | Integrar como skill |
| TDD enforcement | Integrar como skill |
| Artifact persistence | Mantener |

---

## Roadmap de Implementación

### Phase 1: Critical — Speed (Semana 1)

**Objetivo**: Hacer sdd-explore ultra-rápido.

#### 1.1 Import BFS Implementation

```typescript
// packages/opencode/src/tool/bfs.ts

export interface BFSOptions {
  maxDepth?: number
  extensions?: string[]
  exclude?: string[]
  maxFiles?: number
  parallel?: boolean
}

export async function bfs(
  rootDir: string,
  pattern: string,
  options?: BFSOptions
): Promise<string[]>
```

**Ubicación**: `packages/opencode/src/tool/bfs.ts`

**Implementación**:
- Paralelización con worker threads
- Cache de resultados
- Pattern matching optimizado

#### 1.2 Import ugrep (o ripgrep optimizado)

```typescript
// packages/opencode/src/tool/ugrep.ts

export interface UgrepOptions {
  caseSensitive?: boolean
  extensions?: string[]
  maxMatches?: number
}

export async function ugrep(
  pattern: string,
  files: string[],
  options?: UgrepOptions
): Promise<Match[]>
```

**Ubicación**: `packages/opencode/src/tool/ugrep.ts`

#### 1.3 Actualizar sdd-explore SKILL.md

```markdown
## Tool Priority (ENFORCED)

1. BFS → File discovery
2. ugrep → Content search  
3. glob/grep → Fallback
```

---

### Phase 2: Parallelization (Semana 2)

**Objetivo**: Tests y tasks paralelas.

#### 2.1 Implement Parallel Testing en sdd-verify

```typescript
// En sdd-verify, después de Step 5a

if (testSuiteSize > 50) {
  const results = await Promise.all([
    delegate("verify-unit", { pattern: "unit" }),
    delegate("verify-integration", { pattern: "integration" })
  ])
  
  return aggregateResults(results)
}
```

#### 2.2 Implement Parallel Tasks en sdd-apply

```typescript
// En sdd-apply, detectar tasks independientes

const independentTasks = tasks.filter(t => !t.hasDependencies)
const dependentTasks = tasks.filter(t => t.hasDependencies)

if (independentTasks.length > 2) {
  await Promise.all(
    independentTasks.map(t => delegate("apply-task", { task: t }))
  )
}
```

---

### Phase 3: Remote + Worktree (Semana 3)

**Objetivo**: Soporte para remote execution.

#### 3.1 Add Remote Support

```typescript
// packages/opencode/src/agent/remote-executor.ts

export async function executeRemote(
  host: string,
  agent: string,
  prompt: string
): Promise<Result>
```

**Trigger**: `/sdd-apply remote:user@host change-name`

#### 3.2 Add Worktree Support

```typescript
// packages/opencode/src/git/worktree.ts

export async function createWorktree(
  branchName: string
): Promise<string> // worktree path

export async function mergeWorktree(
  worktreePath: string
): Promise<void>

export async function deleteWorktree(
  worktreePath: string
): Promise<void>
```

**Trigger**: Automatic para cambios > 5 tasks

---

### Phase 4: Tool Restrictions (Semana 4)

**Objetivo**: Restricciones por fase.

#### 4.1 Define Tool Config per Phase

```typescript
// packages/opencode/src/agent/phase-tools.ts

export const PHASE_TOOLS: Record<string, string[]> = {
  "sdd-explore": ["read", "grep", "glob", "task", "bfs", "ugrep"],
  "sdd-verify": ["read", "grep", "glob", "bash", "task"],
  "sdd-apply": ["read", "write", "edit", "bash", "task"],
  "sdd-design": ["read", "grep", "glob", "task"]
}
```

#### 4.2 Enforce Tool Restrictions

```typescript
// En agent executor

function applyToolRestrictions(phase: string, tools: Tool[]): Tool[] {
  const allowed = PHASE_TOOLS[phase] || []
  return tools.filter(t => allowed.includes(t.name))
}
```

---

## Skills a Refactorizar

### v2.0 Roadmap

| Skill | Cambios | Prioridad |
|-------|---------|----------|
| sdd-explore | Add BFS/ugrep, speed requirements | 🔴 Alta |
| sdd-verify | Add parallel testing, edge case gen | 🟡 Media |
| sdd-apply | Add incremental verify, parallel tasks | 🟡 Media |
| sdd-propose | Add impact analysis | 🟢 Baja |
| sdd-design | Add size budget enforcement | 🟢 Baja |
| sdd-tasks | Add dependency detection | 🟢 Baja |
| sdd-orchestrator | Add remote/worktree meta-commands | 🟡 Media |

---

## Migración Gradual

### Step 1: Fork Actual

```markdown
# Estado Actual
- sdd-* agents con workflow SDD
- Artifact persistence (engram/openspec)
- TDD support en sdd-apply
- Compliance matrix en sdd-verify
- Sin BFS/ugrep
- Sin remote execution
```

### Step 2: +BFS/ugrep

```markdown
# Estado v2.1
- [ ] Import BFS implementation
- [ ] Import ugrep
- [ ] Update sdd-explore con tool priority
- [ ] Add speed requirements al skill
```

### Step 3: +Parallelization

```markdown
# Estado v2.2
- [ ] Add parallel test en sdd-verify
- [ ] Add parallel tasks en sdd-apply
- [ ] Add test suite size detection
```

### Step 4: +Remote/Worktree

```markdown
# Estado v2.3
- [ ] Add remote executor
- [ ] Add worktree support
- [ ] Add /sdd-remote meta-command
- [ ] Add /sdd-worktree meta-command
```

### Step 5: +Tool Restrictions

```markdown
# Estado v2.4
- [ ] Define PHASE_TOOLS config
- [ ] Enforce tool restrictions
- [ ] Add tool audit logging
```

---

## Testing Plan

### Unit Tests

```typescript
describe("BFS", () => {
  it("finds files in parallel")
  it("respects maxDepth")
  it("excludes patterns correctly")
})

describe("ugrep", () => {
  it("returns matches with context")
  it("handles large files")
})
```

### Integration Tests

```typescript
describe("sdd-explore v2", () => {
  it("completes exploration in < 5 seconds")
  it("uses BFS for file discovery")
  it("returns structured output")
})
```

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| sdd-explore speed | < 5s for basic | Timer en skill |
| sdd-verify parallel | 2x speedup | Compare sequential vs parallel |
| Remote execution | Works for SSH | Manual test |
| Worktree isolation | No main branch polution | git status check |

---

## Rollback Plan

Si algo falla:

1. **BFS/ugrep**: Deshabilitar via feature flag
   ```typescript
   const USE_BFS = process.env.SDD_USE_BFS !== "false"
   ```

2. **Parallelization**: Volver a sequential
   ```typescript
   const USE_PARALLEL = process.env.SDD_USE_PARALLEL !== "false"
   ```

3. **Remote/Worktree**: Deshabilitar meta-commands
   - Remover /sdd-remote y /sdd-worktree de orchestrator

---

## Documentation Updates

| Document | Cambios |
|----------|---------|
| README-FORK.md | Agregar "Speed: BFS/ugrep powered" |
| docs/ | Actualizar con v2.0 features |
| gentle-ai/AGENTS.md | Add remote/worktree sections |
| gentle-ai/skills/*/SKILL.md | Update todos |

---

## Dependencies

| Dependencia | Para qué | Estado |
|-------------|----------|--------|
| worker_threads | BFS parallel | ✅ Node.js built-in |
| @upstash/ugrep | Ugrep wrapper | ⚠️ Need to verify |
| simple-git | Worktree operations | ⚠️ Need to add |
| ssh2 | Remote execution | ⚠️ Need to add |
