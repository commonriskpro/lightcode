# Plan: om-context-gaps

Gaps identificados comparando LightCode vs Mastra en el sistema de context window observacional.
Análisis basado en código fuente real de ambos sistemas (mastra-main local + lightcodev2).

---

## Gap 1: Filtrado de mensajes por timestamp vs part-boundary marker

**Mastra:** Embebe `data-om-observation-start` / `data-om-observation-end` como parts DENTRO de cada mensaje. Al filtrar para el LLM, hace part-level slicing: solo envía las parts DESPUÉS del marker.

**LightCode:** Filtra mensajes COMPLETOS por timestamp (`last_observed_at`). Un mensaje con 50 tool calls acumulados en un agentic loop va completo o no va.

**Archivos afectados:** `session/session.sql.ts` (schema), `session/message-v2.ts`, `session/prompt.ts`, `session/processor.ts`

**Complejidad:** Alta — requiere migración DB, cambios en serialización de mensajes y en la lógica de filtrado.

**Prioridad:** Media — `sealedAt` mitiga el caso más básico. Evaluar ROI según duración de loops en producción.

---

## Gap 2: `bufferActivation` retention floor

**Mastra:** Al activar buffers, retiene el `(1 - bufferActivation)` más reciente del historial observado. Con `bufferActivation: 0.8` retiene el 20% más reciente — el LLM tiene overlap entre observations y mensajes recientes.

**LightCode:** Al activar, mueve el boundary al `ends_at` del último buffer. Todos los mensajes anteriores desaparecen del context de golpe. No hay retention floor.

**Archivos afectados:** `session/om/record.ts` (`activate()`), `session/om/buffer.ts`, `session/prompt.ts`, `session/session.sql.ts` (1 campo nuevo: `retention_floor_at`)

**Complejidad:** Media — lógica contenida en activate() + ajuste en prompt.ts.

**Prioridad:** Alta — impacta directamente la continuidad post-activación en todas las sesiones largas.

---

## Gap 3: `OBSERVATION_CONTEXT_INSTRUCTIONS` incompleto

**Mastra tiene, LightCode no tiene:**

- `PLANNED ACTIONS`: si el usuario planeó algo y la fecha ya pasó, asumir que lo completó
- `SYSTEM REMINDERS`: los `<system-reminder>` son guía interna, no contenido del usuario

**LightCode ya tiene:** KNOWLEDGE UPDATES, MOST RECENT USER INPUT

**Archivos afectados:** `session/system.ts` (2 oraciones en `OBSERVATION_CONTEXT_INSTRUCTIONS`)

**Complejidad:** Baja — 5 líneas de texto.

**Prioridad:** Alta — impacto inmediato en calidad de respuesta, costo mínimo.

---

## Gap 4: Per-process mutex para serializar cycles

**Mastra:** `withLock<T>(key, fn)` serializa observation y reflection cycles por thread. Previene que dos cycles concurrentes lean `isObserving=false` y ambos disparen LLM calls duplicados.

**LightCode:** Solo el path `"buffer"` tiene guard (`getInFlight`). Los paths `"activate"` y `"block"` no tienen serialización — en server mode con múltiples sesiones concurrentes puede haber doble-activate.

**Archivos afectados:** `session/om/buffer.ts` (agregar `withLock`), `session/om/record.ts` (`activate()`, `reflect()`)

**Complejidad:** Media — patrón similar al `inFlight` existente.

**Prioridad:** Media — riesgo bajo en CLI, más relevante en server mode.

---

## Fases de implementación

```
FASE 1 — Quick wins (baja complejidad, alto impacto)       ~1-2 días
  Gap 3: OBSERVATION_CONTEXT_INSTRUCTIONS
    + "PLANNED ACTIONS" + "SYSTEM REMINDERS"
    → system.ts, ~5 líneas, 2 tests

FASE 2 — Retention floor (impacto en continuidad)          ~3-5 días
  Gap 2: bufferActivation retention floor
    1. Constante RETENTION_FLOOR = 0.2 en buffer.ts
    2. activate() calcula y persiste retention_floor_at
    3. prompt.ts usa retention_floor_at como boundary real
    → record.ts, prompt.ts, buffer.ts, schema (1 campo)
    → 4 tests nuevos

FASE 3 — Mutex de serialización (robustez server)          ~2-3 días
  Gap 4: per-session lock en activate() + reflect()
    → OMBuf.withLock() usando Map<SessionID, Promise<void>>
    → activate() y reflect() adquieren el lock
    → 3 tests nuevos

FASE 4 — Part-level filtering (complejidad alta)           ~1-2 semanas
  Gap 1: boundary marker en parts
    1. Schema: part_boundary_at: integer() en MessageTable
    2. Observer sella → escribe part_boundary_at en DB
    3. MessageV2.toModelMessages() aplica part-level slice
    4. prompt.ts usa part_boundary_at si existe, timestamp si no
    → Migración DB, message-v2, prompt, processor
    → Evaluar ROI vs sealedAt actual antes de arrancar
```

---

## Estado

- [x] Fase 1 — OBSERVATION_CONTEXT_INSTRUCTIONS
- [x] Fase 2 — Retention floor
- [x] Fase 3 — Mutex de serialización
- [x] Fase 4 — Part-level filtering
- [ ] Fase 4 — Part-level filtering
