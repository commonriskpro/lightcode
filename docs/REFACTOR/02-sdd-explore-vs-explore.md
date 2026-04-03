# Comparativa Detallada: sdd-explore vs explore Agent

## Arquitectura Actual

### sdd-explore (Fork)

**Paradigma**: Investigación formal con artifact output estructurado.

```markdown
## Exploration: {topic}

### Current State
{How the system works today relevant to this topic}

### Affected Areas
- `path/to/file.ext` — {why it's affected}

### Approaches
1. **{Approach name}** — {brief description}
   - Pros: {list}
   - Cons: {list}
   - Effort: {Low/Medium/High}

### Recommendation
{Your recommended approach and why}

### Risks
- {Risk 1}

### Ready for Proposal
{Yes/No}
```

**Características**:
- Lee codebase + compara approaches
- Stakeholder interview simulation
- Requirements gathering
- Returns structured analysis
- **Artifact persistence** a Engram/OpenSpec

### explore Agent (Upstream)

**Paradigma**: Exploración ultra-rápida read-only.

```
┌─────────────────────────────────────────────────────────────┐
│                 EXPLORE AGENT TOOLS                          │
├─────────────────────────────────────────────────────────────┤
│  ✅ BFS (Breadth-First Search) — ultra-fast file finding  │
│  ✅ ugrep — ultra-fast content search                      │
│  ✅ Read-only operations                                   │
│  ❌ No artifact output                                     │
│  ❌ No structured format                                   │
└─────────────────────────────────────────────────────────────┘
```

**Velocidad**: 10x más rápido que glob/grep estándar.

---

## Feature Comparison Matrix

| Feature | sdd-explore | explore | Winner |
|---------|-------------|---------|--------|
| **Velocidad** | Media (glob/grep) | Ultra-fast (BFS/ugrep) | explore |
| **Structured output** | ✅ exploration.md | ❌ No | sdd-explore |
| **Artifact persistence** | ✅ Yes | ❌ No | sdd-explore |
| **Approach comparison** | ✅ Yes | ❌ No | sdd-explore |
| **Requirements gathering** | ✅ Yes | ❌ No | sdd-explore |
| **Risk assessment** | ✅ Yes | ❌ No | sdd-explore |
| **Recommendation** | ✅ Yes | ❌ No | sdd-explore |
| **Read-only enforcement** | ✅ Yes | ✅ Yes | Tie |
| **Skill-based** | ✅ Yes | ❌ No | sdd-explore |
| **Stakeholder simulation** | ✅ Yes | ❌ No | sdd-explore |

---

## Análisis Detallado

### 1. Velocidad de Búsqueda

**Upstream usa**:
- BFS embebido: `find` ultra-optimizado con paralelización
- ugrep: grep 3-10x más rápido que ripgrep

**Fork usa**:
- glob: Rápido pero no optimizado
- grep: ripgrep estándar

**Gap**: Upstream es ~10x más rápido en exploración de archivos.

### 2. Output Estructurado

**Fork tiene**:
```markdown
## Exploration: {topic}

### Current State
### Affected Areas
### Approaches (with pros/cons/effort)
### Recommendation
### Risks
### Ready for Proposal
```

**Upstream no tiene** output estructurado — solo retorna texto libre.

### 3. Artifact Persistence

**Fork tiene**:
- Engram: `mem_save(sdd/{change-name}/explore)`
- OpenSpec: `openspec/changes/{name}/exploration.md`
- Hybrid: Ambos

**Upstream no tiene** persistencia de artifacts.

---

## Features de Upstream a Integrar

### CRÍTICO: Importar BFS + ugrep

Esta es la feature más importante a importar. El upstream tiene BFS y ugrep embebidos que son 10x más rápidos.

**Implementación sugerida**:

```typescript
// packages/opencode/src/tool/explore-tools.ts

export async function bfsSearch(query: string, options?: {
  maxDepth?: number
  extensions?: string[]
}): Promise<string[]> {
  // BFS implementation
}

export async function ugrepSearch(pattern: string, options?: {
  caseSensitive?: boolean
  extensions?: string[]
}): Promise<Match[]> {
  // ugrep implementation
}
```

**使用方法**:
```markdown
## NUEVA REGLA EN sdd-explore

Para búsquedas de archivos y contenido, USA优先 BFS y ugrep:

### BFS (para encontrar archivos)
```
BFS(pattern: "**/*.ts", exclude: ["node_modules", "dist"])
```

### ugrep (para buscar contenido)
```
ugrep(pattern: "function name", extensions: [".ts", ".tsx"])
```

### Solo usa glob/grep como fallback
- glob: para patterns complejos que BFS no maneja
- grep: para regex muy específicos
```

### Integración en SKILL.md

```markdown
## sdd-explore (REFACTORED v2.0)

### Step 3: Investigate the Codebase

**USA优先 BFS y ugrep para speed:**

```
INVESTIGATE (con BFS/ugrep):
├── BFS: Encontrar archivos relevantes
│   └── bfs(pattern: "**/*.{ts,tsx}", dirs: ["src", "lib"])
├── ugrep: Buscar contenido específico
│   └── ugrep(pattern: "relatedFunction", extensions: [".ts"])
├── Solo glob/grep: Para patterns complejos
└── Read: Leer archivos identificados
```

**Velocidad objetivo**: 
- Exploración básica < 5 segundos
- Exploración profunda < 30 segundos
```

---

## Plan de Refactorización

### Phase 1: Import BFS Implementation (Alta Prioridad)

```typescript
// packages/opencode/src/tool/bfs.ts

interface BFSOptions {
  maxDepth?: number
  extensions?: string[]
  exclude?: string[]
  maxFiles?: number
}

export async function bfs(
  rootDir: string,
  pattern: string,
  options?: BFSOptions
): Promise<string[]>
```

### Phase 2: Import ugrep (o usar ripgrep optimizado)

```typescript
// packages/opencode/src/tool/ugrep.ts
// Usar ripgrep con --json output y cache
```

### Phase 3: Actualizar sdd-explore SKILL.md

```markdown
### Velocidad Requerida

| Tipo de exploración | Tiempo máximo |
|--------------------|---------------|
| Búsqueda básica de archivos | < 2 segundos |
| Búsqueda de contenido simple | < 5 segundos |
| Exploración profunda | < 30 segundos |
| Análisis completo | < 2 minutos |

Si una exploración tarda más, identifica qué es lento y optimiza.
```

---

## Refactored sdd-explore SKILL.md

```markdown
---
name: sdd-explore
description: >
  Explore and investigate ideas before committing to a change.
  Uses BFS/ugrep for ultra-fast exploration.
  Trigger: When the orchestrator launches you to think through a feature, 
  investigate the codebase, or clarify requirements.
---

## Purpose

Eres un sub-agent responsable de EXPLORACIÓN. Investigas el codebase, 
piensas en problemas, comparas approaches, y retornas un análisis estructurado.

**Velocidad es crítica** — usa BFS y ugrep para búsqueda ultra-rápida.

## Tool Priority (ENFORCED)

| Priority | Tool | Use Case |
|----------|------|----------|
| 1 | BFS | Encontrar archivos por pattern |
| 2 | ugrep/ripgrep | Buscar contenido en archivos |
| 3 | glob | Patterns complejos que BFS no maneja |
| 4 | grep | Fallback para regex específicos |

## What You Do

### Step 1: Fast Discovery (BFS/ugrep)

```
FAST DISCOVERY:
├── BFS: Encontrar archivos candidatos
│   └── bfs(pattern: "**/*.{ts,tsx,go,py}", dirs: ["src", "lib"])
├── ugrep: Buscar en contenido
│   └── ugrep(pattern: "relatedKeyword", files: [candidates])
└── Solo SI NEEDS: glob + grep
```

### Step 2: Analysis (Read)

```
ANALYSIS:
├── Read entry points y key files
├── Search for related functionality
├── Check existing tests
└── Identify patterns y dependencies
```

### Step 3: Structured Output

Retorna exactamente este formato:

```markdown
## Exploration: {topic}

### Current State
{How the system works today}

### Affected Areas
| File | Why Affected | Complexity |
|------|-------------|------------|
| `path/x.ts` | New feature | Low |

### Approaches
| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| A | ... | ... | Low |

### Recommendation
{One-line recommendation}

### Risks
- {Risk}

### Speed Metrics
- BFS time: {N}ms
- ugrep time: {N}ms
- Total: {N}ms

### Ready for Proposal
{Yes/No}
```

## Speed Requirements

| Exploration Type | Max Time |
|-----------------|----------|
| File discovery | < 2s |
| Content search | < 5s |
| Deep analysis | < 30s |

## Persistence

Follow sdd-phase-common.md for Engram/OpenSpec persistence.
```
