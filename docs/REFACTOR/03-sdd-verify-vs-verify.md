# Comparativa Detallada: sdd-verify vs verify Agent

## Arquitectura Actual

### sdd-verify (Fork) — El Gigante

**Paradigma**: Quality gate completo con verificación formal.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SDD-VERIFY WORKFLOW                              │
├─────────────────────────────────────────────────────────────────────┤
│  Step 1: Completeness     → Tasks done?                            │
│  Step 2: Correctness      → Static specs match                      │
│  Step 3: Coherence       → Design match                            │
│  Step 4: Testing (Static) → Test files exist?                      │
│  Step 5b: Testing (Real) → Execute tests!                          │
│  Step 5c: Build          → Build + type check                       │
│  Step 5d: Coverage       → Coverage validation                     │
│  Step 6: Compliance      → SPEC COMPLIANCE MATRIX                  │
└─────────────────────────────────────────────────────────────────────┘
```

**Compliance Matrix**:
```markdown
| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| REQ-01 | Scenario | test.spec.ts | ✅ COMPLIANT |
| REQ-02 | Scenario | (none found) | ❌ UNTESTED |
```

**Final Verdict**:
- ✅ PASS — Todos los tests pasan y specs cumplidas
- ⚠️ PASS WITH WARNINGS — Cumplidas pero con warnings
- ❌ FAIL — Issues críticos encontrados

### verify Agent (Upstream) — El Simple

**Paradigma**: Testing adversarial básico.

```
┌─────────────────────────────────────────────────────────────┐
│                   VERIFY AGENT                              │
├─────────────────────────────────────────────────────────────┤
│  ✅ Generates PASS/FAIL/PARTIAL verdicts                    │
│  ✅ Tests code against specifications                        │
│  ✅ Identifies edge cases                                   │
│  ⚠️  No execution requirement                               │
│  ⚠️  No build verification                                 │
│  ⚠️  No coverage validation                                │
└─────────────────────────────────────────────────────────────┘
```

---

## Feature Comparison Matrix

| Feature | sdd-verify | verify | Winner |
|---------|------------|--------|--------|
| **Completeness check** | ✅ Tasks done | ❌ No | sdd-verify |
| **Correctness (static)** | ✅ Specs match | ❌ No | sdd-verify |
| **Coherence (design)** | ✅ Design match | ❌ No | sdd-verify |
| **Test static analysis** | ✅ Yes | ❌ No | sdd-verify |
| **Test execution** | ✅ Real run | ❌ No | sdd-verify |
| **Build verification** | ✅ Yes | ❌ No | sdd-verify |
| **Type check** | ✅ Yes | ❌ No | sdd-verify |
| **Coverage validation** | ✅ Yes | ❌ No | sdd-verify |
| **Spec compliance matrix** | ✅ Yes | ❌ No | sdd-verify |
| **Behavioral validation** | ✅ Yes | ❌ No | sdd-verify |
| **Edge case identification** | ✅ Yes | ✅ Yes | Tie |
| **Adversarial testing** | ✅ Yes | ✅ Yes | Tie |
| **CRITICAL/WARNING/SUGGESTION** | ✅ Yes | ❌ No | sdd-verify |
| **Spawn sub-agents** | ❌ No | ✅ Yes | verify |

---

## Análisis Detallado

### 1. Spec Compliance Matrix

**sdd-verify tiene** (único en la industria):

```markdown
### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| REQ-01: Auth | Happy path | auth.test.ts > login_success | ✅ COMPLIANT |
| REQ-01: Auth | No token | auth.test.ts > login_no_token | ✅ COMPLIANT |
| REQ-02: Payments | Success | payments.test.ts > pay_success | ❌ FAILING |
| REQ-03: UI | Dark mode | (none found) | ❌ UNTESTED |

Compliance: 2/4 scenarios compliant
```

**verify upstream NO tiene** esto — solo PASS/FAIL genérico.

### 2. Real Test Execution

**sdd-verify EJECUTA tests**:

```bash
# Step 5b: Run Tests (Real Execution)
npm test 2>&1

# Captures:
# - Total tests run: 47
# - Passed: 45
# - Failed: 2
# - Skipped: 0
# - Exit code: 1

Flag: CRITICAL if exit code != 0
```

**verify upstream NO requiere ejecución** — puede ser solo análisis estático.

### 3. Build + Type Check

**sdd-verify verifica build**:

```bash
# Step 5c: Build & Type Check
npm run build && tsc --noEmit

Flag: CRITICAL if build fails
```

### 4. Coverage Validation

**sdd-verify valida coverage**:

```bash
# Step 5d: Coverage Validation
npm test -- --coverage

# Compare against threshold
threshold: 80%
actual: 72%

Flag: WARNING if below threshold
```

---

## Lo que sdd-verify tiene MEJOR que verify

### Matrix Completa

| Lo que sdd-verify tiene | Lo que verify tiene |
|-------------------------|---------------------|
| ✅ 7-step verification workflow | ❌ Solo veredictos básicos |
| ✅ Spec compliance matrix | ❌ No matriz |
| ✅ Real test execution | ❌ Puede ser estático |
| ✅ Build verification | ❌ No |
| ✅ Type check | ❌ No |
| ✅ Coverage validation | ❌ No |
| ✅ CRITICAL/WARNING/SUGGESTION | ❌ Solo PASS/FAIL/PARTIAL |
| ✅ Behavioral validation | ⚠️ Basic |

---

## Features de Upstream a Integrar en sdd-verify

### 1. Spawn Sub-agents para Testing Paralelo

**Upstream tiene**: `verify` puede spawn sub-agents para testing en paralelo.

**Agregar a sdd-verify**:

```markdown
## NEW: Parallel Test Execution

Para test suites grandes, divide en sub-agents:

```
PARALLEL TESTING:
├── Sub-agent 1: Unit tests
│   └── bash("npm test -- --testPathPattern=unit")
├── Sub-agent 2: Integration tests
│   └── bash("npm test -- --testPathPattern=integration")
└── Aggregar resultados
```

**Implementación**:
```typescript
// En sdd-verify, después de Step 5a

if (testSuiteSize > 50) {
  // Dividir en parallel sub-agents
  const results = await Promise.all([
    delegate("verify-unit", { suite: "unit" }),
    delegate("verify-integration", { suite: "integration" })
  ])
  // Agregar resultados
}
```

### 2. Edge Case Auto-generation

**Upstream tiene**: verify puede identificar edge cases automáticamente.

**Agregar a sdd-verify Step 3**:

```markdown
## NEW: Edge Case Auto-generation

Después de verificar specs, usa LLM para generar edge cases no cubiertos:

```
EDGE CASE GENERATION:
├── Para cada scenario en specs:
│   └── Generar 3 edge cases potenciales
├── Buscar tests existentes para cada edge case
└── Reportar UNTESTED si no existe test
```

### 3. Verification History

**Agregar**:

```markdown
## NEW: Verification History

Guardar historial de verifications:

```typescript
mem_save({
  title: "sdd/{change}/verify-history",
  content: {
    date: new Date(),
    verdict: "PASS",
    testsRun: 47,
    passed: 45,
    failed: 2,
    coverage: 72%
  }
})
```

Esto permite trackear calidad a lo largo del tiempo.
```

---

## Refactored sdd-verify SKILL.md

```markdown
---
name: sdd-verify
description: >
  Validate that implementation matches specs, design, and tasks.
  Full 7-step verification with compliance matrix.
  Uses parallel execution for large test suites.
---

## Purpose

Eres el QUALITY GATE. Tu trabajo es probar — con evidencia REAL de ejecución — 
que la implementación está completa, correcta, y behaviorally compliant con los specs.

**NO es suficiente análisis estático** — debes ejecutar código.

## 7-Step Verification Workflow

| Step | Name | What |
|------|------|------|
| 1 | Completeness | Tasks done? |
| 2 | Correctness | Static specs match |
| 3 | Coherence | Design match + edge cases |
| 4 | Testing (Static) | Test files exist? |
| 5b | Testing (Real) | Execute tests! |
| 5c | Build | Build + type check |
| 5d | Coverage | Coverage validation |
| 6 | Compliance | SPEC COMPLIANCE MATRIX |

## NEW: Parallel Test Execution

Para test suites > 50 tests, usa sub-agents:

```typescript
if (estimatedTests > 50) {
  // Dividir en parallel
  const [unit, integration, e2e] = await Promise.all([
    delegate("verify-unit", { pattern: "unit" }),
    delegate("verify-integration", { pattern: "integration" }),
    delegate("verify-e2e", { pattern: "e2e" })
  ])
  // Agregar resultados
}
```

## NEW: Edge Case Generation

En Step 3, genera edge cases no cubiertos:

```
FOR EACH scenario in specs:
  └── Generar 3 edge cases
      - Empty/null inputs
      - Boundary conditions
      - Error states
  └── Buscar tests existentes
  └── Flag UNTESTED si no existe
```

## Compliance Matrix (REQUIRED)

```markdown
### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| {REQ-id} | {name} | `{file} > {test}` | ✅ COMPLIANT |
| {REQ-id} | {name} | (none found) | ❌ UNTESTED |

Compliance: {N}/{total} scenarios compliant
```

## Verdict Definitions

| Verdict | Meaning |
|---------|---------|
| ✅ PASS | All tests pass, all specs compliant |
| ⚠️ PASS WITH WARNINGS | Tests pass, minor issues found |
| ❌ FAIL | CRITICAL issues found |

## Issues Classification

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Must fix before archive | Block |
| WARNING | Should fix | Report |
| SUGGESTION | Nice to have | Report |

## Persistence

Always persist:
1. `verify-report` — Full report
2. `verify-history` — For trend tracking
3. Update tasks with verification status

## Return Envelope

```markdown
**Status**: {success/partial/blocked}
**Verdict**: {PASS/PASS WITH WARNINGS/FAIL}
**Compliance**: {N}/{total} scenarios
**Tests**: {N} passed / {N} failed
**Coverage**: {N}% / threshold: {N}%
**Artifacts**: [list]
**Next**: {sdd-archive or sdd-apply fix}
**Risks**: {list or "None"}
```
