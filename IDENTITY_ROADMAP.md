# Lightcode — Identity Roadmap

Este roadmap aterriza todos los cambios propuestos para darle a Lightcode una identidad propia, coherente y reconocible. La meta no es solo que se vea mejor, sino que se sienta como **un producto original**, no como una interfaz genérica de coding assistant.

---

## Objetivo general

Transformar Lightcode de una herramienta funcional y competente a un producto con identidad clara, personalidad visual, voz propia y elementos distintivos.

### Resultado buscado
Que alguien abra Lightcode y piense:

> Esto no es otro wrapper genérico de LLM; esto es Lightcode.

---

## Principios que se mantienen

Estas bases se conservan porque ya funcionan bien:

- dark mode
- enfoque centrado
- estética dev / terminal
- simplicidad general
- sensación de herramienta rápida y seria

---

## North Star de identidad

### Concepto recomendado
**Lightcode = quiet power**

### Tono
- preciso
- calmado
- técnico
- builder-first
- minimalista pero con carácter

### Dirección recomendada
De las direcciones propuestas, la más sólida para una identidad duradera es:

1. **Minimalista premium** como base
2. **OS experimental** como capa estructural
3. Usar elementos futuristas solo como acento, no como lenguaje dominante

---

# Roadmap por fases

## Fase 1 — Definir la base de marca

### Objetivo
Crear una identidad visual y verbal consistente antes de tocar demasiadas piezas de UI.

### Cambios

#### 1.1 Elegir dirección estética oficial
Decidir cuál será la línea visual principal:

- **Minimalista premium**
- **Futurista neon**
- **OS experimental**

**Recomendación:** usar minimalista premium + estructura tipo sistema.

#### 1.2 Redefinir el wordmark
El wordmark actual debe cambiar porque todavía se siente demasiado derivado.

Explorar estas direcciones:

- `lightcode`
- `LIGHTCODE`
- `light/code`
- `l c`
- `▌lightcode`

#### 1.3 Definir un símbolo de marca
Opciones sugeridas:

- monograma `lc`
- cursor/barra vertical
- símbolo con `[]`
- símbolo con `<>`
- una `L` construida con bloques terminal
- rayo/haz de luz geométrico

#### 1.4 Crear versión ASCII para CLI
Preparar una firma visual para pantallas terminal-only.

#### 1.5 Elegir tipografía de branding
Definir combinación de:

- una fuente monoespaciada para UI y contexto dev
- una secundaria más humana o más refinada para branding, títulos o detalles

### Entregables
- wordmark final
- símbolo final
- lockup horizontal y compacto
- versión ASCII
- criterio tipográfico

### Criterio de éxito
La marca debe poder verse en pequeño y seguir sintiéndose propia.

---

## Fase 2 — Crear un lenguaje visual propio

### Objetivo
Salir del look gris-azulado genérico y construir una firma visual reconocible.

### Cambios

#### 2.1 Elegir paleta oficial
Opciones propuestas:

### Opción A — Midnight + Ice
- Fondo: `#0E1320`
- Superficie: `#151C2E`
- Borde: `#26314A`
- Texto principal: `#E6EDF7`
- Texto secundario: `#8FA1BF`
- Acento: `#7DD3FC`

### Opción B — Graphite + Lime
- Fondo: `#111315`
- Superficie: `#1A1D21`
- Borde: `#2A2F36`
- Texto: `#ECEFF4`
- Secundario: `#9AA4B2`
- Acento: `#B8FF65`

### Opción C — Deep Navy + Amber
- Fondo: `#0F1726`
- Superficie: `#182132`
- Borde: `#2A3A54`
- Texto: `#F3F6FB`
- Secundario: `#93A4BD`
- Acento: `#FFB454`

**Recomendación:** elegir Midnight + Ice o Graphite + Lime.

#### 2.2 Crear sistema de tokens visuales
Definir tokens para:

- background
- panel background
- elevated panel
- border default
- border active
- text primary
- text secondary
- text muted
- accent
- success
- warning
- error
- focus ring
- hover surface
- active surface

#### 2.3 Establecer reglas de contraste
Definir uso de:

- fondo base vs paneles
- acentos solo para foco/acción/estado activo
- secundarios solo para soporte informativo

#### 2.4 Añadir una firma visual sutil
Elegir una o dos, no todas:

- glow vertical en el cursor
- línea tipo scanner en foco
- pulso suave en el borde del composer
- grid muy sutil en el fondo

### Entregables
- paleta oficial
- design tokens
- reglas de contraste
- firma visual sutil

### Criterio de éxito
Aunque se vea oscuro y minimalista, debe sentirse como Lightcode y no como cualquier app dev.

---

## Fase 3 — Rediseñar la pantalla principal

### Objetivo
Cambiar las piezas que más delatan que todavía no es 100% propio.

### Cambios

#### 3.1 Replantear el hero / centro de la pantalla
Hoy el bloque central concentra demasiado la identidad. Hay que hacerlo más propio.

Cambios sugeridos:

- logo más pequeño y refinado arriba
- más aire en la composición
- menos protagonismo de bloque pesado
- transición de “pantalla vacía genérica” a “espacio de trabajo inicial”

#### 3.2 Rehacer el composer principal
El composer debe volverse la pieza más distintiva del producto.

Cambios propuestos:

- borde izquierdo animado como cursor vivo
- fondo distinto al canvas general
- mejor jerarquía entre input, hint y modos
- placeholder con voz propia
- estados claros de foco, hover, disabled y running

#### 3.3 Hacer el composer más ancho y más bajo
Dirección recomendada:

- más horizontal
- menos caja alta y pesada
- más cercano a una command surface que a un textarea genérico

#### 3.4 Incorporar chips o modos visibles
Propuesta inicial:

- `Build`
- `Patch`
- `Explain`
- `Agent`

Alternativas futuras:

- `Craft`
- `Run`
- `Compose`
- `Ship`

#### 3.5 Cambiar la ayuda contextual
Reemplazar textos genéricos por hints con más intención.

Ejemplo sugerido:

`Enter to run · Tab to attach context · Ctrl+P for actions`

### Entregables
- nueva home/empty state
- nuevo composer
- sistema de chips de modo
- estados del composer
- hint line actualizada

### Criterio de éxito
El usuario debe reconocer el composer como una pieza característica de Lightcode.

---

## Fase 4 — Rediseñar navegación y estructura de sistema

### Objetivo
Hacer que la app se sienta más como un sistema propio y menos como una UI genérica con tabs.

### Cambios

#### 4.1 Mejorar tabs superiores
Cambios sugeridos:

- tabs con iconos o puntos de estado
- nombres de workspace más humanos
- acento más claro en tab activo
- separadores más finos y limpios
- mejor jerarquía del active state

#### 4.2 Evaluar session rail lateral
Explorar una estructura alternativa donde parte de la navegación viva en lateral.

Posibles contenidos:

- sesiones recientes
- tasks activas
- agents/workers
- proyectos
- historial breve

#### 4.3 Crear status bar o status strip
Propuesta de datos visibles:

- repo
- branch
- files indexed
- model
- agent state
- task state

Ubicación posible:

- abajo tipo cockpit
- arriba como strip sutil

#### 4.4 Estructura más tipo sistema operativo
A mediano plazo, mover la percepción desde “chat centrado” hacia “workspace operativo”.

### Entregables
- tabs rediseñados
- propuesta de rail lateral
- status strip viva
- layout más estructurado

### Criterio de éxito
La app debe sentirse como un entorno de trabajo, no solo como una caja para prompts.

---

## Fase 5 — Definir la voz del producto

### Objetivo
Construir una voz propia en la UI para que el producto también se reconozca por cómo habla.

### Cambios

#### 5.1 Reemplazar copy genérico
Textos actuales que conviene revisar:

- `Ask anything...`
- `Tip Use {file:path} ...`
- `tab agents`
- `ctrl+p commands`

#### 5.2 Elegir una línea de voz
Opciones propuestas:

### Más sobria
- `What are we building?`
- `Describe the change`
- `Patch a bug, scaffold a feature, inspect a file`

### Más de sistema
- `Open a task`
- `Invoke an agent`
- `Attach context`
- `Run a command`

### Más Lightcode
- `Shape the next change`
- `Point me at the code`
- `Build from context`
- `Trace, patch, refine`

**Recomendación:** usar una voz sobria con toques de sistema.

#### 5.3 Renombrar conceptos internos
Propuestas:

- **agents** → workers / flows / copilots / operators
- **commands** → actions / tools / palette
- **build** → craft / run / compose / ship

#### 5.4 Unificar copy de toda la app
Aplicar la voz a:

- placeholders
- tooltips
- hints
- títulos de panel
- empty states
- loading states
- errores
- confirmaciones

### Entregables
- guía de voz
- renombre de conceptos internos
- microcopy principal actualizado
- base de nomenclatura consistente

### Criterio de éxito
Sin ver el logo, el producto ya debe sonar como Lightcode.

---

## Fase 6 — Añadir elementos únicos de producto

### Objetivo
Introducir funcionalidades o patrones visuales que solo existan en Lightcode o que se sientan particularmente suyos.

### Cambios

#### 6.1 Command composer inteligente
Que el composer detecte y muestre bloques o entidades al escribir.

Elementos sugeridos:

- archivo
- símbolo
- branch
- agent
- diff target

Esto puede representarse como pills, tokens o detecciones inline.

#### 6.2 Timeline de sesión
Pasar de chat plano a flujo de trabajo visible.

Estados sugeridos:

- ask
- inspect
- edit
- run
- diff
- apply

#### 6.3 Status strip viva
Más allá de ser decorativa, debería mostrar el estado real del sistema.

Ejemplos:

- indexing
- applying patch
- agent idle
- task running
- synced / unsynced

#### 6.4 Firma interactiva discreta
No gimmicks exagerados. Solo lo suficiente para que el producto tenga carácter.

### Entregables
- spec de composer inteligente
- spec de timeline
- estados vivos del sistema
- firma interactiva definida

### Criterio de éxito
Lightcode debe tener al menos 2 o 3 rasgos que lo hagan reconocible incluso sin branding visible.

---

## Fase 7 — Motion, refinamiento e iconografía

### Objetivo
Cerrar la identidad con detalles que eleven la percepción de calidad.

### Cambios

#### 7.1 Sistema de motion
Definir movimiento para:

- foco
- hover
- tabs activas
- chips de modo
- aparición de paneles
- progreso de tareas
- cambios de estado del composer

#### 7.2 Iconografía propia
Crear una familia de iconos consistente con la marca.

Aplicaciones:

- tabs
- status strip
- rail lateral
- actions
- states

#### 7.3 Refinar spacing, bordes y jerarquía
Establecer reglas para:

- radios
- padding vertical y horizontal
- densidad de paneles
- grosor de líneas
- opacidad de separadores

#### 7.4 Pulido final de empty states y estados de error
Evitar que vuelvan a sentirse genéricos.

### Entregables
- motion spec
- iconografía base
- spacing system
- estado final pulido de pantalla principal

### Criterio de éxito
La interfaz debe sentirse terminada, intencional y premium.

---

# Priorización realista

Si se quiere máximo impacto sin rehacer todo de golpe, este es el orden recomendado:

## Prioridad 1 — Alto impacto inmediato
1. nuevo logo + wordmark
2. nueva paleta
3. nuevo composer
4. nuevo microcopy

## Prioridad 2 — Hace que se sienta producto propio
5. tabs rediseñados
6. status bar / status strip
7. renombre de conceptos internos
8. home / empty state nueva

## Prioridad 3 — Diferenciación real
9. composer inteligente
10. timeline de sesión
11. session rail lateral
12. firma visual interactiva

## Prioridad 4 — Capa premium
13. motion
14. iconografía
15. pulido visual fino

---

# Propuesta de ejecución por sprints

## Sprint 1 — Foundation
### Meta
Definir identidad base.

### Tareas
- elegir dirección estética oficial
- cerrar paleta
- cerrar wordmark
- cerrar símbolo
- definir tipografía
- definir tokens base

### Resultado
Lightcode ya tiene una base visual propia.

---

## Sprint 2 — Core UI
### Meta
Cambiar lo que más se ve.

### Tareas
- rediseñar pantalla principal
- rehacer composer
- añadir chips de modo
- actualizar placeholder y hints
- refinar logo en home

### Resultado
La primera impresión cambia por completo.

---

## Sprint 3 — Navigation & Structure
### Meta
Hacer que la app se sienta sistema.

### Tareas
- rediseñar tabs
- crear status strip
- explorar session rail lateral
- mejorar layout general

### Resultado
La app deja de sentirse solo como una caja de chat.

---

## Sprint 4 — Voice & Naming
### Meta
Unificar lenguaje.

### Tareas
- definir tono de voz
- cambiar microcopy clave
- renombrar conceptos internos
- revisar empty states y tooltips

### Resultado
Lightcode suena propio.

---

## Sprint 5 — Signature Features
### Meta
Introducir diferenciadores.

### Tareas
- composer inteligente
- timeline de sesión
- estados vivos de sistema
- detalles de firma visual

### Resultado
Lightcode gana elementos memorables.

---

## Sprint 6 — Polish
### Meta
Cerrar calidad percibida.

### Tareas
- motion system
- iconografía
- spacing audit
- visual QA
- refinamiento final

### Resultado
La experiencia se siente completa.

---

# Diseño recomendado para la próxima iteración

## Estructura sugerida
- logo arriba, más pequeño
- composer más ancho y más bajo
- chips visibles: `Build · Patch · Explain · Agent`
- hint line debajo del composer
- barra inferior con estado del sistema

## Hint sugerido
`Enter to run · Tab to attach context · Ctrl+P for actions`

## Datos visibles en barra inferior
- repo
- branch
- files
- model
- agent state

---

# Riesgos a evitar

- quedarse en una paleta demasiado genérica
- sobrecargar con demasiados glows o efectos “futuristas”
- cambiar solo el logo y no el lenguaje del producto
- mantener copy genérico aunque la interfaz cambie
- meter demasiadas ideas nuevas sin una jerarquía clara
- que la app pierda su velocidad o simpleza por exceso de ornamentación

---

# Checklist final de implementación

## Branding
- [ ] wordmark final
- [ ] símbolo final
- [ ] versión ASCII
- [ ] criterio tipográfico

## Visual system
- [ ] paleta oficial
- [ ] tokens de color
- [ ] estados de foco / hover / active
- [ ] firma visual sutil

## Core UI
- [ ] home rediseñada
- [ ] composer nuevo
- [ ] modos visibles
- [ ] hint line propia

## Structure
- [ ] tabs nuevas
- [ ] status strip
- [ ] rail lateral evaluado
- [ ] layout más tipo sistema

## Voice
- [ ] placeholder nuevo
- [ ] hints nuevos
- [ ] renombre de conceptos
- [ ] microcopy unificado

## Differentiators
- [ ] composer inteligente
- [ ] timeline de sesión
- [ ] system states vivos
- [ ] firma interactiva

## Polish
- [ ] iconografía
- [ ] motion
- [ ] spacing audit
- [ ] visual QA

---

# Resumen ejecutivo

La transformación de identidad de Lightcode debería ocurrir así:

1. **Definir marca y paleta**
2. **Rediseñar composer y pantalla principal**
3. **Reestructurar navegación y estados de sistema**
4. **Dar una voz propia al producto**
5. **Añadir 2–3 rasgos únicos y memorables**
6. **Pulir motion, iconografía y detalles**

Con esas capas, Lightcode puede pasar de verse como una buena herramienta técnica a verse como un producto con firma propia, criterio visual y presencia real.