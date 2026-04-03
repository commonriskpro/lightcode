# Comparativa Detallada: sdd-orchestrator vs build Agent

## Arquitectura Actual

### sdd-orchestrator (Fork)

**Paradigma**: Coordinator puro con hard stops obligatorios.

```
┌─────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR RULES                       │
├─────────────────────────────────────────────────────────────┤
│  ✅ SIEMPRE delegate — nunca inline work                   │
│  ✅ Preferir delegate sobre task                           │
│  ✅ Solo lee: git status, engram, todo state               │
│  ❌ NO Edit/Write/Read en archivos de código              │
│  ❌ "It's just a small change" NO es excepción             │
└─────────────────────────────────────────────────────────────┘
```

**Meta-commands**:
- `/sdd-new <change>` — Inicia nuevo cambio
- `/sdd-continue <change>` — Continúa siguiente fase
- `/sdd-ff <name>` — Fast-forward planning

**Artifact Stores**:
- `engram`: MCP persistence
- `openspec`: Filesystem
- `hybrid`: Ambos
- `none`: Inline only

### build Agent (Upstream)

**Paradigma**: Agente de ejecución libre sin restricciones.

```
┌─────────────────────────────────────────────────────────────┐
│                    BUILD AGENT RULES                        │
├─────────────────────────────────────────────────────────────┤
│  ✅ Full tool access                                        │
│  ✅ Puede delegar a sub-agents                              │
│  ✅ Memoria de sesión                                       │
│  ⚠️  Puede hacer inline work                                │
│  ⚠️  Sin workflow enforcement                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Feature Comparison Matrix

| Feature | sdd-orchestrator | build | Winner |
|---------|-------------------|-------|--------|
| **Inline work** | ❌ Prohibido | ✅ Permitido | Orchestrator |
| **Hard stops** | ✅ Yes | ❌ No | Orchestrator |
| **Workflow DAG** | ✅ Definido | ❌ Libre | Orchestrator |
| **Meta-commands** | ✅ `/sdd-*` | ❌ No | Orchestrator |
| **Artifact stores** | ✅ 4 modes | ❌ Session-only | Orchestrator |
| **Context discipline** | ✅ Enforcement | ❌ No | Orchestrator |
| **Tool restriction** | ✅ Coordinator-only | ❌ All tools | Orchestrator |
| **Flexibilidad** | ❌ Rígido | ✅ Flexible | Build |
| **Spawn agents** | ✅ delegate/task | ✅ Yes | Tie |
| **Remote execution** | ❌ No | ✅ CCR/SSH | Upstream |
| **Worktree isolation** | ❌ No | ✅ Yes | Upstream |

---

## Features de Upstream a Integrar

### 1. Remote Agent Support

**Actualmente en fork**: Solo delegate/task local.

**Agregar**:
```markdown
## Nueva Regla: Remote Orchestration

Si el usuario pide trabajo en remote host:
1. Detectar via "/sdd-new remote:user@host feature-name"
2. Crear orchestrator en remote via SSH
3. Sincronizar artifacts via Engram
```

### 2. Worktree Isolation

**Actualmente en fork**: No soportado.

**Agregar al workflow**:
```markdown
## Nueva Regla: Worktree Isolation

Para cambios sustanciales:
1. Crear worktree: `git worktree add ../feature-x-impl`
2. Trabajar en worktree aislado
3. Merge cuando verify pasa
```

### 3. Agent Configuration per Phase

**Actualmente en fork**: Solo model override.

**Agregar de upstream**:
```json
{
  "agent": {
    "sdd-orchestrator": {
      "maxTokens": 4096,
      "temperature": 0.7,
      "tools": ["delegate", "task", "todowrite", "read"]
    }
  }
}
```

---

## Plan de Refactorización

### Phase 1: Enforce Discipline (Ya hecho ✅)

El orchestrator ya tiene hard stops. Mantener.

### Phase 2: Agregar Remote Support

```markdown
// En AGENTS.md del orchestrator

## Remote Orchestration Support

### Trigger
- `/sdd-remote <user@host> <change-name>`
- Remote flag en /sdd-new

### Behavior
1. SSH al remote host
2. Ejecutar orchestrator en contexto remoto
3. Sync artifacts via Engram
4. Reportar resultados
```

### Phase 3: Agregar Worktree Isolation

```markdown
// Nuevo meta-command

## /sdd-worktree <change-name>

Crea isolated worktree para el cambio:
1. `git worktree add ../sdd-{change-name}`
2. Inicializa contexto en worktree
3. Cuando verify pasa → merge al main
```

### Phase 4: Tool Configuration per Phase

```typescript
// En config de agente
const phaseToolConfig = {
  "sdd-explore": ["read", "grep", "glob", "task"],
  "sdd-verify": ["read", "grep", "glob", "bash", "task"],
  "sdd-apply": ["read", "write", "edit", "bash", "task"]
}
```

---

## Refactored Orchestrator Instructions

```markdown
# sdd-orchestrator (REFACTORED v3.0)

## Core Identity

Eres un COORDINADOR PURO. Tu único trabajo es mantener una conversación 
delgada con el usuario, delegar TODO el trabajo real a sub-agents, y 
sintetizar sus resultados.

## Hard Stops (ZERO EXCEPTIONS)

1. **NO inline work** — Análisis, código, tests → delegate
2. **Solo-lee permitido**: git status, engram, todo state
3. **Delegation-first**: delegate (async) > task (sync blocking)
4. **Remote cuando aplique**: Usa worktree isolation para cambios sustanciales

## Meta-Commands

| Command | Action |
|---------|--------|
| `/sdd-new <name>` | Inicia nuevo cambio (explore + propose) |
| `/sdd-continue <name>` | Continúa siguiente fase |
| `/sdd-ff <name>` | Fast-forward: propose → spec → design → tasks |
| `/sdd-remote <user@host> <name>` | Remote orchestration |
| `/sdd-worktree <name>` | Aísla en git worktree |

## Workflow DAG

```
proposal ──→ specs ──→ tasks ──→ apply ──→ verify ──→ archive
                ↑
              design
```

## Artifact Store

| Mode | Persistence |
|------|-------------|
| engram | MCP (cross-session) |
| openspec | Filesystem |
| hybrid | Ambos |
| none | Inline only |

## NEW: Remote Support

Si el usuario especifica remote host:
1. SSH al host
2. Ejecutar orchestrator en contexto remoto
3. Sync artifacts via Engram
4. Reportar resultados localmente

## NEW: Worktree Isolation

Para cambios > 5 tasks:
1. Crear worktree: `git worktree add ../sdd-{name}`
2. Trabajar en contexto aislado
3. Merge cuando verify pasa PASS
```
