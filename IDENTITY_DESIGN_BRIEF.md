# Lightcode — Design Brief

Este documento existe para que cualquier implementador (humano o agente) tenga una **fuente compacta y autoritativa** de decisiones de diseño al ejecutar la nueva identidad de Lightcode.

No reemplaza el roadmap ni el plan técnico. Los complementa.

---

# 1. Qué estamos construyendo

Lightcode no debe sentirse como:

- otro wrapper genérico de LLM
- otro clon oscuro de terminal + AI
- una UI funcional pero sin firma propia

Lightcode debe sentirse como:

- una herramienta seria para builders
- un sistema de trabajo calmado y preciso
- una interfaz con identidad propia
- un producto original, no derivado

---

# 2. Idea central de marca

## Concepto
**Lightcode = quiet power**

## Personalidad
- precisa
- calmada
- técnica
- intencional
- sobria
- builder-first

## Evitar
- futurismo recargado
- demasiados glows
- tono demasiado “AI hype”
- copy genérico estilo “ask anything”
- detalles visuales que se sientan prestados de otro producto

---

# 3. Dirección visual oficial

## Base estética
**Minimalista premium**

## Capa estructural
**OS experimental**

## Acentos permitidos
Solo sutiles:
- foco claro
- glow leve si es muy controlado
- status cues discretos

## Acentos prohibidos
- borde brillante en todos lados
- neón constante
- efectos agresivos
- fondos muy decorativos

---

# 4. Paleta recomendada

## Canon recomendado
### Midnight + Ice
- Fondo: `#0E1320`
- Superficie: `#151C2E`
- Borde: `#26314A`
- Texto principal: `#E6EDF7`
- Texto secundario: `#8FA1BF`
- Acento: `#7DD3FC`

## Alternativa secundaria
### Graphite + Lime
- Fondo: `#111315`
- Superficie: `#1A1D21`
- Borde: `#2A2F36`
- Texto: `#ECEFF4`
- Secundario: `#9AA4B2`
- Acento: `#B8FF65`

## Regla
Si no hay instrucción nueva, implementar **Midnight + Ice** como tema canon.

---

# 5. Regla visual principal

La identidad de Lightcode no depende solo del logo.

Debe salir de la combinación de:

- paleta
- contraste
- espacio negativo
- composer
- tabs
- status surfaces
- copy
- motion discreta

---

# 6. Logo y marca

## Objetivo del logo
Debe sentirse:
- limpio
- propio
- legible
- modular
- usable en app, terminal, splash y favicon

## Objetivo del mark
Debe servir como:
- favicon
- empty state mark
- splash icon
- firma lateral o compacta

## Restricción
No usar una forma que recuerde demasiado al branding anterior.

## Principio
Mejor un mark simple y fuerte que un logo complejo y derivativo.

---

# 7. Tono de interfaz

## Voz deseada
- clara
- útil
- sobria
- más de herramienta que de asistente conversacional genérico

## Ejemplos de tono correcto
- `Describe the change`
- `Shape the next change`
- `Build from context`
- `Open a task`
- `Run a command`

## Ejemplos de tono a evitar
- `Ask anything...`
- frases demasiado vagas
- frases genéricas de chatbot
- exageraciones de marketing

---

# 8. Composer

## Rol del composer
Debe ser la pieza más reconocible del producto.

## Debe sentirse como
- una command surface
- una herramienta operativa
- una superficie de trabajo, no solo una caja de texto

## Debe evitar
- verse como textarea genérica
- exceso de controles visuales
- ruido alrededor del input

## Señales visuales correctas
- buen foco
- separación clara del canvas
- jerarquía limpia entre input y controles
- hint line útil

---

# 9. Navegación y estructura

## La app debe sentirse como
- un workspace
- un entorno operativo
- un sistema liviano pero intencional

## No debe sentirse como
- una sola caja de prompt con paneles pegados alrededor

## Prioridades
- tabs claras
- status strip útil
- panel lateral con jerarquía
- empty states sobrios

---

# 10. Motion

## Regla
Motion discreta, nunca protagonista.

## Permitido
- suavizar focus
- transiciones de panel moderadas
- feedback de hover limpio
- estados activos más claros

## No permitido
- animaciones llamativas
- demasiados rebotes
- glow pulsante constante
- transiciones que ralenticen percepción

---

# 11. Qué no debe hacer un implementador

- no inventar una paleta nueva si ya hay una definida
- no cambiar naming técnico profundo sin estar pedido
- no mezclar rebrand visual con migración de identifiers delicados
- no introducir efectos futuristas porque “se ven cool”
- no dejar copy vieja si ya cambió el branding
- no rediseñar arquitectura profunda cuando el objetivo es identidad visual

---

# 12. Qué sí debe hacer un implementador

- respetar el concepto `quiet power`
- mantener simplicidad
- priorizar claridad y consistencia
- usar el nuevo sistema de color como base
- revisar contraste en pantallas reales
- limpiar branding viejo visible
- mejorar la percepción de calidad sin sobrecargar la interfaz

---

# 13. Criterio de éxito

Una implementación está bien hecha si alguien ve Lightcode y piensa:

> esto se siente como una herramienta propia, seria y bien diseñada

Y está mal hecha si la reacción es:

> se nota que solo cambiaron el logo

---

# 14. Fuentes de verdad para implementar

Al implementar, este documento debe leerse junto con:

- `IDENTITY.md`
- `IDENTITY_ROADMAP.md`
- `IDENTITY_IMPLEMENTATION_PLAN.md`
- `IDENTITY_PR_CHECKLIST.md`

## Prioridad entre documentos
1. `IDENTITY_DESIGN_BRIEF.md`
2. `IDENTITY_PR_CHECKLIST.md`
3. `IDENTITY_IMPLEMENTATION_PLAN.md`
4. `IDENTITY_ROADMAP.md`
5. `IDENTITY.md`

Si hay conflicto, gana el documento más arriba.

---

# 15. Instrucción explícita para agentes de implementación

Al implementar Lightcode:

- no improvises identidad
- no optimices solo por velocidad
- no cambies más de lo necesario por PR
- deja cada PR visualmente coherente
- si una decisión no está cerrada, conserva la estructura actual y documenta el bloqueo en vez de inventar una solución arbitraria