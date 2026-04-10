# LightCode — PR Checklist

Checklist ejecutable para llevar la identidad actual a código sin perder foco.

La dirección ya está cerrada.  
Este checklist existe para ejecutar, no para seguir explorando.

---

## Estado de la dirección

- [x] categoría definida: **persistent coding system**
- [x] metáfora definida: **Memory Atlas**
- [x] superficie principal definida: **Atlas Field**
- [x] paleta base definida: **Void Black**
- [x] lógica de campo definida: **graph-driven**
- [x] inspiración de interacción definida: **Obsidian-like graph logic adaptada**

---

## PR-01 — Refresh documental de la rama `identity`

**Objetivo:** alinear los 5 `.md` con la dirección cerrada.

### Checklist
- [ ] reescribir `IDENTITY.md`
- [ ] reescribir `IDENTITY_DESIGN_BRIEF.md`
- [ ] reescribir `IDENTITY_IMPLEMENTATION_PLAN.md`
- [ ] reescribir `IDENTITY_PR_CHECKLIST.md`
- [ ] reescribir `IDENTITY_ROADMAP.md`
- [ ] eliminar referencias a direcciones ya descartadas
- [ ] dejar Void Black como base explícita
- [ ] dejar Memory Atlas / Atlas Field como concepto oficial

### Aceptación
- [ ] cualquier implementador entiende la dirección sin leer el chat
- [ ] los documentos ya no se contradicen entre sí

---

## PR-02 — Naming visible y framing de producto

**Objetivo:** que el producto se presente como LightCode y no como fork temático.

### Checklist
- [ ] actualizar framing visible a “persistent coding system”
- [ ] introducir “Memory Atlas” como concepto principal
- [ ] revisar uso visible de `session` donde deba migrar a `thread`
- [ ] revisar uso visible de `status` donde deba migrar a `telemetry`
- [ ] revisar uso visible de `memory` donde deba migrar a `memory atlas`
- [ ] revisar uso visible de “steer current turn” donde deba migrar a “inject signal”

### Aceptación
- [ ] la UI y la docs principales usan vocabulario coherente
- [ ] LightCode ya no se enuncia como skin o fork visual

---

## PR-03 — Theme base Void Black

**Objetivo:** fijar el sistema de color oficial.

### Checklist
- [ ] fondo casi negro espacial
- [ ] superficies sobrias y profundas
- [ ] cian frío para thread activo
- [ ] azul frío para anchors y memory
- [ ] ámbar suave para signals
- [ ] rojo apagado para drift
- [ ] reducir morado a atmósfera secundaria
- [ ] revisar contraste de labels cercanos y lejanos
- [ ] revisar contraste de panel derecho
- [ ] revisar contraste de panel izquierdo

### Aceptación
- [ ] la paleta se siente más espacio real que dashboard sci-fi
- [ ] el centro mantiene prioridad visual
- [ ] el morado dejó de dominar

---

## PR-04 — Atlas Field shell

**Objetivo:** convertir el layout aprobado en estructura real.

### Checklist
- [ ] izquierda = Atlas Index
- [ ] centro = Atlas Field
- [ ] derecha = Context Panel
- [ ] field strip superior
- [ ] acciones del path o thread
- [ ] mantener el grafo como pieza principal
- [ ] evitar exceso de cards tradicionales

### Aceptación
- [ ] la composición conserva el balance aprobado
- [ ] el centro sigue siendo el corazón del producto
- [ ] izquierda y derecha apoyan, no compiten

---

## PR-05 — Graph readability

**Objetivo:** acercar el campo a una lectura tipo Obsidian sin copiar su look.

### Checklist
- [ ] nodo central fuerte
- [ ] vecindad inmediata más legible
- [ ] clusters con jerarquía
- [ ] periferia más tenue
- [ ] edges del centro con más importancia visual
- [ ] labels cercanos más legibles que los lejanos
- [ ] drift visible pero no dominante

### Aceptación
- [ ] el grafo se entiende como superficie de navegación
- [ ] no parece wallpaper de constelaciones
- [ ] no parece un force graph sin curaduría

---

## PR-06 — Context panel usable

**Objetivo:** traducir el grafo a acciones y lectura productiva.

### Checklist
- [ ] nodo seleccionado claro
- [ ] relaciones más cercanas
- [ ] interpretación del campo
- [ ] acciones sobre selección
- [ ] labels coherentes con atlas
- [ ] tono más producto que debug panel

### Aceptación
- [ ] el usuario entiende qué significa el campo
- [ ] el panel derecho aporta uso real, no solo descripción

---

## PR-07 — Prompt integration

**Objetivo:** hacer que el composer conviva con el modelo de atlas.

### Checklist
- [ ] evitar textarea genérica
- [ ] alinear el composer al lenguaje del atlas
- [ ] revisar hints y acción principal
- [ ] evaluar “inject signal” como affordance visible
- [ ] mantener intacto el flujo principal

### Aceptación
- [ ] el composer se siente parte del sistema
- [ ] no se rompe submit, paste, history ni navegación

---

## PR-08 — Semantic mapping real

**Objetivo:** que el Atlas Field represente datos reales del sistema.

### Checklist
- [ ] mapear thread activo
- [ ] mapear anchors/checkpoints
- [ ] mapear signals o trabajo pendiente
- [ ] mapear memory artifacts
- [ ] mapear drift o tensiones relevantes
- [ ] priorizar relaciones útiles frente a visualización total

### Aceptación
- [ ] el Atlas Field deja de ser solo mock
- [ ] el grafo representa entidades reales del producto

---

## QA transversal

### Visual
- [ ] fondo suficientemente negro
- [ ] color del thread activo claro
- [ ] anchors diferenciados de signals
- [ ] drift distinguible sin contaminar todo el campo
- [ ] panel derecho legible
- [ ] panel izquierdo mínimo y útil

### Product
- [ ] izquierda orienta
- [ ] centro navega
- [ ] derecha explica y acciona
- [ ] vocabulario consistente
- [ ] la metáfora de atlas se entiende

### Anti-goals
- [ ] no parece OpenCode con otro skin
- [ ] no parece dashboard genérico
- [ ] no parece una UI espacial literal
