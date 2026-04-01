# SDD Agents (Fork) vs Upstream Agents — Comparativa Completa

## Resumen Ejecutivo

| Aspecto | SDD Agents (Fork) | Upstream Agents |
|---------|-------------------|-----------------|
| **Paradigma** | Workflow basado en fases | Herramientas individuales |
| **Orquestación** | Orchestrator + Sub-agents | Agentes independientes |
| **Persistencia** | Engram + OpenSpec | Sesiones + Snapshots |
| **Verificación** | PASS con veredictos estructurados | Verdictos PASS/FAIL/PARTIAL |
| **Documentación** | Contratos de fase rígidos | Documentación dispersa |
| **Estado** | Pipeline DAG bien definido | Flujo libre |

---

## 1. SDD-Orchestrator vs Build Agent

### Fork: sdd-orchestrator

**Propósito**: Coordinador puro - NUNCA hace trabajo inline.

**Reglas duras**:
- No inline work: Siempre delegate
- Preferir `delegate` sobre `task`
- Solo lee: git status, engram results, todo state
- "It's just a small change" NO es razón para skip delegation

**Workflow SDD**:
```
proposal → specs → design → tasks → apply → verify → archive
              ↑
              design
```

**Artifact Store Modes**:
- `engram`: Persistencia cross-session via MCP
- `openspec`: Archivos en filesystem
- `hybrid`: Ambos
- `none`: Solo inline

### Upstream: build Agent

**Propósito**: Agente de ejecución default.

**Características**:
- Full tool access
- Puede delegar a sub-agents
- Sin restricciones de workflow
- Memoria de sesión

### Comparación

| Feature | Fork | Upstream |
|---------|------|----------|
| Ejecución inline | ❌ Prohibido | ✅ Permitido |
| Workflow estructurado | ✅ DAG definido | ❌ Libre |
| Artifact persistence | ✅ Engram/OpenSpec | ❌ Solo sesión |
| Reglas de contexto | ✅ Hard stops | ❌ No enforce |
| Meta-commands | ✅ `/sdd-*` | ❌ No |

**Ganador**: **FORK** — El orchestrator enforce workflow discipline que upstream no tiene.

---

## 2. sdd-explore vs explore Agent

### Fork: sdd-explore

**Propósito**: Investigación profunda de un tema.

**Capabilities**:
- Lee codebase + compara approaches
- Stakeholder interview simulation
- Requirements gathering
- Returns structured analysis

**Output**:
```markdown
## Investigation Summary
### Findings
### Recommendations
### Risks
### Open Questions
```

### Upstream: explore

**Propósito**: Exploración rápida read-only.

**Capabilities**:
- BFS embebido (ultra-fast)
- ugrep embebido (ultra-fast grep)
- Read-only operations
- Optimizado para speed

### Comparación

| Feature | Fork | Upstream |
|---------|------|----------|
| Speed | Media (glob/grep) | Ultra-fast (BFS/ugrep) |
| Output estructurado | ✅ Yes | ❌ No |
| Requirements gathering | ✅ Yes | ❌ No |
| Returns artifacts | ✅ Yes | ❌ No |
| Skill-based | ✅ Yes | ❌ No |

**Ganador**: **DEPENDE**
- **Upstream** para speed crítico (BFS es 10x más rápido)
- **Fork** para investigación formal con artifact output

---

## 3. sdd-propose (Fork) vs general Agent

### Fork: sdd-propose

**Propósito**: Crear change proposals desde exploración.

**Output incluye**:
- Scope y boundaries
- Effort estimation
- Rollback plan
- Affected areas

**Artifact**: `proposal.md`

### Upstream: general

**Propósito**: Propósito general para tareas arbitrarias.

**Capabilities**:
- Full tool access
- Puede spawn agents
- Memoria de sesión

### Comparación

| Feature | Fork | Upstream |
|---------|------|----------|
| Template estructurado | ✅ Yes | ❌ No |
| Effort estimation | ✅ Yes | ❌ No |
| Rollback plan | ✅ Yes | ❌ No |
| Scope definition | ✅ Yes | ❌ No |
| Flexibilidad | Baja | Alta |

**Ganador**: **FORK** — El proposal es formal y estructurado. Upstream puede hacer lo mismo pero sin enforcing.

---

## 4. sdd-spec vs Upstream Skills

### Fork: sdd-spec

**Propósito**: Escribir especificaciones formales.

**Delta Spec Format**:
```markdown
## ADDED Requirements
### Requirement: {Name}
The system MUST/SHOULD {behavior}
#### Scenario: {Name}
- GIVEN {precondition}
- WHEN {action}
- THEN {outcome}
```

**RFC 2119 Keywords**: MUST, SHALL, SHOULD, MAY, MUST NOT

**Size budget**: 650 words max

**Features**:
- Full specs para domains nuevos
- Delta specs para cambios
- Testable scenarios
- NO implementation details

### Upstream: No equivalent

**Upstream NO tiene**:
- Spec agent dedicado
- Delta spec format
- Given/When/Then scenarios
- RFC 2119 enforcement

**Se acerca**: Plan agent pero sin output estructurado

### Comparación

| Feature | Fork | Upstream |
|---------|------|----------|
| Spec agent | ✅ Dedicated | ❌ None |
| Scenario format | ✅ G/W/T | ❌ No |
| RFC 2119 keywords | ✅ Yes | ❌ No |
| Size budget | ✅ 650 words | ❌ No |
| Testable scenarios | ✅ Yes | ❌ No |

**Ganador**: **FORK** — Upstream no tiene sistema de specs. Es una feature única.

---

## 5. sdd-design vs Plan Agent

### Fork: sdd-design

**Propósito**: Documento de diseño técnico.

**Output incluye**:
- Technical approach
- Architecture decisions (con rationale)
- Data flow (ASCII diagrams)
- File changes table
- Testing strategy
- Migration plan

**Size budget**: 800 words max

**Requirements**:
- Every decision MUST have rationale
- Follow existing patterns, don't enforce new ones
- ASCII diagrams optional

### Upstream: plan Agent

**Propósito**: Software architecture y planning.

**Capabilities**:
- Read-only mode (no edits)
- Design decisions
- Tradeoffs analysis

### Comparación

| Feature | Fork | Upstream |
|---------|------|----------|
| Template estructurado | ✅ Yes | ❌ No |
| File changes table | ✅ Yes | ❌ No |
| Data flow diagrams | ✅ Yes | ❌ No |
| Testing strategy | ✅ Yes | ❌ No |
| Migration plan | ✅ Yes | ❌ No |
| Size budget | ✅ 800 words | ❌ No |
| Read-only enforcement | ❌ No | ✅ Yes |

**Ganador**: **FORK** — Más completo y estructurado. Upstream tiene read-only pero sin template.

---

## 6. sdd-tasks vs Upstream Task Management

### Fork: sdd-tasks

**Propósito**: Decomposición de tareas implementables.

**Input**: Spec + Design

**Output**:
```markdown
## Phase 1: Foundation
- [ ] 1.1 Task description
- [ ] 1.2 Task description
```

**Features**:
- Dependency mapping
- Priority assignment
- Effort estimation
- Progress tracking

### Upstream: Task Tool

**Propósito**: Built-in TODO tracking.

**Capabilities**:
- Create/list/update tasks
- Status management
- Background tracking

### Comparación

| Feature | Fork | Upstream |
|---------|------|----------|
| Task breakdown | ✅ Yes | ❌ No |
| Dependencies | ✅ Yes | ❌ No |
| Priority | ✅ Yes | ❌ No |
| Effort estimation | ✅ Yes | ❌ No |
| Progress tracking | ✅ Yes | ✅ Basic |
| Integration con SDD | ✅ Yes | ❌ No |

**Ganador**: **FORK** — Tasks son parte del workflow SDD, no aisladas.

---

## 7. sdd-apply vs Upstream Build

### Fork: sdd-apply

**Propósito**: Implementación de tareas.

**Workflows**:
1. **TDD Mode**: RED → GREEN → REFACTOR
   - Escribe test que falla primero
   - Implementa mínimo para pasar
   - Refactor
2. **Standard Mode**: Direct implementation

**Features**:
- Mark tasks as complete
- Track deviations from design
- Report issues
- TDD cycle enforcement

**Output**:
```markdown
## Implementation Progress
### Completed Tasks
### Files Changed
### Tests (TDD)
### Deviations
### Issues Found
### Remaining Tasks
```

### Upstream: build Agent

**Propósito**: Ejecución default.

**Capabilities**:
- Full tool access
- No TDD enforcement
- No deviation tracking

### Comparación

| Feature | Fork | Upstream |
|---------|------|----------|
| TDD support | ✅ Yes | ❌ No |
| Task marking | ✅ Yes | ❌ No |
| Deviation tracking | ✅ Yes | ❌ No |
| Files changed table | ✅ Yes | ❌ No |
| Design following | ✅ Required | ❌ Optional |
| TDD enforcement | ✅ Yes | ❌ No |

**Ganador**: **FORK** — TDD support y deviation tracking son únicos.

---

## 8. sdd-verify vs verify Agent

### Fork: sdd-verify

**Propósito**: Validación de implementación vs specs.

**Steps**:
1. Completeness check (tasks done?)
2. Correctness (static specs match)
3. Coherence (design match)
4. Testing (static + execution)
5. Build & type check (execution)
6. Coverage validation (execution)
7. Spec compliance matrix (behavioral)

**Verdicts**:
- ✅ COMPLIANT: test exists AND passed
- ❌ FAILING: test exists BUT failed
- ❌ UNTESTED: no test found
- ⚠️ PARTIAL: test exists, passes, but covers only part

**Final Verdict**: PASS / PASS WITH WARNINGS / FAIL

### Upstream: verify Agent

**Propósito**: Testing adversarial.

**Verdicts**:
- PASS: All tests pass
- FAIL: Tests fail
- PARTIAL: Some issues

### Comparación

| Feature | Fork | Upstream |
|---------|------|----------|
| Static analysis | ✅ Yes | ❌ No |
| Test execution | ✅ Yes | ❌ No |
| Build verification | ✅ Yes | ❌ No |
| Type check | ✅ Yes | ❌ No |
| Coverage validation | ✅ Yes | ❌ No |
| Spec compliance matrix | ✅ Yes | ❌ No |
| Behavioral validation | ✅ Yes | ❌ No |
| CRITICAL/WARNING/SUGGESTION | ✅ Yes | ❌ No |

**Ganador**: **FORK** por landslide. sdd-verify es 10x más completo que verify agent.

---

## 9. sdd-archive vs Upstream Session Management

### Fork: sdd-archive

**Propósito**: Cerrar change y persistir estado final.

**Actions**:
- Persist final state to Engram
- Update Engram with archive report
- Close change in artifact store
- Cleanup if needed

**Output**:
```markdown
## Archive Report
- Change summary
- Final status
- Artifacts location
- Lessons learned
```

### Upstream: Session Snapshots

**Propósito**: Persistir memoria entre sesiones.

**Capabilities**:
- Memory snapshots
- Team memory sync
- Cross-session recovery

### Comparación

| Feature | Fork | Upstream |
|---------|------|----------|
| Formal closure | ✅ Yes | ❌ No |
| Artifact cleanup | ✅ Yes | ❌ No |
| Engram persistence | ✅ Yes | ✅ Via MCP |
| Lessons learned | ✅ Yes | ❌ No |
| State finalization | ✅ Yes | ❌ No |

**Ganador**: **FORK** — Archive es parte del workflow, no una feature aislada.

---

## 10. sdd-init (Fork) vs Upstream No Equivalent

### Fork: sdd-init

**Propósito**: Bootstrap SDD context y detect stack.

**Actions**:
- Detect programming languages
- Identify frameworks
- Set up initial metadata
- Bootstrap persistence

### Upstream: No equivalent

**Upstream NO tiene**:
- SDD initialization
- Stack detection
- Automatic context setup

---

## Feature Matrix Comparativa

| Feature | SDD Fork | Upstream | Ganador |
|---------|----------|----------|---------|
| **Orchestrator discipline** | ✅ Hard stops | ❌ No | Fork |
| **Workflow DAG** | ✅ Defined | ❌ No | Fork |
| **Artifact persistence** | ✅ Engram/OpenSpec | ❌ Session-only | Fork |
| **Spec writing** | ✅ Delta specs | ❌ No | Fork |
| **Design docs** | ✅ Structured | ❌ Basic | Fork |
| **TDD support** | ✅ Yes | ❌ No | Fork |
| **Verification matrix** | ✅ Full | ❌ Basic | Fork |
| **Explore speed** | ❌ Medium | ✅ Ultra-fast | Upstream |
| **Remote agents** | ❌ No | ✅ CCR/SSH | Upstream |
| **Agent teams** | ❌ Basic | ✅ Advanced | Upstream |
| **Worktree isolation** | ❌ No | ✅ Yes | Upstream |
| **BFS/ugrep embebido** | ❌ No | ✅ Yes | Upstream |
| **Flexibilidad** | ❌ Rigid | ✅ Flexible | Upstream |

---

## Conclusión

### Los SDD Agents del Fork son MEJORES para:

1. **Procesos formales** — Specs, designs, verification estructurada
2. **Compliance** — RFC 2119, Given/When/Then, veredictos formales
3. **TDD workflows** — RED → GREEN → REFACTOR cycle
4. **Cross-session persistence** — Engram integration
5. **Metodología** — Workflow discipline, delegation enforcement

### Los Agentes del Upstream son MEJORES para:

1. **Speed crítico** — BFS embebido es 10x más rápido
2. **Flexibilidad** — No hay workflow restrictions
3. **Remote execution** — CCR, SSH, mobile
4. **Agent teams** — Memoria compartida real
5. **Quick exploration** — Sin overhead de artifact management

### Recomendación

**Mantén AMBOS sistemas** — no son mutuamente excluyentes:

1. **Usa SDD** para features sustanciales que necesitan specs, designs, y verification
2. **Usa upstream agents** para exploración rápida y tareas simples
3. **Considera importar BFS/ugrep** del upstream al fork para speed en explore

### Posible Híbrido

Combinar lo mejor de ambos:

```markdown
# Hybrid Agent System

## Quick Task (upstream-style)
- explore (con BFS embebido)
- general (sin restrictions)
- verify (mejorado con matrix)

## Formal SDD (fork-style)
- sdd-orchestrator (con discipline)
- sdd-* phases (con artifacts)
- TDD support
- Engram persistence
```

---

## Referencias

- SDD Skills: `gentle-ai/skills/sdd-*/SKILL.md`
- Shared protocol: `gentle-ai/skills/_shared/sdd-phase-common.md`
- Engram convention: `gentle-ai/skills/_shared/engram-convention.md`
- OpenSpec convention: `gentle-ai/skills/_shared/openspec-convention.md`
