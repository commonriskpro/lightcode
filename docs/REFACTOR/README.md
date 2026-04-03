# SDD Agent Refactoring — Documentation

## Overview

Este directorio contiene el plan de refactorización para integrar las mejores features de los agentes upstream en los SDD agents del fork.

## Documentos

| Documento | Descripción |
|-----------|-------------|
| [01-sdd-orchestrator-vs-build.md](./01-sdd-orchestrator-vs-build.md) | Comparativa orchestrator vs build. Features: Remote execution, worktree isolation |
| [02-sdd-explore-vs-explore.md](./02-sdd-explore-vs-explore.md) | Comparativa explore. Features: BFS/ugrep integration |
| [03-sdd-verify-vs-verify.md](./03-sdd-verify-vs-verify.md) | Comparativa verify. Features: Parallel testing, edge case generation |
| [04-sdd-apply-vs-build.md](./04-sdd-apply-vs-build.md) | Comparativa apply. Features: Incremental verification, parallel tasks |
| [05-sdd-propose-vs-general.md](./05-sdd-propose-vs-general.md) | Comparativa propose. Features: Impact analysis, stakeholder simulation |
| [06-REFACTOR-MASTER-PLAN.md](./06-REFACTOR-MASTER-PLAN.md) | Plan maestro de implementación |

## Skills Refactorizados (v3.0)

| Skill | Version | New Features |
|-------|---------|-------------|
| sdd-explore | v3.0 | BFS/ugrep tool priority, speed metrics |
| sdd-verify | v3.0 | Parallel testing, edge case generation, verification history |
| sdd-apply | v3.0 | Incremental verification, parallel tasks |

## Features Integradas

### De Upstream → Fork

| Feature | Prioridad | Status |
|---------|-----------|--------|
| BFS/ugrep | 🔴 CRÍTICA | ✅ Implementado en sdd-explore v3.0 |
| Parallel testing | 🟡 Media | ✅ Implementado en sdd-verify v3.0 |
| Incremental verify | 🟡 Media | ✅ Implementado en sdd-apply v3.0 |
| Remote execution | 🟡 Media | 📋 Planificado |
| Worktree isolation | 🟡 Media | 📋 Planificado |
| Tool restrictions | 🟢 Baja | 📋 Planificado |

## Roadmap

### Phase 1: Speed (Completado ✅)
- [x] BFS/ugrep integration en sdd-explore
- [x] Speed metrics en output
- [x] Tool priority enforcement

### Phase 2: Parallelization (Completado ✅)
- [x] Parallel test execution en sdd-verify
- [x] Parallel tasks en sdd-apply
- [x] Test suite size detection

### Phase 3: Remote + Worktree (Pendiente)
- [ ] Remote executor implementation
- [ ] Worktree support
- [ ] /sdd-remote meta-command
- [ ] /sdd-worktree meta-command

### Phase 4: Tool Restrictions (Pendiente)
- [ ] PHASE_TOOLS config
- [ ] Tool restriction enforcement
- [ ] Tool audit logging

## Próximos Pasos

1. **Review** los documentos comparativos en `/docs/REFACTOR/`
2. **Test** los skills refactorizados (sdd-explore, sdd-verify, sdd-apply)
3. **Implementar** Phase 3 (Remote + Worktree) si los tests pasan
4. **Actualizar** AGENTS.md con nuevas features
5. **Documentar** cambios en README-FORK.md
