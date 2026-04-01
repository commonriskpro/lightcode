# Comparativa Detallada: sdd-apply vs build Agent

## Arquitectura Actual

### sdd-apply (Fork) — El Implementador Disciplinado

**Paradigma**: Implementación siguiendo specs y design strictamente.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SDD-APPLY WORKFLOWS                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  STANDARD MODE:                                                      │
│  Read spec → Read design → Write code → Mark done                   │
│                                                                      │
│  TDD MODE:                                                          │
│  ┌────────────────────────────────────────┐                         │
│  │ 1. RED    → Write failing test FIRST  │                         │
│  │ 2. GREEN  → Minimum code to pass      │                         │
│  │ 3. REFACTOR → Clean up, still passes  │                         │
│  └────────────────────────────────────────┘                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Features únicas**:
- Task marking (actualiza tasks.md)
- Design deviation tracking
- TDD cycle enforcement
- Files changed table

### build Agent (Upstream) — El Libertario

**Paradigma**: Ejecución libre sin metodología.

```
┌─────────────────────────────────────────────────────────────┐
│                    BUILD AGENT                              │
├─────────────────────────────────────────────────────────────┤
│  ✅ Full tool access                                        │
│  ✅ Puede delegar a sub-agents                              │
│  ⚠️  No TDD enforcement                                     │
│  ⚠️  No task tracking                                       │
│  ⚠️  No deviation tracking                                  │
│  ⚠️  Sin specs/design como guía                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Feature Comparison Matrix

| Feature | sdd-apply | build | Winner |
|---------|-----------|-------|--------|
| **TDD support** | ✅ RED→GREEN→REFACTOR | ❌ No | sdd-apply |
| **Task marking** | ✅ Yes | ❌ No | sdd-apply |
| **Deviation tracking** | ✅ Yes | ❌ No | sdd-apply |
| **Files changed table** | ✅ Yes | ❌ No | sdd-apply |
| **Design following** | ✅ Required | ❌ Optional | sdd-apply |
| **Spec referencing** | ✅ Required | ❌ No | sdd-apply |
| **TDD enforcement** | ✅ Yes | ❌ No | sdd-apply |
| **Code patterns match** | ✅ Required | ❌ No | sdd-apply |
| **Implementation report** | ✅ Detailed | ❌ No | sdd-apply |
| **Full tool access** | ⚠️ Configurable | ✅ Yes | build |
| **Flexibilidad** | ⚠️ Rígido | ✅ Yes | build |
| **Can delegate** | ✅ Yes | ✅ Yes | Tie |

---

## Análisis Detallado

### 1. TDD Cycle

**sdd-apply tiene TDD enforcement**:

```markdown
## TDD Workflow (REQUIRED when TDD detected)

FOR EACH TASK:
├── 1. RED — Write failing test FIRST
│   └── Test must FAIL before proceeding
├── 2. GREEN — Minimum code to pass
│   └── Only what's needed
└── 3. REFACTOR — Clean up
    └── Still passes
```

**build upstream NO tiene** concepto de TDD.

### 2. Design Deviation Tracking

**sdd-apply tracks deviations**:

```markdown
### Deviations from Design
| Decision | Expected | Actual | Reason |
|----------|----------|--------|--------|
| Use REST API | /api/users | /api/v1/users | Versioning |

If deviation found → Report back immediately
```

**build upstream no trackea** deviations.

### 3. Implementation Progress Report

**sdd-apply genera**:

```markdown
## Implementation Progress

**Change**: {name}
**Mode**: {TDD | Standard}

### Completed Tasks
- [x] 1.1 Task description
- [x] 1.2 Task description

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| src/x.ts | Created | Feature X |
| src/y.ts | Modified | Updated Y |

### Tests (TDD mode only)
| Task | Test File | RED | GREEN | REFACTOR |
|------|-----------|-----|-------|----------|
| 1.1 | x.test.ts | ✅ | ✅ | ✅ |

### Deviations
{None | List}

### Issues Found
{None | List}

### Remaining Tasks
- [ ] 2.1 Next task
```

### 4. Task Marking

**sdd-apply actualiza tasks.md**:

```markdown
## tasks.md

## Phase 1: Foundation

- [x] 1.1 Create auth middleware  ← Marked complete
- [x] 1.2 Add AuthConfig           ← Marked complete
- [ ] 1.3 Add auth routes          ← Still pending
```

---

## Features de Upstream a Integrar en sdd-apply

### 1. Remote Execution

**Upstream tiene**: `AgentSpawn({ remote: "user@host" })`

**Agregar a sdd-apply**:

```markdown
## NEW: Remote Implementation

Si el change requiere trabajo en remote:

```
REMOTE IMPLEMENTATION:
1. SSH al remote host
2. git pull latest
3. Apply changes en contexto remoto
4. Push cuando verify pasa
5. Reportar resultados
```

**Trigger**: `/sdd-apply remote:user@host change-name`
```

### 2. Worktree Isolation

**Agregar**:

```markdown
## NEW: Worktree Implementation

Para cambios riesgosos:

```
WORKTREE IMPLEMENTATION:
1. git worktree add ../sdd-{change}
2. Apply changes en worktree
3. Run verify en worktree
4. Si PASS → merge al main
5. Si FAIL → discard worktree
```

**Trigger**: Automatic para cambios > 5 tasks
```

### 3. Parallel Task Implementation

**Upstream puede**: Spawn sub-agents en paralelo.

**Agregar a sdd-apply**:

```markdown
## NEW: Parallel Implementation

Para tasks independientes, usa delegate:

```
PARALLEL TASKS:
├── Phase 1.1 + 1.2: Independiente → Delegate a sub-agent
├── Phase 1.3: Depende de 1.1 → Wait
└── Aggregate resultados
```

**Criterio**: Tasks sin dependencias pueden ser paralelas.
```

### 4. Build/Test on Change

**Upstream tiene**: Feedback loop rápido.

**Agregar a sdd-apply Step 3b**:

```markdown
## After Each Task (Standard Mode)

```bash
# Después de cada archivo modificado:
1. Run relevant tests: npm test -- --testPathPattern={file}
2. Run linting: npm run lint
3. Run type check: tsc --noEmit

Solo continua si todo pasa.
```

## NEW: Incremental Verification

```typescript
// Después de cada task completada:
const result = await bash(`npm test -- --testPathPattern={taskFile}`)

if (result.exitCode !== 0) {
  // STOP — task no pasó tests
  report_back_to_orchestrator({
    status: "blocked",
    reason: "Tests failing after task N",
    evidence: result.output
  })
}
```
```

---

## Refactored sdd-apply SKILL.md

```markdown
---
name: sdd-apply
description: >
  Implement tasks following specs and design strictly.
  Supports TDD mode with RED→GREEN→REFACTOR.
  Tracks deviations and reports progress.
---

## Purpose

Eres un sub-agent responsable de IMPLEMENTACIÓN. Recibes tasks específicas 
y las implementas siguiendo specs y design estrictamente.

**TDD es requerido** cuando el proyecto usa TDD.

## Modes

### TDD Mode (RED → GREEN → REFACTOR)

```typescript
FOR EACH TASK:
├── 1. RED: Write failing test
│   └── Test MUST fail before proceeding
├── 2. GREEN: Minimum code to pass
│   └── Only what's needed
├── 3. REFACTOR: Clean up
│   └── Still passes
└── 4. Mark task [x] in tasks.md
```

### Standard Mode

```typescript
FOR EACH TASK:
├── Read spec scenario
├── Read design decision
├── Read existing code patterns
├── Write code
├── Run relevant tests
├── Mark task [x] in tasks.md
└── Report if blocked
```

## NEW: Incremental Verification

After each file change:

```bash
# Run relevant tests
npm test -- --testPathPattern={file}

# If FAIL → STOP and report
```

## NEW: Parallel Tasks

For independent tasks:

```typescript
const results = await Promise.all([
  delegate("sdd-apply-phase", { phase: "1.1-1.2" }),  // Independent
  delegate("sdd-apply-phase", { phase: "1.3-1.4" })   // Independent
])
```

## Deviation Tracking (REQUIRED)

```markdown
### Deviations from Design

If implementation differs from design:
├── STOP immediately
├── Document the deviation
├── Explain why
└── Wait for approval to continue

DO NOT silently deviate.
```

## Implementation Report (REQUIRED)

```markdown
## Implementation Progress

**Change**: {name}
**Mode**: {TDD | Standard}
**Tasks**: {N}/{total} complete

### Files Changed
| File | Action | Lines | Description |
|------|--------|-------|-------------|
| src/x.ts | +45/-2 | 43 | Feature X |

### Tests (TDD)
| Task | RED | GREEN | REFACTOR |
|------|-----|-------|----------|
| 1.1 | ✅ | ✅ | ✅ |

### Deviations
{None | List with rationale}

### Issues Found
{None | List}

### Remaining Tasks
- [ ] {next task}
```

## Persistence

1. Mark tasks [x] in tasks.md
2. Persist `apply-progress` to Engram/OpenSpec
3. Save deviation notes if any

## Return Envelope

```markdown
**Status**: {success/partial/blocked}
**Tasks**: {N}/{total} complete
**Files**: {N} changed
**Verdict**: {Ready for verify | Blocked by X}
**Artifacts**: [apply-progress]
**Risks**: [list or "None"]
```
