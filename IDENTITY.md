# LightCode — Identity Snapshot

Este documento resume la dirección oficial de identidad de LightCode.

Es la referencia más rápida para cualquier persona o agente que necesite entender **qué producto estamos construyendo** antes de tocar UI, copy o estructura visual.

No es un backlog ni un checklist técnico.  
Es una **declaración de producto**.

---

## 1. Qué es LightCode

LightCode no debe presentarse como:

- un fork con theme
- otro chat de código con dark mode
- un wrapper genérico de LLM
- una interfaz de dashboard con widgets intercambiables

LightCode debe presentarse como:

- un **persistent coding system**
- un entorno para trabajo de software de larga duración
- una interfaz donde la memoria es visible, navegable y útil
- un sistema que preserva continuidad entre hilos, señales, anchors y contexto

La frase más cercana a la categoría correcta es:

> **LightCode is a persistent coding system for long-running software work.**

---

## 2. North Star de identidad

### Concepto principal
**Memory Atlas**

### Superficie principal
**Atlas Field**

### Idea de interacción
La navegación no gira alrededor de listas o tabs tradicionales, sino alrededor de un **campo relacional de memoria**:

- el thread activo ocupa el centro
- la memoria relacionada aparece como vecinos cercanos
- las señales pendientes forman clusters
- el drift muestra zonas de tensión o desalineación
- el usuario navega por **relación**, no solo por jerarquía

La inspiración funcional más útil es la lógica del graph de Obsidian, pero reinterpretada para producto:

- menos “grafo de notas”
- más “campo de trabajo relacional”

---

## 3. Qué no queremos construir

No queremos:

- cyberpunk genérico
- neón agresivo
- planetas, cohetes o sci-fi decorativo
- dashboards cargados
- una app que “parezca espacial” pero no use la metáfora en la interacción
- un layout que se sienta decorativo y no operativo

### Regla clave
**No usar espacio como adorno.**  
**Usar espacio como modelo de memoria infinita.**

---

## 4. Personalidad

LightCode debe sentirse:

- preciso
- silencioso
- profundo
- durable
- técnico
- calmado
- orientado a builders

Debe evitar sentirse:

- hype
- juguetón
- demasiado literal
- flashy
- derivado
- recargado

La combinación correcta es:

> **seriedad de herramienta + profundidad de atlas + claridad operativa**

---

## 5. Dirección visual oficial

### Tema visual base
**Void Black**

### Sistema visual
- fondo casi negro, tipo espacio real
- superficies oscuras, densas y sobrias
- brillo mínimo y controlado
- contraste alto, pero elegante
- metáfora cósmica sutil, no literal

### Firma visual
- espacio negativo
- profundidad
- nodos y conexiones
- clusters
- halos suaves
- jerarquía espacial

### Lo que queda descartado
- esquemas muy morados
- gradientes demasiado visibles
- glow constante
- cards genéricas con look dashboard
- exceso de barras de progreso y métricas en bloques repetitivos

---

## 6. Paleta oficial

### Base
- **Background / deep void**: negro espacial casi absoluto
- **Surface**: gris negro con leve tinte frío
- **Border**: azul grisáceo oscuro

### Roles de color
- **Thread activo**: cian frío
- **Anchors / memory**: azul frío
- **Signals**: ámbar suave
- **Drift**: rojo apagado

### Principio
La UI no debe depender del morado para verse cósmica.  
La sensación espacial debe venir del fondo, la profundidad y la topología.

---

## 7. Vocabulario de producto

### Términos canónicos
- **Thread**
- **Anchor**
- **Signal**
- **Drift**
- **Telemetry**
- **Memory Atlas**
- **Atlas Field**

### Términos a evitar como eje principal
- session
- status
- generic memory
- ask anything
- commands como único lenguaje visible

### Traducción funcional deseada
- `Session` → **Thread**
- `Status` → **Telemetry**
- `Memory` → **Memory Atlas**
- `Steer current turn` → **Inject signal**

No todo tiene que renombrarse a nivel técnico interno ahora mismo, pero a nivel visible estos son los términos objetivo.

---

## 8. Estructura de interfaz deseada

### Izquierda
Índice del atlas:
- filtros
- leyenda
- lectura rápida del campo
- acceso a paths o threads

### Centro
Superficie principal:
- grafo vivo
- thread activo en el centro
- clusters cercanos
- anchors, signals y drift alrededor
- acciones mínimas de trabajo

### Derecha
Panel contextual:
- nodo seleccionado
- relaciones más cercanas
- interpretación del campo
- acciones sobre la selección

### Regla
La interfaz debe sentirse como un **workspace relacional**, no como un dashboard de paneles intercambiables.

---

## 9. Prompt surface

El composer no debe ser una textarea genérica.

Debe sentirse como:

- una superficie operativa
- una entrada dentro del atlas
- el lugar donde el usuario emite el siguiente cambio o señal

A futuro, el composer debe convivir con la lógica del atlas, no romperla.

---

## 10. Criterio de éxito

La identidad está bien implementada si alguien ve LightCode y piensa:

> esto no es OpenCode con otro tema; esto es un sistema propio con una idea clara de memoria y continuidad.

Y está mal implementada si la reacción es:

> se ve bonito, pero sigue pareciendo el mismo producto con otro skin.

---

## 11. Orden de prioridad entre documentos

Cuando haya conflicto, usar esta prioridad:

1. `IDENTITY_DESIGN_BRIEF.md`
2. `IDENTITY_IMPLEMENTATION_PLAN.md`
3. `IDENTITY_PR_CHECKLIST.md`
4. `IDENTITY_ROADMAP.md`
5. `IDENTITY.md`

Este documento debe mantenerse corto, estable y útil como resumen ejecutivo.
