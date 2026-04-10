# LightCode — Implementation Plan

Este documento convierte la identidad ya aprobada en un plan técnico y de producto ejecutable.

No parte de cero.  
Parte de estas decisiones cerradas:

- **categoría**: persistent coding system
- **metáfora**: Memory Atlas
- **superficie principal**: Atlas Field
- **paleta base**: Void Black
- **vocabulario visible**: Thread, Anchor, Signal, Drift, Telemetry, Memory Atlas

---

## 1. Objetivo

Implementar una identidad consistente para LightCode sin mezclar tres cosas en la misma iniciativa:

1. rebrand visible
2. rediseño estructural de la interfaz
3. renombre técnico profundo del monorepo

### Regla principal
Primero se implementa lo que el usuario **ve y usa**.  
Lo técnico interno solo se renombra después si sigue siendo conveniente.

---

## 2. Modelo de implementación

La implementación se divide en cuatro capas.

### Capa A — Visible branding
Lo que el usuario ve:
- marca
- copy
- labels
- titles
- empty states
- loading
- términos visibles

### Capa B — Interface system
La estructura visual:
- Atlas Index
- Atlas Field
- Context Panel
- composer
- color system
- contrast / hierarchy

### Capa C — Semantic mapping
Cómo el producto real alimenta la interfaz:
- thread actual
- memory artifacts
- working memory
- observations
- queued work
- drift / tension

### Capa D — Internal hygiene
Lo técnico que no es prioritario:
- package scopes
- folder names internos
- identifiers
- deep link schemes
- binarios

---

## 3. Estado actual del repo

La rama `identity` ya tiene 5 documentos dedicados a identidad, pero siguen empujando una dirección vieja:

- “quiet power”
- base minimal premium
- variantes que ya descartamos
- una idea demasiado amplia de rebrand

Eso ya no coincide con la dirección actual.

### Nuevo eje real
El producto ya no se describe mejor como “quiet power” solamente.  
Ahora se describe mejor como:

> **LightCode = persistent coding system built around a Memory Atlas.**

---

## 4. Qué hay que construir de verdad

## 4.1 Superficies oficiales

### Atlas Index
Columna izquierda:
- filtros
- leyenda
- resumen del campo
- paths accesibles

### Atlas Field
Centro:
- thread activo en el centro
- grafo relacional
- clusters
- edges con jerarquía
- nodos cercanos y nodos periféricos
- pequeñas acciones contextuales

### Context Panel
Derecha:
- nodo seleccionado
- vecinos cercanos
- interpretación del campo
- acciones del nodo o thread

### Prompt surface
La superficie desde donde el usuario emite el siguiente cambio o señal.

---

## 4.2 Semántica oficial

La UI debe reflejar estas entidades:

- **Thread**: unidad principal de trabajo
- **Anchor**: checkpoint, consolidación o punto fijo del hilo
- **Signal**: trabajo pendiente, instrucción activa o relación operativa
- **Drift**: tensión, desalineación o posible conflicto
- **Memory Atlas**: el campo completo de contexto persistente
- **Telemetry**: estado resumido del sistema o del campo

---

## 5. Trabajo documental inmediato

Antes de tocar UI real, esta rama debe actualizar sus propios documentos.

## Archivos a reescribir
- `IDENTITY.md`
- `IDENTITY_DESIGN_BRIEF.md`
- `IDENTITY_IMPLEMENTATION_PLAN.md`
- `IDENTITY_PR_CHECKLIST.md`
- `IDENTITY_ROADMAP.md`

## Objetivo
Que cualquier persona o agente leyendo `identity` encuentre la dirección correcta sin depender del historial del chat.

---

## 6. Plan técnico por fases

## Fase 1 — Documentación alineada
### Tareas
- reescribir los 5 docs de identidad
- borrar decisiones antiguas ya descartadas
- congelar la dirección aprobada
- dejar explícito que Void Black es la base oficial

### Resultado
La rama `identity` pasa a ser confiable como source of truth.

---

## Fase 2 — Branding visible y copy principal
### Áreas
- `README.md`
- títulos visibles
- copy principal
- loading / app titles
- labels principales

### Tareas
- dejar de presentar LightCode como un fork temático
- reencuadrarlo como persistent coding system
- mover lenguaje visible hacia:
  - Thread
  - Anchor
  - Signal
  - Telemetry
  - Memory Atlas

### Resultado
La percepción verbal deja de ser heredada.

---

## Fase 3 — Theme base y palette
### Objetivo
Aplicar Void Black como base coherente.

### Tareas
- fondo casi negro espacial
- superficies oscuras y sobrias
- active thread en cian frío
- anchors/memory en azul frío
- signals en ámbar
- drift en rojo apagado
- reducción fuerte del peso del morado

### Resultado
La interfaz deja de verse como “dark mode genérico” y tampoco cae en sci-fi exagerado.

---

## Fase 4 — Atlas Field shell
### Objetivo
Traducir el layout validado al TUI real.

### Componentes a implementar
- Atlas Index izquierdo
- Atlas Field central
- Context Panel derecho
- field strip superior
- acciones del path o thread

### Reglas
- no convertir el centro en dashboard
- no perder el grafo como pieza principal
- no recargar izquierda o derecha

### Resultado
La estructura base del producto se siente distinta y propia.

---

## Fase 5 — Graph logic adaptada
### Objetivo
Usar lógica tipo Obsidian graph sin copiar la estética.

### Tareas
- centro estable
- vecindad inmediata clara
- clusters legibles
- periferia tenue
- labels cercanos más legibles que los lejanos
- edge hierarchy real

### Resultado
La memoria se percibe como topología, no como decoración.

---

## Fase 6 — Semantic mapping real
### Objetivo
Hacer que el atlas represente entidades reales del sistema.

### Datos candidatos
- thread activo
- work items relacionados
- memory artifacts
- observations
- queued turns or steering signals
- drift / conflict surfaces

### Resultado
El Atlas Field deja de ser mock y empieza a ser producto.

---

## Fase 7 — Prompt integration
### Objetivo
Integrar el composer dentro del lenguaje del atlas.

### Reglas
- no textarea genérica
- no romper el flujo principal
- la interacción debe sentirse como emitir una señal o abrir un cambio sobre el campo actual

### Resultado
El composer se integra al modelo conceptual en vez de vivir aparte.

---

## 7. Mapeo al monorepo

## 7.1 Visible user-facing surfaces
Aquí conviene actuar primero.

### App / desktop / shared UI
- `packages/app/*`
- `packages/desktop/*`
- `packages/ui/*`

### TUI
- `packages/opencode/src/cli/cmd/tui/*`

### Docs y branding visible
- `README.md`
- docs visibles
- settings/help text
- labels principales

## 7.2 Zonas a no tocar en esta iniciativa
- `@opencode-ai/*`
- `packages/opencode` como nombre de carpeta
- `identifier` de desktop
- deep link schemes
- rename masivo de imports

---

## 8. Reglas de implementación

### Regla 1
No introducir nuevas metáforas.

### Regla 2
No reabrir exploración amplia de color o layout.

### Regla 3
No cambiar el layout aprobado sin razón fuerte.

### Regla 4
No mezclar rebrand visible con migración técnica de alto riesgo.

### Regla 5
El grafo debe mantenerse central.

### Regla 6
La derecha debe explicar el campo; no competir con él.

### Regla 7
La izquierda debe orientar; no recargar.

---

## 9. QA mínimo

## Visual
- el fondo se siente espacial sin volverse decorativo
- el morado dejó de dominar
- el thread activo se distingue inmediatamente
- clusters se leen mejor que en un force graph genérico
- la periferia no compite con el centro

## Product
- se entiende qué representa izquierda, centro y derecha
- el grafo sugiere navegación real
- el panel derecho convierte el campo en algo accionable
- el vocabulario visible es coherente

## Anti-goals
- no parece dashboard genérico
- no parece wallpaper con nodos
- no parece OpenCode con skin

---

## 10. Definition of done

Esta iniciativa puede considerarse bien encaminada cuando:

- los 5 docs de `identity` reflejan la nueva dirección
- la paleta oficial es Void Black
- el Atlas Field se mantiene como superficie principal
- el producto usa vocabulario del atlas
- la memoria se percibe como estructura navegable
- el sistema ya no se ve como un rebrand superficial
