# Comparativa Detallada: sdd-propose vs general Agent

## Arquitectura Actual

### sdd-propose (Fork) — El Formal

**Paradigma**: Change proposal estructurado con scope, risks, y rollback.

```markdown
# Proposal: {Change Title}

## Intent
{What problem are we solving?}

## Scope
### In Scope
### Out of Scope

## Approach
{High-level technical approach}

## Affected Areas
| Area | Impact | Description |

## Risks
| Risk | Likelihood | Mitigation |

## Rollback Plan
{How to revert if something goes wrong}

## Dependencies
{External dependencies}

## Success Criteria
- [ ] {Measurable outcome}
```

**Features**:
- Success criteria checkboxes
- Rollback plan REQUIRED
- Effort estimation
- Scope definition

### general Agent (Upstream) — El Flexible

**Paradigma**: Agente de propósito general.

```
┌─────────────────────────────────────────────────────────────┐
│                    GENERAL AGENT                            │
├─────────────────────────────────────────────────────────────┤
│  ✅ Full tool access                                        │
│  ✅ Puede spawn agents                                      │
│  ✅ Memoria de sesión                                       │
│  ⚠️  Sin template de proposal                              │
│  ⚠️  Sin éxito medible                                     │
│  ⚠️  Sin rollback obligatorio                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Feature Comparison Matrix

| Feature | sdd-propose | general | Winner |
|---------|-------------|---------|--------|
| **Structured output** | ✅ Yes | ❌ No | sdd-propose |
| **Success criteria** | ✅ Checkboxes | ❌ No | sdd-propose |
| **Rollback plan** | ✅ REQUIRED | ❌ No | sdd-propose |
| **Scope definition** | ✅ In/Out of scope | ❌ No | sdd-propose |
| **Effort estimation** | ✅ Yes | ❌ No | sdd-propose |
| **Risk assessment** | ✅ Likelihood + Mitigation | ❌ No | sdd-propose |
| **Affected areas table** | ✅ Yes | ❌ No | sdd-propose |
| **Dependencies** | ✅ Yes | ❌ No | sdd-propose |
| **Flexibilidad** | ❌ Rígido | ✅ Yes | general |
| **Full tool access** | ❌ Limited | ✅ Yes | general |
| **Agent spawning** | ❌ No | ✅ Yes | general |

---

## Análisis Detallado

### 1. Rollback Plan (CRÍTICO)

**sdd-propose REQUIERE rollback**:

```markdown
## Rollback Plan

{How to revert if something goes wrong. Be specific.}

Ejemplo:
- Branch: `git checkout main && git branch -D feature-x`
- Database: `DELETE FROM migrations WHERE name LIKE 'feature_x%'`
- Config: Revert config changes in `config.yaml`
```

**general upstream NO tiene** concepto de rollback.

### 2. Success Criteria

**sdd-propose tiene**:

```markdown
## Success Criteria

- [ ] {How do we know this change succeeded?}
- [ ] {Measurable outcome}

Ejemplo:
- [ ] Login works with JWT tokens
- [ ] API response time < 200ms
- [ ] Test coverage increased from 60% to 80%
```

**general upstream NO tiene** criteria tracking.

### 3. Risk Assessment

**sdd-propose tiene**:

```markdown
## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Breaking existing API | Medium | Version the endpoint |
| Data migration failure | Low | Backup before migration |
```

**general upstream NO tiene** matrix de riesgos.

---

## Features de Upstream a Integrar en sdd-propose

### 1. Impact Analysis Automation

**Upstream tiene**: Análisis automático de código.

**Agregar**:

```markdown
## NEW: Automated Impact Analysis

Ejecuta análisis automático antes de escribir proposal:

```bash
# Análisis de código existente
1. BFS: Encontrar archivos relacionados
2. ugrep: Buscar dependencias
3. Tests: Identificar test suite affected
4. Metrics: LOC afectado, complejidad

# Output: Impact summary
## Impact Analysis
- Files affected: {N}
- Lines changed: ~{N}
- Tests to run: {N}
- Risk level: {Low/Medium/High}
```
```

### 2. Stakeholder Simulation

**Agregar**:

```markdown
## NEW: Stakeholder Review Simulation

Antes de finalizar proposal, simula review de stakeholders:

```typescript
// Para cada stakeholder identificado:
const review = await delegate("general", {
  prompt: `Review this proposal from {stakeholder} perspective:
  
  {proposal content}
  
  Identify:
  1. Concerns from this stakeholder
  2. Questions they would ask
  3. Approval likelihood (High/Medium/Low)`
})

// Agregar concerns al proposal
```
```

### 3. Effort Estimation Model

**Agregar**:

```markdown
## NEW: Effort Estimation

Basado en impacto analysis y historical data:

```markdown
## Effort Estimation

| Component | Estimated Hours | Confidence |
|-----------|----------------|------------|
| Implementation | {N} | {High/Medium/Low} |
| Testing | {N} | {High/Medium/Low} |
| Documentation | {N} | {High/Medium/Low} |
| **Total** | **{N} hours** | |

Based on similar changes in this codebase:
- Average: {N} hours
- Range: {N}-{N} hours
```
```

---

## Refactored sdd-propose SKILL.md

```markdown
---
name: sdd-propose
description: >
  Create a change proposal with intent, scope, approach, risks, and rollback.
  Includes automated impact analysis.
---

## Purpose

Eres un sub-agent responsable de CREAR PROPOSALS. Tomas el análisis de 
exploración (o input directo del usuario) y produces un proposal estructurado.

## NEW: Automated Impact Analysis

Antes de escribir el proposal:

```bash
# Ejecutar análisis automático
1. BFS: Encontrar archivos affected
2. ugrep: Buscar dependencies
3. Identify: Test suites affected
4. Estimate: LOC y complexity

# Output impact summary
```

## Proposal Structure

```markdown
# Proposal: {Change Title}

## Intent
{Problem being solved}

## Impact Analysis
- Files affected: {N}
- LOC changed: ~{N}
- Tests affected: {N}
- Risk level: {Low/Medium/High}

## Scope
### In Scope
### Out of Scope

## Approach
{Technical approach}

## Effort Estimation
| Component | Hours | Confidence |
|-----------|-------|------------|
| Implementation | {N} | {H/M/L} |
| Testing | {N} | {H/M/L} |
| **Total** | **{N}h** | |

## Affected Areas
| Area | Impact | Files |
|------|--------|-------|
| Auth | Modified | 3 files |

## Risks
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| {risk} | {L/M/H} | {L/M/H} | {mitigation} |

## Rollback Plan (REQUIRED)
{How to revert. Be specific.}

## Dependencies
{External dependencies, if any}

## Success Criteria
- [ ] {Measurable outcome}
- [ ] {Test coverage target}

## Stakeholder Concerns
- {Concern from stakeholder simulation}
```

## Persistence

Follow sdd-phase-common.md:
- engram: `mem_save(sdd/{change}/proposal)`
- openspec: `openspec/changes/{change}/proposal.md`
- hybrid: Both

## Rules

- Rollback plan is REQUIRED — no exceptions
- Success criteria must be measurable
- Effort estimation based on impact analysis
- Return envelope per Section D

## Size Budget

**400 words max** — Use tables and bullets over prose.
