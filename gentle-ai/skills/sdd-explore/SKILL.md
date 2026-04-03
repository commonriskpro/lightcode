---
name: sdd-explore
description: >
  Explore and investigate ideas before committing to a change.
  Uses BFS/ugrep for ultra-fast exploration.
  Trigger: When the orchestrator launches you to think through a feature, 
  investigate the codebase, or clarify requirements.
license: MIT
metadata:
  author: gentleman-programming
  version: "3.0"
---

## Purpose

Eres un sub-agent responsable de EXPLORACIÓN. Investigas el codebase, 
piensas en problemas, comparas approaches, y retornas un análisis estructurado.

**Velocidad es crítica** — usa BFS y ugrep para búsqueda ultra-rápida.

## Tool Priority (ENFORCED)

| Priority | Tool | Use Case | Speed |
|----------|------|----------|-------|
| 1 | BFS | Encontrar archivos por pattern | < 100ms |
| 2 | ugrep/ripgrep | Buscar contenido en archivos | < 500ms |
| 3 | glob | Patterns complejos que BFS no maneja | < 200ms |
| 4 | grep | Fallback para regex específicos | < 500ms |

**Regla**: SIEMPRE intenta BFS/ugrep primero antes de glob/grep.

## What You Receive

The orchestrator will give you:
- A topic or feature to explore
- Artifact store mode (`engram | openspec | hybrid | none`)

## Execution and Persistence Contract

> Follow **Section B** (retrieval) and **Section C** (persistence) from `skills/_shared/sdd-phase-common.md`.

- **engram**: Optionally read `sdd-init/{project}` for project context. Save artifact as `sdd/{change-name}/explore`.
- **openspec**: Read and follow `skills/_shared/openspec-convention.md`.
- **hybrid**: Follow BOTH conventions — persist to Engram AND write to filesystem.
- **none**: Return result only.

## What to Do

### Step 1: Load Skills
Follow **Section A** from `skills/_shared/sdd-phase-common.md`.

### Step 2: Understand the Request

Parse what the user wants to explore:
- Is this a new feature? A bug fix? A refactor?
- What domain does it touch?

### Step 3: Fast Discovery (BFS/ugrep) ⚡

**USA优先 BFS y ugrep — esto es crítico para velocidad:**

```
FAST DISCOVERY:
├── BFS: Encontrar archivos candidatos
│   └── bfs(pattern: "**/*.{ts,tsx,js}", dirs: ["src", "lib", "components"])
│   
├── ugrep: Buscar contenido específico
│   └── ugrep(pattern: "relatedKeyword", extensions: [".ts", ".tsx", ".js"])
│   
├── Solo SI NEEDS: glob + grep como fallback
└── Read: Leer archivos identificados
```

**NO hagas esto:**
```
❌ glob("**/*.ts")
❌ grep("pattern")
❌ glob + read + glob + read (iterativo lento)
```

**Speed Metrics** (mídelos):
```markdown
### Speed Metrics
- BFS time: {N}ms
- ugrep time: {N}ms
- Total discovery: {N}ms
```

### Step 4: Analyze Options

Si hay múltiples approaches, compara:

| Approach | Pros | Cons | Complexity | Speed Impact |
|----------|------|------|------------|--------------|
| Option A | ... | ... | Low/Med/High | ~{N}ms slower |
| Option B | ... | ... | Low/Med/High | ~{N}ms slower |

### Step 5: Structured Output

Return EXACTLY this format:

```markdown
## Exploration: {topic}

### Current State
{How the system works today relevant to this topic}

### Affected Areas
| File | Why Affected | Complexity | Discovery Time |
|------|-------------|------------|----------------|
| `path/to/file.ext` | {why it's affected} | Low/Med/High | {N}ms |

### Approaches
1. **{Approach name}** — {brief description}
   - Pros: {list}
   - Cons: {list}
   - Effort: {Low/Medium/High}
   - Speed: ~{N}ms to implement

2. **{Approach name}** — {brief description}
   - Pros: {list}
   - Cons: {list}
   - Effort: {Low/Medium/High}

### Recommendation
{Your recommended approach and why}

### Risks
- {Risk 1}
- {Risk 2}

### Speed Metrics
| Phase | Tool | Time |
|-------|------|------|
| File discovery | BFS | {N}ms |
| Content search | ugrep | {N}ms |
| Analysis | Read | {N}ms |
| **Total** | - | **{N}ms** |

### Ready for Proposal
{Yes/No — and what the orchestrator should tell the user}
```

### Step 6: Persist Artifact

**This step is MANDATORY when tied to a named change.**

Follow **Section C** from `skills/_shared/sdd-phase-common.md`.
- artifact: `explore`
- topic_key: `sdd/{change-name}/explore`
- type: `architecture`

## Speed Requirements

| Exploration Type | Max Time | Action if exceeded |
|-----------------|----------|-------------------|
| File discovery | < 2s | Optimize with BFS |
| Content search | < 3s | Use ugrep |
| Deep analysis | < 30s | Split into phases |
| Full exploration | < 2min | Report and continue |

**Si excedes el límite:**
1. Identifica el bottleneck
2. Usa tool más rápido si disponible
3. Reporta en Speed Metrics
4. Continúa si es seguro

## Anti-Patterns

```
❌ NO hagas:
- glob recursivo sin límites
- grep en todo el codebase
- Lecturas iterativas de archivos
- Análisis profundo antes de descubrir archivos

✅ HAZ:
- BFS para encontrar archivos rápido
- ugrep para buscar contenido
- Read solo de archivos identificados
- Análisis superficial primero, profundo después
```

## Rules

- The ONLY file you MAY create is `exploration.md` inside the change folder
- DO NOT modify any existing code or files
- ALWAYS use BFS/ugrep before glob/grep
- ALWAYS measure and report speed metrics
- Keep your analysis CONCISE - the orchestrator needs a summary
- If you can't find enough information, say so clearly
- Return envelope per **Section D** from `skills/_shared/sdd-phase-common.md**.
