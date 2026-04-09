# Lightcode — Plan técnico de implementación de identidad

Este documento convierte el roadmap de identidad en un **plan técnico de ejecución**, aterrizado al repo actual y organizado por paquetes, archivos, componentes, dependencias, criterios de aceptación y riesgos. La meta es que la transición de OpenCode → Lightcode se haga con criterio, sin romper flujos existentes y sin dejar zonas grises.

---

# 1. Objetivo del plan

El objetivo no es solo “cambiar el logo”. El objetivo es implementar una identidad completa para Lightcode en cuatro capas:

1. **Marca**
2. **Sistema visual**
3. **Voz del producto**
4. **Patrones de interfaz distintivos**

Y hacerlo sobre la base real del monorepo actual, que hoy mezcla:

- branding visible de **OpenCode**
- referencias internas a **opencode**
- algunas referencias ya migradas a **lightcode** en tips/configs
- UI TUI
- app/desktop/web
- i18n multiidioma

El resultado buscado es:

> que Lightcode se vea, suene y se perciba como un producto propio, sin quedar en un fork visual a medio camino.

---

# 2. Hallazgos del repo actual

## 2.1 Estructura de workspace
El repo es un monorepo Bun con workspaces en `packages/*` y `sdks/*`.

Áreas relevantes para identidad:

- `packages/ui` → branding compartido, tokens, tema, favicon, componentes base
- `packages/app` → app principal / desktop UI
- `packages/desktop` → shell desktop, splash/loading, Tauri bundle
- `packages/opencode` → TUI, CLI branding, tips, themes, session UI
- `packages/web` → docs/web branding
- `packages/console` → consola/dashboard si también debe alinearse

## 2.2 Branding actual distribuido
Hoy el branding no vive en un solo sitio; está repartido.

### Branding visual compartido
- `packages/ui/src/components/logo.tsx`
- `packages/ui/src/components/favicon.tsx`

### Branding TUI
- `packages/opencode/src/cli/logo.ts`
- `packages/opencode/src/cli/cmd/tui/component/logo.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/home/footer.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/footer.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx`

### Branding app / desktop
- `packages/app/src/pages/home.tsx`
- `packages/app/src/components/session/session-new-view.tsx`
- `packages/desktop/src/loading.tsx`
- `packages/desktop/src-tauri/tauri.conf.json`

### Voz / microcopy
- `packages/app/src/i18n/en.ts`
- resto de locales en `packages/app/src/i18n/*.ts`
- parte del TUI tiene strings inline dentro de componentes

## 2.3 Riesgo principal detectado
El repo no está 100% unificado en naming.

Ejemplos:

- todavía hay muchísimo **OpenCode** en UI y config
- en tips ya aparecen referencias como `lightcode.json`, `~/.config/lightcode/tui.json`, `.lightcode/...`
- el desktop bundle todavía usa `OpenCode Dev`, `OpenCode`, esquema deep-link `opencode`
- el scope de paquetes/imports sigue siendo `@opencode-ai/*`

Esto significa que la migración debe hacerse por capas:

- **capa 1: branding visible al usuario**
- **capa 2: branding operativo y docs**
- **capa 3: naming técnico interno**, solo si de verdad compensa el costo

---

# 3. Principio rector de implementación

## 3.1 Regla base
**No renombrar todo el universo a la vez.**

Hay que separar:

### A. Lo que el usuario ve
Eso sí debe migrar pronto:

- logo
- wordmark
- splash
- favicon
- placeholders
- hints
- nombres de vistas
- home states
- loading states
- footer/status copy
- app title visible

### B. Lo que afecta compatibilidad técnica
Eso debe migrar en fase dedicada:

- package scope `@opencode-ai/*`
- nombres de directorio internos como `packages/opencode`
- Tauri `identifier`
- deep-link scheme `opencode://`
- nombres de binarios
- configuración histórica si hay usuarios existentes

## 3.2 Regla de seguridad
Todo cambio de identidad debe caer en una de estas categorías:

- **seguro e inmediato**
- **requiere compatibilidad temporal**
- **posponer hasta tener release plan**

---

# 4. Decisiones de producto que deben quedar cerradas antes de tocar código

Antes de implementar, hay que congelar estas decisiones. Sin esto, el trabajo se fragmenta.

## 4.1 Nombre público
**Lightcode**

## 4.2 Personalidad
Recomendación final:

- base: **minimalista premium**
- estructura: **OS experimental**
- acentos: discretos, no cyberpunk excesivo

## 4.3 Paleta oficial
Elegir una sola como base de sistema.

Recomendación:

### Opción preferida 1 — Midnight + Ice
- fondo: `#0E1320`
- superficie: `#151C2E`
- borde: `#26314A`
- texto principal: `#E6EDF7`
- texto secundario: `#8FA1BF`
- acento: `#7DD3FC`

### Opción preferida 2 — Graphite + Lime
- fondo: `#111315`
- superficie: `#1A1D21`
- borde: `#2A2F36`
- texto: `#ECEFF4`
- secundario: `#9AA4B2`
- acento: `#B8FF65`

## 4.4 Convención de voz
Recomendación:

- tono sobrio
- técnico
- orientado a builders
- menos “ask anything”
- más “shape the next change / describe the change / build from context”

## 4.5 Política de naming interno visible
Decidir y documentar:

- `agents` → ¿se queda? ¿pasa a `operators`? ¿`workers`?
- `commands` → ¿`actions`? ¿`palette`? ¿`tools`?
- `Build` → ¿permanece como modo principal?

### Recomendación
No renombrar toda la ontología el mismo día.

Primera iteración:

- mantener `Build`
- cambiar `commands` por `actions` en la UI donde tenga sentido
- evaluar `agents` → `operators` solo si queda consistente en toda la app

## 4.6 Política de config
El repo ya sugiere `lightcode.json` en algunos lugares, pero todavía arrastra naming viejo.

Debe definirse:

- archivo canónico: `lightcode.json`
- compatibilidad legacy: aceptar `opencode.json` durante una ventana
- carpeta canónica: `.lightcode/`
- compatibilidad legacy: aceptar `.opencode/` si existe ecosistema previo

**Importante:** esto no se cambia a ciegas. Requiere auditoría de parser/config/loaders antes de declarar deprecación.

---

# 5. Estrategia de implementación por capas

La implementación se divide en 8 capas.

1. **Marca compartida**
2. **Sistema visual compartido**
3. **TUI / CLI**
4. **App / Desktop UI**
5. **Microcopy e i18n**
6. **Docs / metadata / naming visible**
7. **Compatibilidad / migraciones**
8. **QA / rollout**

---

# 6. Capa 1 — Marca compartida

## Objetivo
Crear una única fuente de verdad para logo, mark, splash y favicon de Lightcode.

## Archivos principales
- `packages/ui/src/components/logo.tsx`
- `packages/ui/src/components/favicon.tsx`
- assets nuevos que haya que añadir en `packages/ui` / `packages/app/public` / `packages/desktop/...`

## 6.1 `packages/ui/src/components/logo.tsx`
Hoy este archivo exporta:

- `Mark`
- `Splash`
- `Logo`

Todos representan el branding visual actual.

### Cambios a implementar

#### A. Reemplazar `Mark`
Debe convertirse en el símbolo base de Lightcode.

Opciones válidas:

- barra/cursor vertical
- monograma `lc`
- símbolo geométrico construido como bloque terminal
- variante modular que funcione en 16×16, 32×32, 80×100 y UI pequeña

#### B. Reemplazar `Splash`
Debe ser una versión ampliada del mark, no un asset paralelo desconectado.

#### C. Reemplazar `Logo`
El wordmark actual debe cambiar a una forma más propia de Lightcode.

Recomendación:

- mantener versión SVG para app/web
- asegurar legibilidad en tamaños pequeños
- preparar también variante solo mark y variante horizontal completa

### Restricciones técnicas
- mantener misma API de exports (`Mark`, `Splash`, `Logo`) para minimizar cambios aguas abajo
- no romper importaciones existentes mientras se migra el resto
- cambiar implementación, no necesariamente los nombres de export en esta fase

### Criterios de aceptación
- el nuevo `Mark` funciona en sidebars, empty states, splash y favicon
- `Logo` no recuerda visualmente a OpenCode
- `Splash` puede usarse en loading sin perder nitidez

## 6.2 `packages/ui/src/components/favicon.tsx`
Hoy todavía expone:

- meta title para Apple con `OpenCode`
- assets de favicon con nombres versionados `v3`

### Cambios a implementar
- cambiar `Meta name="apple-mobile-web-app-title" content="OpenCode"` por `Lightcode`
- reemplazar referencias de favicon si cambian nombres de assets
- mantener compatibilidad con las rutas existentes hasta que los nuevos assets estén listos

### Tareas concretas
- generar set nuevo de favicon / apple touch icon / manifest icon
- decidir si se conserva la convención `v3` o si se limpia a nombres semánticos
- revisar si `packages/web/src/components/Head.astro` o equivalentes usan estos mismos assets

### Criterios de aceptación
- navegador, webapp y sistemas móviles muestran Lightcode, no OpenCode

## 6.3 Assets derivados
### Deben existir al final de esta capa
- logo horizontal SVG
- mark SVG
- splash SVG
- favicon PNG/ICO
- apple touch icon
- desktop icons base
- posible variante monocroma para fondos oscuros y claros

---

# 7. Capa 2 — Sistema visual compartido

## Objetivo
Definir un sistema de color y superficie que alimente app, desktop y, donde aplique, web.

## Archivos principales
- `packages/ui/src/theme/resolve.ts`
- probablemente también `packages/ui/src/styles/theme.css`
- probablemente `packages/ui/src/styles/tailwind/colors.css`

## 7.1 `packages/ui/src/theme/resolve.ts`
Este archivo ya resuelve tokens visuales de alto nivel.

### Qué hacer aquí
No parchear colores sueltos en componentes. En vez de eso:

1. definir la paleta semilla de Lightcode
2. derivar los tokens desde ahí
3. documentar el preset oficial

### Estrategia recomendada
Crear una variante Lightcode explícita.

Ejemplo conceptual:

- `lightcodeMidnightIce`
- `lightcodeGraphiteLime`

No hace falta exponer dos temas al usuario si no quieres; pero sí conviene que el código tenga un preset claro.

### Decisión importante
Hay dos formas de hacerlo:

#### Opción A — Reemplazar tokens del tema actual por los nuevos
Más rápida, más riesgosa.

#### Opción B — Crear preset nuevo y luego apuntar defaults a ese preset
Más limpia.

**Recomendación:** Opción B.

### Tareas concretas
- crear definición de palette/seeds Lightcode
- mapear tokens principales:
  - `background-base`
  - `background-stronger`
  - `surface-raised-*`
  - `text-*`
  - `icon-*`
  - `border-*`
  - `surface-interactive-*`
  - `surface-success/warning/critical/info-*`
- revisar contraste de:
  - tabs
  - prompt surface
  - selected states
  - focus ring
  - hover states
  - ghost buttons

### Tokens que más afectan identidad y deben revisarse sí o sí
- `background-base`
- `surface-raised-stronger-non-alpha`
- `text-weak`
- `text-strong`
- `icon-weak-base`
- `icon-strong-base`
- `border-weak-base`
- `border-weaker-base`
- `surface-interactive-base`
- `surface-brand-base`

## 7.2 Firma visual sutil
La firma visual debe venir de tokens y pocos detalles, no de hacks sueltos.

### Recomendación técnica
Implementarla en 2 niveles:

#### Nivel 1 — color + contraste
- superficies un poco más profundas
- foco más nítido
- acento más reconocible

#### Nivel 2 — motion y glow leve
- foco del composer
- selected tab
- indicadores vivos de estado

No meter glow global en todos los componentes.

## 7.3 Temas y coherencia
Si Lightcode va a convivir con varios temas, define uno como canon.

### Recomendación
- tema por defecto = Lightcode Midnight/Ice o Graphite/Lime
- temas históricos siguen disponibles como opción avanzada
- la identidad visual oficial de screenshots, docs y web debe usar siempre el tema canon

### Criterios de aceptación
- cualquier screenshot de la app tiene una firma de color reconocible
- el nuevo branding no depende solo del logo

---

# 8. Capa 3 — TUI / CLI

## Objetivo
Hacer que la experiencia terminal se sienta genuinamente Lightcode, no solo “OpenCode con otro nombre”.

## Archivos principales
- `packages/opencode/src/cli/logo.ts`
- `packages/opencode/src/cli/cmd/tui/component/logo.tsx`
- `packages/opencode/src/cli/cmd/tui/context/theme.tsx`
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/home/footer.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/footer.tsx`
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

## 8.1 TUI logo

### `packages/opencode/src/cli/logo.ts`
Este archivo define el wordmark ASCII/bloques.

### `packages/opencode/src/cli/cmd/tui/component/logo.tsx`
Lo renderiza con color principal/secundario y sombras.

### Plan
- rediseñar el ASCII logo completo para Lightcode
- reducir sensación de logo “pesado/bloqueado derivado”
- mantener un estilo terminal-native

### Recomendación de implementación
Preparar 2 variantes:

#### Variante A — wordmark terminal limpio
Más minimalista y más madura.

#### Variante B — marca modular con cursor/barra
Más distintiva para boot/home.

### Criterios técnicos
- no usar una estructura demasiado ancha que rompa layouts pequeños
- verificar legibilidad con `theme.text` y `theme.textMuted`
- mantener la lógica de sombra solo si aporta; si no, simplificar

## 8.2 Temas TUI

### Archivo
`packages/opencode/src/cli/cmd/tui/context/theme.tsx`

Actualmente:
- importa múltiples JSON themes
- el default activo es `opencode`
- el listado `DEFAULT_THEMES` incluye `opencode`

### Plan
Añadir temas Lightcode y usar uno como default.

### Tareas concretas
- crear `theme/lightcode-midnight.json`
- crear opcionalmente `theme/lightcode-graphite.json`
- añadirlos a `DEFAULT_THEMES`
- cambiar el default desde `opencode` a `lightcode-midnight` cuando el branding esté listo
- revisar campos:
  - `primary`
  - `secondary`
  - `accent`
  - `text`
  - `textMuted`
  - `background`
  - `backgroundPanel`
  - `backgroundElement`
  - `border`
  - `borderActive`
  - markdown colors
  - syntax colors

### Importante
No conviene borrar el tema `opencode` en la primera iteración. Mejor:

- añadir Lightcode
- mover default
- conservar OpenCode theme por compatibilidad temporal

## 8.3 Composer TUI

### Archivo principal
`packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`

Este es uno de los archivos más importantes de toda la migración visual TUI.

### Qué debe cambiar

#### A. Placeholder
Actualmente usa copy como:
- `Ask anything...`
- `Run a command...`

Debe migrar a voz propia.

#### B. Hint inferior
Hoy muestra:
- `tab agents`
- `ctrl+p commands`

Debe migrar a algo más propio.

#### C. Surface visual
El cuadro actual necesita más identidad:

- borde/foco más reconocible
- diferenciación frente al canvas
- sensación de “command surface”

#### D. Modos visibles
Hay espacio para que `Build / Patch / Explain / Agent` se vuelvan affordances reales.

### Estrategia técnica recomendada
No rehacer toda la lógica del input primero. Separar en 3 pasos:

#### Paso 1 — copy + estructura visual
- placeholder
- hint line
- labels
- balance de padding, altura, foco

#### Paso 2 — chips de modo visuales
- primero decorativos/indicativos
- luego conectarlos al estado real si compensa

#### Paso 3 — composer inteligente
- tokens inline para archivo, agente, rama, símbolo, etc.

### Cambios concretos sugeridos en este archivo
- revisar layout de `inputBox`
- revisar `PromptInput`
- revisar `PromptActionBar`
- revisar copy de ayuda al pie
- revisar uso de `theme.backgroundElement`, `theme.primary`, `theme.textMuted`
- revisar placeholder examples

### Copy recomendada
En TUI, una buena línea base sería:

- placeholder: `Shape the next change...`
- shell: `Run a command`
- hint: `Enter to run · Tab to attach context · Ctrl+P for actions`

## 8.4 Home footer TUI

### Archivo
`packages/opencode/src/cli/cmd/tui/feature-plugins/home/footer.tsx`

Hoy ya muestra información útil:
- directorio / branch
- MCP status
- versión

### Oportunidad
Esto puede convertirse en una **status strip** con identidad Lightcode.

### Qué hacer
- mantener repo/path/branch porque aporta contexto real
- mejorar jerarquía visual
- revisar nombre/etiquetas de MCP y status
- usar layout más tipo cockpit si queda bien

### Recomendación
No inflarlo demasiado. Debe seguir siendo terminal-friendly.

## 8.5 Tips TUI

### Archivos
- `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx`

### Problema actual
Es una de las zonas con más mezcla de naming.

Hay tips que todavía dicen `OpenCode`, otros que ya usan `lightcode.json` o `.lightcode/`.

### Qué hacer
Hacer una auditoría completa del array `TIPS` y normalizarlo.

### Criterios de reescritura
- todo branding público debe decir Lightcode
- si la config canónica será `lightcode.json`, todos los tips deben alinearse
- si existe compatibilidad legacy, **no** anunciar el nombre viejo en UI principal; eso va a docs/migración
- revisar también URLs públicas como `opencode.ai` y cualquier referencia a sharing/docs/Zen

### Decisión pendiente
Si “OpenCode Zen” sigue existiendo como producto/proveedor aparte, hay que decidir si:

- se renombra también
- se presenta como un proveedor externo heredado
- se elimina de la narrativa principal

No dejar esto ambiguo.

## 8.6 Sidebar footer TUI

### Archivo
`packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/footer.tsx`

Problemas actuales:
- tarjeta de onboarding sigue diciendo OpenCode
- footer visual muestra explícitamente `Open` + `Code`

### Qué hacer
- reescribir onboarding card con branding Lightcode
- revisar si sigue existiendo el bloque “Getting started” en esta forma o se hace más sobrio
- reemplazar completamente la firma `OpenCode` del footer

### Recomendación
Cambiar esa zona por una combinación de:

- nombre de proyecto/worktree
- versión
- estado del sistema
- opcionalmente una firma mínima Lightcode

No repetir el logo grande por todas partes.

## 8.7 Session route TUI

### Archivo
`packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

Este archivo concentra mucho comportamiento y también copy sensible.

### Zonas a revisar
- comandos de sesión con labels visibles
- exit banner con `UI.logo(...)`
- strings como `Show sidebar`, `Share session`, etc.
- metadata footer de mensajes
- percepción general del layout session + sidebar

### Qué implementar

#### A. Revisar copy visible de acciones clave
No hace falta renombrar cada comando interno, pero sí los labels visibles al usuario donde ayude a la identidad.

#### B. Revisar banner de salida
Si el CLI/TUI imprime marca al salir o suspender, debe ser Lightcode.

#### C. Evaluar status cues
La sesión TUI ya tiene muchas affordances. Aquí conviene mejorar el tono visual, no reestructurar todo a la vez.

### Recomendación táctica
En esta fase:
- no tocar arquitectura de sesión profunda
- sí tocar branding, labels, hints y visual hierarchy

---

# 9. Capa 4 — App / Desktop UI

## Objetivo
Hacer que la app se vea como Lightcode desde la primera pantalla hasta el composer de sesión.

## Archivos principales
- `packages/app/src/pages/home.tsx`
- `packages/app/src/components/session/session-new-view.tsx`
- `packages/app/src/components/prompt-input.tsx`
- `packages/app/src/components/prompt-input/placeholder.ts`
- `packages/app/src/pages/session/session-side-panel.tsx`
- `packages/desktop/src/loading.tsx`
- `packages/desktop/src-tauri/tauri.conf.json`

## 9.1 Home de la app

### Archivo
`packages/app/src/pages/home.tsx`

### Estado actual
- logo centrado desvanecido
- lista de proyectos recientes
- empty state simple

### Qué cambiar
La home debe dejar de verse como “pantalla genérica con logo” y verse como un espacio inicial Lightcode.

### Implementación propuesta

#### A. Reemplazar hero visual
- usar el nuevo `Logo`
- reducir tamaño y peso del logo si hace falta
- mejorar composición general

#### B. Mejorar jerarquía del estado inicial
- recent projects
- open project CTA
- estado del server

#### C. Cambiar copy
- evitar tono demasiado funcional/genérico
- mantener claridad

### Resultado esperado
La home debe sentirse como un producto intencional, no solo una página de arranque.

## 9.2 New session / empty state de sesión

### Archivo
`packages/app/src/components/session/session-new-view.tsx`

### Estado actual
- usa `Mark`
- título centrado desde i18n
- muestra proyecto/worktree y metadata

### Qué hacer
- actualizar `Mark` visualmente
- revisar composición del espacio vacío
- hacer más protagónico el “momento de empezar”

### Recomendación
No añadir ruido. Solo:
- mejor mark
- mejor copy
- mejor spacing
- más claridad visual

## 9.3 Composer app

### Archivos
- `packages/app/src/components/prompt-input.tsx`
- `packages/app/src/components/prompt-input/placeholder.ts`
- `packages/app/src/i18n/en.ts`

Este es el corazón del cambio visual en la app.

## 9.3.1 Objetivo funcional
El composer debe convertirse en la pieza más distintiva de Lightcode.

## 9.3.2 Objetivo visual
Debe sentirse menos como una caja de texto genérica y más como una superficie de trabajo inteligente.

## 9.3.3 Cambios de implementación

### A. Placeholder
Hoy el helper `promptPlaceholder()` delega a claves como:
- `prompt.placeholder.shell`
- `prompt.placeholder.normal`
- `prompt.placeholder.simple`
- `prompt.placeholder.summarizeComments`

### Plan
Cambiar primero el helper solo si hace falta lógica nueva. Si no, mantenerlo y reescribir las strings.

### B. Copy base
En `packages/app/src/i18n/en.ts` cambiar:

- `Ask anything...`
- ejemplos genéricos
- labels de help

### C. Surface del composer
En `prompt-input.tsx` revisar:

- `DockShellForm`
- fondo y gradiente inferior
- attach button izquierdo
- send button derecho
- altura/padding
- barra inferior con agent/model/variant/permissions

### D. Modos visibles
El roadmap sugiere chips tipo:
- Build
- Patch
- Explain
- Agent

### Implementación recomendada
No reemplazar de inmediato el sistema real de agent/model/variant si todavía no está alineado. Mejor:

#### Opción segura
- introducir una capa visual de “mode chips” encima o dentro del tray
- mapear inicialmente esos chips al estado existente donde sea posible

#### Opción mínima viable
- comenzar por **Build / Shell / Context-aware states**
- dejar `Patch / Explain / Agent` para fase posterior si no tienen backend claro

### E. Barra inferior / status composer
Hoy ya existe tray con:
- agent
- model
- variant
- permissions

La oportunidad es convertir eso en una **command rail** más propia.

### Recomendación
- mantener la funcionalidad actual
- mejorar tratamiento visual
- revisar naming donde haga falta
- consolidar spacing y contrastes

## 9.3.4 Composer inteligente
Esto no es para la primera PR visual, pero sí debe estar especificado.

### Qué es
Detección visual de entidades en el prompt:
- archivo
- comentario
- agente
- rama
- símbolo
- targets de diff/context

### Qué parte del código tocaría
Principalmente:
- `prompt-input.tsx`
- editor DOM helpers
- attachments/context items
- slash/at popovers

### Recomendación técnica
Separarlo en subfases:

1. visual refinement
2. mode chips
3. tokenization/intelligent composer

## 9.4 Side panel, tabs y estructura de sesión

### Archivo
`packages/app/src/pages/session/session-side-panel.tsx`

### Qué hay hoy
- tabs para review/context/files
- empty state con `Mark`
- file tree a la derecha
- revisión visual bastante funcional

### Qué debe cambiar
- tabs con mayor identidad
- active states más claros
- empty state alineado a nueva marca
- sensación de “workspace operativo”, no solo panel utilitario

### Cambios recomendados

#### A. Tabs
- reforzar estado activo
- revisar contraste de la pestaña seleccionada
- revisar labels si alguno necesita renombre

#### B. Empty panel branding
- nuevo `Mark`
- mejor texto de ayuda

#### C. Sensación de rail/sistema
Sin reescribir layout entero, sí se puede:
- mejorar divisores
- mejorar fondo y densidad
- mejorar percepción de estructura

## 9.5 Desktop loading

### Archivo
`packages/desktop/src/loading.tsx`

### Qué hacer
- cambiar `Splash` por el nuevo de Lightcode
- revisar texto de loading si menciona OpenCode en i18n asociada
- alinear progress bar y palette con la nueva identidad

### Criterio
El loading screen debe sentirse coherente con la home y el resto del producto.

## 9.6 Desktop bundle metadata

### Archivo
`packages/desktop/src-tauri/tauri.conf.json`

### Estado actual
- `productName`: `OpenCode Dev`
- `mainBinaryName`: `OpenCode`
- `identifier`: `ai.opencode.desktop.dev`
- deep-link scheme: `opencode`
- icon bundle en `icons/dev/...`

### Esto NO debe hacerse a la ligera
Cambiar `identifier`, `mainBinaryName` o scheme puede afectar:
- updates
- instalaciones existentes
- asociaciones del sistema
- deep links
- scripts externos

### Estrategia recomendada

#### Fase 1
Cambiar solo branding visual y visible:
- window title visible si aplica
- splash/loading
- icon assets
- nombre visible de la app en UI

#### Fase 2
Planificar migración de bundle:
- `productName` → Lightcode
- `mainBinaryName` → Lightcode o `lightcode`
- scheme → `lightcode`
- `identifier` nuevo solo con release plan claro

### Regla
No tocar `identifier` en la misma tanda del rediseño visual.

---

# 10. Capa 5 — Voz del producto e i18n

## Objetivo
Que Lightcode también se reconozca por cómo habla.

## Archivos principales
- `packages/app/src/i18n/en.ts`
- `packages/app/src/i18n/*.ts`
- `packages/console/app/src/i18n/*.ts` si la consola se alinea
- strings inline del TUI

## 10.1 Fuente de verdad de copy
El archivo más crítico es:

- `packages/app/src/i18n/en.ts`

Aquí está una parte enorme del lenguaje visible.

## 10.2 Estrategia recomendada
### No intentar traducir todo al mismo tiempo
Primero:
1. reescribir inglés fuente
2. verificar flows y tono
3. después propagar a otros idiomas

## 10.3 Qué familias de strings revisar primero

### A. Prompt / composer
- placeholders
- send / stop / attach labels
- tooltips
- mode labels

### B. Home / empty states
- recent projects
- no projects
- start session
- build anything / similar

### C. Settings / product labels
- “OpenCode Desktop”
- “Change the display language for OpenCode”
- “Choose whether OpenCode…”

### D. Provider/help text
- referencias a OpenCode Zen
- descripciones de onboarding

### E. Toasts y actualizaciones
- “A new version of OpenCode…”

## 10.4 Política de tono
Aplicar estas reglas:

- menos frases genéricas tipo “Ask anything”
- menos lenguaje de wrapper AI genérico
- más lenguaje de trabajo sobre código
- claridad > poesía
- identidad sin perder precisión

## 10.5 Plan de i18n por fases

### Fase A — inglés fuente
Actualizar `en.ts`

### Fase B — fallback controlado
Decidir si los otros idiomas:
- quedan temporalmente con copy anterior
- o se les hace una pasada mínima en los strings más visibles

### Fase C — localización completa
Actualizar:
- `packages/app/src/i18n/*.ts`
- `packages/console/app/src/i18n/*.ts` si aplica

### Recomendación
No bloquear el rediseño por traducciones completas. Hacer primero inglés + paths críticos.

---

# 11. Capa 6 — Docs, metadata y naming visible

## Objetivo
Eliminar la sensación de mezcla entre marcas.

## Áreas a auditar
- README principal y variantes
- docs web
- nombres públicos de producto
- favicons/meta titles
- textos de help/tips
- referencias a sharing / URLs
- OpenCode Zen / opencode.ai

## 11.1 Naming visible vs naming técnico
Debe quedar escrita esta regla:

### Visible al usuario
Debe decir **Lightcode**

### Técnico/interno
Puede seguir diciendo `opencode` temporalmente donde renombrar sea caro o riesgoso

### Ejemplos
#### Sí cambiar ya
- título de app
- loading text
- logo/mark
- help copy
- onboarding text
- settings copy
- footer branding

#### No cambiar todavía sin plan
- package names `@opencode-ai/*`
- carpeta `packages/opencode`
- imports masivos
- identifier de bundle

## 11.2 Config docs
Como ya aparece `lightcode.json` en algunos tips, hay que decidirlo formalmente.

### Recomendación
- canónico nuevo: `lightcode.json`
- aceptar `opencode.json` como alias legacy
- documentar precedencia y deprecación

Pero esto solo después de revisar loaders reales.

## 11.3 URLs y naming de servicios
Si el producto sigue usando infraestructura o URLs `opencode.ai`, hay tres opciones:

1. dejar infraestructura interna tal cual y cambiar solo labels visibles
2. usar marca “Lightcode” sobre backend heredado temporalmente
3. migrar dominios públicos más adelante

La opción 1 o 2 es la más realista al principio.

---

# 12. Capa 7 — Compatibilidad y migraciones

## Objetivo
Proteger usuarios existentes, flujos, enlaces y config.

## 12.1 No romper config legacy
Si hoy existen usuarios con:
- `opencode.json`
- `.opencode/`
- theme `opencode`
- CLI/desktop integrados

la migración debe contemplar alias o fallback.

## 12.2 No romper imports internos sin necesidad
El scope `@opencode-ai/*` no aporta nada visible al usuario. Renombrarlo ahora mismo tiene costo alto y retorno bajo.

### Recomendación explícita
**No renombrar `@opencode-ai/*` en esta iniciativa de identidad.**

Eso puede ser un proyecto aparte de hygiene técnica.

## 12.3 No romper bundle/installations
`packages/desktop/src-tauri/tauri.conf.json` requiere plan específico.

### Posponer para fase dedicada
- `identifier`
- deep link scheme
- binario principal

## 12.4 Compatibilidad de temas
Si cambias default de tema en TUI/app:
- mantener acceso al tema viejo una versión o dos
- no romper configuraciones de usuario que referencien `opencode`

## 12.5 Compatibilidad de screenshots y docs
Actualizar docs oficiales cuando el nuevo branding esté ya implantado en los componentes críticos. No antes.

---

# 13. Capa 8 — QA, rollout y validación

## Objetivo
Evitar que el producto termine con identidad inconsistente o con regresiones visuales.

## 13.1 QA visual mínimo obligatorio
Hacer capturas comparativas de:

### TUI
- home
- composer vacío
- composer con texto
- sidebar abierta
- session con herramientas
- footer/status strip
- tips visibles

### App/Desktop
- home
- new session empty state
- session with prompt idle
- session with prompt active
- side panel tabs
- loading screen
- settings appearance section

## 13.2 Checklist funcional

### Composer app
- attach files sigue funcionando
- send/stop no se rompieron
- shell mode sigue funcionando
- history, slash, at-mention, comments siguen funcionando

### Composer TUI
- prompt entry
- shell toggle
- tab/command navigation
- placeholder updates
- agents/actions hints

### Branding
- logo se ve bien en dark/light si aplica
- splash no pixelado
- favicon correcto
- footer y empty states consistentes

### i18n
- inglés sin claves rotas
- locales no crashean si faltan strings nuevas

## 13.3 Definición de done
La iniciativa de identidad está “done” cuando:

1. la marca visible es Lightcode en TUI, app y desktop
2. la home y el composer tienen una firma visual propia
3. el copy principal ya no suena genérico ni mezcla OpenCode/Lightcode
4. los themes por defecto reflejan la nueva paleta
5. no hay regresiones graves en flujos principales

---

# 14. Plan de implementación por fases concretas

## Fase 0 — Freeze de decisiones
### Entregables
- wordmark final
- mark final
- splash final
- paleta oficial
- reglas de voz
- decisión sobre `lightcode.json`

### No escribir código aún
Solo cerrar decisiones.

---

## Fase 1 — Shared branding foundation
### Archivos
- `packages/ui/src/components/logo.tsx`
- `packages/ui/src/components/favicon.tsx`
- assets nuevos relacionados

### Tareas
- reemplazar `Mark`
- reemplazar `Splash`
- reemplazar `Logo`
- actualizar favicon/meta title
- generar icon set base

### Resultado
Todo componente que consume branding compartido ya está listo para Lightcode.

---

## Fase 2 — Shared visual system
### Archivos
- `packages/ui/src/theme/resolve.ts`
- styles asociados si hace falta

### Tareas
- crear preset Lightcode
- ajustar tokens principales
- validar contraste de componentes críticos
- documentar tema canon

### Resultado
La identidad ya no depende solo del logo.

---

## Fase 3 — TUI branding + visual refinement
### Archivos
- `packages/opencode/src/cli/logo.ts`
- `packages/opencode/src/cli/cmd/tui/component/logo.tsx`
- `packages/opencode/src/cli/cmd/tui/context/theme.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/home/footer.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/footer.tsx`

### Tareas
- nuevo logo ASCII
- nuevos temas TUI Lightcode
- nuevo footer home
- limpieza de tips
- limpieza de sidebar footer

### Resultado
La home TUI ya se siente Lightcode.

---

## Fase 4 — TUI composer and session polish
### Archivos
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

### Tareas
- placeholder nuevo
- hint line nueva
- composer surface refinada
- labels de acciones revisados
- branding/session copy corregidos

### Resultado
El núcleo de uso TUI refleja la nueva identidad.

---

## Fase 5 — App home and empty states
### Archivos
- `packages/app/src/pages/home.tsx`
- `packages/app/src/components/session/session-new-view.tsx`
- `packages/desktop/src/loading.tsx`

### Tareas
- nueva home
- nuevo estado de nueva sesión
- splash/loading alineado

### Resultado
La primera impresión de la app cambia por completo.

---

## Fase 6 — App composer redesign
### Archivos
- `packages/app/src/components/prompt-input.tsx`
- `packages/app/src/components/prompt-input/placeholder.ts`
- `packages/app/src/i18n/en.ts`

### Tareas
- copy del composer
- visual hierarchy
- action rail refinada
- modo shell mejor integrado
- groundwork de mode chips

### Resultado
La pieza central del producto se vuelve distintiva.

---

## Fase 7 — Session structure polish
### Archivos
- `packages/app/src/pages/session/session-side-panel.tsx`
- componentes relacionados de tabs/panels si salen dependencias

### Tareas
- tabs más propias
- empty state lateral actualizado
- sensación de sistema/workspace
- refuerzo de status y jerarquía

### Resultado
La app deja de verse como una composición genérica de paneles.

---

## Fase 8 — Voice and localization rollout
### Archivos
- `packages/app/src/i18n/en.ts`
- `packages/app/src/i18n/*.ts`
- `packages/console/app/src/i18n/*.ts` si aplica
- strings inline TUI

### Tareas
- inglés completo
- backlog de otros idiomas
- normalización de naming visible

### Resultado
Lightcode suena como Lightcode.

---

## Fase 9 — Desktop metadata migration (opcional, separada)
### Archivo
- `packages/desktop/src-tauri/tauri.conf.json`

### Tareas
- plan de rename de bundle e identifier
- deep link migration
- binario final
- icons finales de release

### Resultado
La identidad técnica del desktop coincide con la pública.

### Nota
Esta fase no debe mezclarse con el rediseño visual si no hay tiempo para testear installers y upgrades.

---

# 15. Backlog técnico detallado por archivo

## `packages/ui/src/components/logo.tsx`
- [ ] sustituir SVGs de `Mark`, `Splash`, `Logo`
- [ ] validar tamaños pequeños
- [ ] validar uso en fondos oscuros
- [ ] validar uso en loading

## `packages/ui/src/components/favicon.tsx`
- [ ] cambiar meta title a Lightcode
- [ ] enlazar nuevos assets
- [ ] validar manifest/icons

## `packages/ui/src/theme/resolve.ts`
- [ ] crear preset Lightcode
- [ ] ajustar tokens clave
- [ ] validar contraste global
- [ ] definir tema canon

## `packages/opencode/src/cli/logo.ts`
- [ ] rediseñar ASCII logo
- [ ] validar ancho/alto
- [ ] preparar versión compacta si hace falta

## `packages/opencode/src/cli/cmd/tui/component/logo.tsx`
- [ ] ajustar render del logo nuevo
- [ ] simplificar sombras si sobran
- [ ] revisar contraste con tema nuevo

## `packages/opencode/src/cli/cmd/tui/context/theme.tsx`
- [ ] añadir theme JSON Lightcode
- [ ] definir default nuevo
- [ ] mantener compatibilidad con `opencode`

## `packages/opencode/src/cli/cmd/tui/feature-plugins/home/footer.tsx`
- [ ] convertir en status strip Lightcode
- [ ] mejorar jerarquía visual
- [ ] revisar labels visibles

## `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx`
- [ ] auditar todo el array `TIPS`
- [ ] unificar naming Lightcode
- [ ] decidir naming de config / providers / share docs

## `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/footer.tsx`
- [ ] eliminar branding OpenCode
- [ ] revisar onboarding card
- [ ] rediseñar footer de sistema/versión

## `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
- [ ] nuevo placeholder
- [ ] nueva hint line
- [ ] nuevo tratamiento visual del composer
- [ ] preparar modo chips si aplica
- [ ] revisar labels `agents` / `commands`

## `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- [ ] revisar branding del session route
- [ ] revisar exit banner/logo
- [ ] revisar labels visibles de comandos principales
- [ ] mantener arquitectura intacta salvo copy/visual polish

## `packages/app/src/pages/home.tsx`
- [ ] rediseñar hero
- [ ] aplicar nuevo Logo
- [ ] mejorar empty state
- [ ] mejorar jerarquía recent projects/server status

## `packages/app/src/components/session/session-new-view.tsx`
- [ ] actualizar Mark
- [ ] revisar spacing/composición
- [ ] revisar copy del título

## `packages/app/src/components/prompt-input/placeholder.ts`
- [ ] confirmar si basta con cambiar strings o si requiere nueva lógica
- [ ] ajustar comportamiento si se introducen nuevos modos

## `packages/app/src/components/prompt-input.tsx`
- [ ] rediseñar visualmente el composer
- [ ] revisar tray inferior
- [ ] revisar attach/send affordances
- [ ] introducir base para mode chips
- [ ] mantener intacta la lógica crítica de input/history/comments/attachments

## `packages/app/src/pages/session/session-side-panel.tsx`
- [ ] refinar tabs
- [ ] refinar empty state
- [ ] reforzar sensación de sistema/workspace
- [ ] revisar divisores/superficies

## `packages/app/src/i18n/en.ts`
- [ ] reescribir strings visibles críticas
- [ ] reemplazar OpenCode por Lightcode donde aplique
- [ ] definir voz del producto
- [ ] revisar placeholders, settings, toasts, onboarding, update text

## `packages/app/src/i18n/*.ts`
- [ ] definir estrategia de propagación
- [ ] actualizar idiomas prioritarios o dejar backlog planificado

## `packages/desktop/src/loading.tsx`
- [ ] usar nuevo Splash
- [ ] validar copy de loading
- [ ] revisar palette/progress feel

## `packages/desktop/src-tauri/tauri.conf.json`
- [ ] documentar cambios de bundle pendientes
- [ ] ejecutar migración solo con release plan

---

# 16. Riesgos y cómo mitigarlos

## Riesgo 1 — Cambiar solo el logo y dejar el resto igual
### Impacto
Producto sigue sintiéndose derivado.

### Mitigación
No cerrar iniciativa sin:
- theme nuevo
- composer nuevo
- microcopy nueva

## Riesgo 2 — Mezclar Lightcode y OpenCode en la misma release
### Impacto
Sensación de producto inacabado.

### Mitigación
Hacer auditoría de strings visibles críticas antes de release.

## Riesgo 3 — Romper compatibilidad de desktop
### Impacto
Problemas de instalación, updates o enlaces.

### Mitigación
Separar branding visual de rename de bundle/identifier.

## Riesgo 4 — Reescribir demasiado el composer y romper funcionalidad
### Impacto
Regresiones graves en el flujo principal.

### Mitigación
Primero polish visual y copy. Luego mejoras estructurales en fases.

## Riesgo 5 — Hacer rename masivo de imports/packages
### Impacto
Costo alto, beneficio bajo, muchos conflictos.

### Mitigación
Posponer scope/package rename.

## Riesgo 6 — Paleta demasiado genérica
### Impacto
El producto sigue pareciéndose a cualquier app dark AI.

### Mitigación
Congelar un preset Lightcode con criterio antes de empezar a tocar componentes.

---

# 17. Orden exacto recomendado de ejecución

Si quieres maximizar impacto y minimizar riesgo, este es el orden correcto:

1. **Cerrar decisiones de marca y paleta**
2. **Actualizar `packages/ui/src/components/logo.tsx`**
3. **Actualizar `packages/ui/src/theme/resolve.ts`**
4. **Actualizar branding TUI base**
5. **Actualizar home + empty states app**
6. **Actualizar composer app + TUI**
7. **Actualizar microcopy principal (`en.ts` + TUI inline strings)**
8. **Refinar tabs/status/panel structure**
9. **Planificar migración de desktop metadata**
10. **Hacer traducciones y docs**

---

# 18. Definición de entregables finales

Al terminar esta iniciativa deben existir, como mínimo:

## Branding
- logo Lightcode definitivo
- mark Lightcode definitivo
- splash definitivo
- favicon actualizado

## Sistema visual
- tema Lightcode canon
- tokens revisados
- contraste validado

## TUI
- logo TUI Lightcode
- home footer/status nueva
- tips sin branding viejo
- sidebar/footer sin OpenCode
- composer con copy propia

## App/Desktop
- home nueva
- new session view nueva
- composer nueva/refinada
- side panel más propio
- loading screen Lightcode

## Voz
- placeholders nuevos
- settings/toasts/home copy revisada
- naming visible normalizado

## Compatibilidad
- estrategia documentada para config, themes y desktop identifiers

---

# 19. Recomendación final de implementación real

La ruta más inteligente no es intentar “rebrandear todo el repo” en una sola PR enorme.

La ruta correcta es:

## PR 1 — Shared brand + theme foundation
- logo
- mark
- splash
- favicon
- preset Lightcode

## PR 2 — TUI identity pass
- logo TUI
- footer
- tips
- sidebar footer
- composer/hints

## PR 3 — App identity pass
- home
- session empty state
- composer
- side panel polish

## PR 4 — Copy + i18n source cleanup
- `en.ts`
- strings inline
- naming visible

## PR 5 — Desktop metadata migration
- solo si decides tocar bundle/install identity

Esta secuencia reduce riesgo, facilita review y mantiene el producto siempre en estado usable.

---

# 20. Resumen ejecutivo

Para que Lightcode tenga identidad real en este repo, no basta con cambiar un logo.

Hay que intervenir, de manera ordenada, en:

- `packages/ui` para la marca y el sistema visual
- `packages/opencode` para TUI y CLI branding
- `packages/app` para home, composer y estructura de sesión
- `packages/desktop` para splash y metadata visible
- `packages/app/src/i18n/en.ts` y strings inline para la voz del producto

Y hacerlo con estas reglas:

- **renombrar primero lo visible**
- **posponer lo técnicamente delicado**
- **mantener compatibilidad donde haga falta**
- **no romper el flujo principal del composer**
- **no dejar mezcla de marcas en la release final**

Si se ejecuta en el orden descrito aquí, Lightcode puede pasar de ser “un proyecto funcional que todavía se siente heredado” a un producto con presencia propia, sistema visual coherente y personalidad reconocible.