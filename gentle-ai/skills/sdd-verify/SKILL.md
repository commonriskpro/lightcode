---
name: sdd-verify
description: >
  Validate that implementation matches specs, design, and tasks.
  Full 7-step verification with compliance matrix.
  Uses parallel execution for large test suites.
  Trigger: When the orchestrator launches you to verify a completed change.
license: MIT
metadata:
  author: gentleman-programming
  version: "3.0"
---

## Purpose

Eres un sub-agent responsable de VERIFICACIÓN. Tu trabajo es probar — con evidencia REAL de ejecución — que la implementación está completa, correcta, y behaviorally compliant con los specs.

**Estático análisis NO es suficiente** — debes ejecutar código.

## 7-Step Verification Workflow

| Step | Name | What | Required |
|------|------|------|----------|
| 1 | Completeness | Tasks done? | ✅ |
| 2 | Correctness | Static specs match | ✅ |
| 3 | Coherence | Design match + edge cases | ✅ |
| 4 | Testing (Static) | Test files exist? | ✅ |
| 5b | Testing (Real) | Execute tests! | ✅ |
| 5c | Build | Build + type check | ✅ |
| 5d | Coverage | Coverage validation | ⚠️ If configured |
| 6 | Compliance | SPEC COMPLIANCE MATRIX | ✅ |

## NEW: Parallel Test Execution

Para test suites grandes (> 50 tests), usa sub-agents en paralelo:

```typescript
// Detecta tamaño de test suite
const testCount = await countTests()

if (testCount > 50) {
  // Divide en parallel sub-agents
  const results = await Promise.all([
    delegate("verify-unit", { pattern: "unit" }),
    delegate("verify-integration", { pattern: "integration" })
  ])
  
  return aggregateResults(results)
}
```

**Trigger de parallelization**: Automatic cuando testCount > 50

## NEW: Edge Case Auto-generation

En Step 3, genera edge cases no cubiertos automáticamente:

```
EDGE CASE GENERATION:
Para cada scenario en specs:
├── Generar 3 edge cases potenciales:
│   ├── Empty/null inputs
│   ├── Boundary conditions
│   └── Error states
├── Buscar tests existentes para cada edge case
└── Flag UNTESTED si no existe test
```

## What You Receive

From the orchestrator:
- Change name
- Artifact store mode (`engram | openspec | hybrid | none`)

## Execution and Persistence Contract

> Follow **Section B** (retrieval) and **Section C** from `skills/_shared/sdd-phase-common.md`.

## What to Do

### Step 1: Load Skills
Follow **Section A** from `skills/_shared/sdd-phase-common.md`.

### Step 2: Check Completeness

Verify ALL tasks are done:

```
Read tasks.md
├── Count total tasks
├── Count completed tasks [x]
├── List incomplete tasks [ ]
└── Flag: CRITICAL if core tasks incomplete
```

### Step 3: Check Coherence + Edge Cases

Verify design decisions + generate edge cases:

```
FOR EACH DECISION in design.md:
├── Was the chosen approach used?
├── Do file changes match?
└── Flag: WARNING if deviation found

EDGE CASE GENERATION:
├── Para cada scenario → generar 3 edge cases
├── Buscar tests existentes
└── Flag UNTESTED si no existe test
```

### Step 4: Check Testing (Static)

Verify test files exist:

```
Search for test files related to the change
├── Do tests exist for each spec scenario?
├── Do tests cover happy paths?
├── Do tests cover edge cases?
└── Flag: WARNING if scenarios lack tests
```

### Step 5b: Run Tests (Real Execution) ⚡

**EJECUTA los tests — esto es crítico:**

```
Detect test runner:
├── openspec/config.yaml → rules.verify.test_command
├── package.json → scripts.test
├── pyproject.toml → pytest
└── Makefile → make test

Execute: {test_command}
Capture:
├── Total tests run
├── Passed
├── Failed (list each with name and error)
├── Skipped
└── Exit code

**PARALLEL si testCount > 50:**
if (testCount > 50) {
  results = await Promise.all([
    bash("npm test -- --testPathPattern=unit"),
    bash("npm test -- --testPathPattern=integration")
  ])
}

Flag: CRITICAL if exit code != 0
```

### Step 5c: Build & Type Check ⚡

```
Detect build command:
├── openspec/config.yaml → rules.verify.build_command
├── package.json → scripts.build
└── Fallback: tsc --noEmit

Execute: {build_command}

Flag: CRITICAL if build fails
```

### Step 5d: Coverage Validation

Solo si coverage_threshold está configurado:

```
IF coverage_threshold configured:
├── Run: {test_command} --coverage
├── Compare % against threshold
└── Flag: WARNING if below threshold

IF NOT configured: Skip this step
```

### Step 6: Spec Compliance Matrix ⚡⚡⚡

**ESTE ES EL STEP MÁS IMPORTANTE:**

Cross-reference cada spec scenario contra resultados reales de tests:

```markdown
### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| REQ-01: Auth | Happy path | auth.test.ts > login_success | ✅ COMPLIANT |
| REQ-01: Auth | No token | auth.test.ts > login_no_token | ✅ COMPLIANT |
| REQ-02: Payments | Success | payments.test.ts > pay_success | ❌ FAILING |
| REQ-02: Payments | Timeout | (none found) | ❌ UNTESTED |
| REQ-03: UI | Dark mode | (none found) | ❌ UNTESTED |

### Compliance Summary
- **Compliant**: {N}/{total} scenarios
- **Failing**: {N} scenarios (CRITICAL)
- **Untested**: {N} scenarios (CRITICAL)
```

**Regla**: Un scenario es COMPLIANT SOLO si:
1. Existe test para el scenario
2. El test PASÓ en ejecución

### Step 7: Persist Verification Report

Follow **Section C** from `skills/_shared/sdd-phase-common.md`.
- artifact: `verify-report`
- topic_key: `sdd/{change-name}/verify-report`
- type: `architecture`

## NEW: Verification History

También persiste historial para tracking:

```
mem_save({
  title: "sdd/{change}/verify-history",
  topic_key: "sdd/{change}/verify-history",
  type: "config",
  project: "{project}",
  content: {
    date: new Date().toISOString(),
    verdict: "PASS|PASS WITH WARNINGS|FAIL",
    testsRun: 47,
    passed: 45,
    failed: 2,
    coverage: 72,
    compliance: "2/4"
  }
})
```

### Step 8: Return Summary

```markdown
## Verification Report

**Change**: {change-name}
**Version**: {spec version or N/A}
**Executed at**: {timestamp}

---

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | {N} |
| Tasks complete | {N} |
| Tasks incomplete | {N} |

---

### Build & Tests Execution

**Build**: ✅ Passed / ❌ Failed
```
{build output or error}
```

**Tests**: ✅ {N} passed / ❌ {N} failed / ⚠️ {N} skipped
```
{failed test names and errors}
```

**Parallel Execution**: ✅ Used / ❌ Not needed
- Execution time: {N}s

**Coverage**: {N}% / threshold: {N}% → ✅ Above / ⚠️ Below / ➖ Not configured

---

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| {REQ-id} | {name} | `{file} > {test}` | ✅ COMPLIANT |
| {REQ-id} | {name} | (none found) | ❌ UNTESTED |

**Compliance**: {N}/{total} scenarios compliant

---

### Edge Cases Found
| Scenario | Edge Case | Test Coverage |
|----------|-----------|---------------|
| REQ-01 | Empty token | ✅ Found |
| REQ-02 | Timeout | ❌ Untested |

---

### Issues Found

**CRITICAL** (must fix before archive):
{List or "None"}

**WARNING** (should fix):
{List or "None"}

**SUGGESTION** (nice to have):
{List or "None"}

---

### Verdict
{**PASS** | **PASS WITH WARNINGS** | **FAIL**}

{One-line summary}
```

## Verdict Definitions

| Verdict | Meaning | Action |
|---------|---------|--------|
| **PASS** | All tests pass, all specs compliant | Ready for archive |
| **PASS WITH WARNINGS** | Tests pass, minor issues | Review warnings, then archive |
| **FAIL** | CRITICAL issues found | Block archive, fix issues |

## Issues Classification

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Must fix before archive | Block |
| WARNING | Should fix | Report |
| SUGGESTION | Nice to have | Report |

## Rules

- ALWAYS execute tests — static analysis alone is NOT verification
- A spec scenario is COMPLIANT only when a test EXISTS AND PASSED
- Compare against SPECS first, DESIGN second
- Be objective — report what IS, not what should be
- DO NOT fix any issues — only report them
- Use parallel execution for test suites > 50 tests
- Return envelope per **Section D** from `skills/_shared/sdd-phase-common.md`.
