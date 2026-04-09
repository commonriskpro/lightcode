# Lightcode — Checklist ejecutable por PRs

Este documento traduce el plan técnico en un **checklist operativo**, pensado para ejecución real por PRs pequeños o medianos, reviewable, testeable y delegable a Codex.

La regla de este checklist es simple:

- cada PR debe tener un alcance claro
- cada PR debe tener criterios de aceptación explícitos
- cada PR debe dejar el repo en un estado coherente
- ninguna PR debe mezclar rediseño visual con migraciones técnicas de alto riesgo sin necesidad

---

# 0. Cómo usar este documento

## Orden recomendado
Seguir las PRs en este orden:

1. PR-00 — decisiones congeladas
2. PR-01 — branding compartido
3. PR-02 — sistema visual / tema
4. PR-03 — identidad TUI base
5. PR-04 — composer TUI + sesión TUI
6. PR-05 — home / empty states app
7. PR-06 — composer app
8. PR-07 — side panel / estructura de sesión app
9. PR-08 — microcopy fuente
10. PR-09 — docs / naming visible / compatibilidad
11. PR-10 — metadata desktop de release (opcional y separada)

## Estado de cada PR
Usar uno de estos estados:

- [ ] no empezada
- [~] en progreso
- [x] terminada

## Regla de bloqueo
No empezar la PR siguiente si la anterior deja cualquiera de estos problemas:

- branding mezclado visible al usuario
- copy inconsistente entre pantalla principal y composer
- regresión del flujo principal de prompt
- cambios de identidad que no pasaron revisión visual mínima

---

# PR-00 — Freeze de decisiones

**Objetivo:** cerrar decisiones antes de escribir implementación visual seria.

**Estado:** [ ]

## Checklist
- [ ] elegir wordmark final de Lightcode
- [ ] elegir mark final de Lightcode
- [ ] elegir splash final de Lightcode
- [ ] elegir paleta oficial canon
- [ ] decidir si el tema canon será `Midnight + Ice` o `Graphite + Lime`
- [ ] decidir convención de voz principal
- [ ] decidir si la config pública canónica será `lightcode.json`
- [ ] decidir si `.lightcode/` será carpeta pública oficial
- [ ] decidir política de compatibilidad con `opencode.json` y `.opencode/`
- [ ] decidir si `agents` seguirá visible como nombre o si migrará después
- [ ] decidir si `commands` seguirá visible como nombre o migrará a `actions`

## Entregables mínimos
- [ ] una decisión escrita para logo/mark
- [ ] una decisión escrita para paleta
- [ ] una decisión escrita para naming visible

## Criterios de aceptación
- [ ] ninguna decisión crítica de marca queda “por definir”
- [ ] el equipo puede implementar sin reabrir discusiones básicas

## Notas
Esta PR puede ser solo documental si quieres, pero es mejor dejarla cerrada antes de tocar UI.

---

# PR-01 — Branding compartido

**Objetivo:** reemplazar la base visual compartida de OpenCode por Lightcode sin romper APIs internas.

**Estado:** [ ]

## Archivos principales
- `packages/ui/src/components/logo.tsx`
- `packages/ui/src/components/favicon.tsx`
- assets relacionados de iconos/favicons/splash

## Checklist
- [ ] reemplazar `Mark` por el símbolo final de Lightcode
- [ ] reemplazar `Splash` por el splash final de Lightcode
- [ ] reemplazar `Logo` por el wordmark final de Lightcode
- [ ] mantener exports `Mark`, `Splash`, `Logo` para no romper imports existentes
- [ ] actualizar `apple-mobile-web-app-title` a `Lightcode`
- [ ] reemplazar rutas de favicon si cambian los assets
- [ ] validar que el nuevo `Mark` funciona en tamaños pequeños
- [ ] validar que `Logo` funciona en home y cabeceras
- [ ] validar que `Splash` funciona en loading desktop

## QA mínimo
- [ ] screenshot de `Logo`
- [ ] screenshot de `Mark`
- [ ] screenshot de `Splash`
- [ ] verificación de favicon/meta title en web/app si aplica

## Criterios de aceptación
- [ ] ya no hay branding gráfico OpenCode en componentes compartidos
- [ ] no se rompieron imports ni build por renombrar exports
- [ ] el nuevo branding se ve consistente entre tamaños

## No hacer en esta PR
- [ ] no tocar scopes de paquetes `@opencode-ai/*`
- [ ] no tocar identifiers de desktop

---

# PR-02 — Sistema visual Lightcode

**Objetivo:** crear el preset visual canónico de Lightcode para la UI compartida.

**Estado:** [ ]

## Archivos principales
- `packages/ui/src/theme/resolve.ts`
- estilos relacionados en `packages/ui/src/styles/*` si hace falta

## Checklist
- [ ] crear preset Lightcode explícito en el sistema de tema
- [ ] mapear background base de la nueva paleta
- [ ] mapear superficies elevadas
- [ ] mapear bordes débiles/fuertes
- [ ] mapear texto base/débil/fuerte
- [ ] mapear iconos base/weak/strong
- [ ] mapear colores interactivos
- [ ] mapear success/warning/error/info
- [ ] revisar contraste de ghost buttons
- [ ] revisar contraste de tabs activas
- [ ] revisar contraste de input surfaces
- [ ] revisar contraste de selected states
- [ ] revisar contraste de focus states
- [ ] documentar qué preset es el canon oficial para screenshots y docs

## QA mínimo
- [ ] revisar home app
- [ ] revisar composer app
- [ ] revisar tabs de side panel
- [ ] revisar popovers/menus principales
- [ ] revisar loading desktop

## Criterios de aceptación
- [ ] el producto ya se ve diferente aunque todavía no cambie toda la estructura
- [ ] el branding no depende solo del logo
- [ ] no hay problemas evidentes de contraste o accesibilidad visual

## No hacer en esta PR
- [ ] no rehacer copy
- [ ] no mezclar todavía con rediseño profundo del composer

---

# PR-03 — Identidad TUI base

**Objetivo:** alinear home y branding principal del TUI con Lightcode.

**Estado:** [ ]

## Archivos principales
- `packages/opencode/src/cli/logo.ts`
- `packages/opencode/src/cli/cmd/tui/component/logo.tsx`
- `packages/opencode/src/cli/cmd/tui/context/theme.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/home/footer.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/footer.tsx`

## Checklist
- [ ] rediseñar `packages/opencode/src/cli/logo.ts` con branding ASCII Lightcode
- [ ] ajustar `component/logo.tsx` al nuevo logo ASCII
- [ ] añadir uno o más themes TUI Lightcode en `context/theme.tsx`
- [ ] cambiar default TUI al theme Lightcode canon
- [ ] mantener el theme `opencode` como compatibilidad temporal
- [ ] convertir `home/footer.tsx` en una status strip más propia de Lightcode
- [ ] auditar y limpiar branding viejo en `tips-view.tsx`
- [ ] auditar todo el array `TIPS` para naming Lightcode consistente
- [ ] eliminar branding visible OpenCode en `sidebar/footer.tsx`
- [ ] rehacer la tarjeta de onboarding del sidebar si todavía habla como OpenCode

## QA mínimo
- [ ] screenshot de home TUI con logo nuevo
- [ ] screenshot de footer home TUI
- [ ] screenshot de sidebar/footer TUI
- [ ] revisar tips aleatorios y branding visible

## Criterios de aceptación
- [ ] home TUI ya se siente Lightcode
- [ ] no hay mezcla OpenCode/Lightcode visible en esas superficies
- [ ] el theme por defecto TUI ya coincide con la identidad nueva

## No hacer en esta PR
- [ ] no rehacer todavía el flujo profundo del prompt TUI
- [ ] no tocar todavía toda la ontología de agentes/comandos salvo copy obvia

---

# PR-04 — Composer TUI + sesión TUI

**Objetivo:** convertir la experiencia principal del TUI en una experiencia con voz y superficie Lightcode.

**Estado:** [ ]

## Archivos principales
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

## Checklist
- [ ] cambiar placeholder principal del prompt TUI
- [ ] cambiar placeholder de shell TUI si hace falta
- [ ] cambiar hint inferior del prompt (`commands`, `agents`, etc.) por copy más propia
- [ ] revisar jerarquía visual del composer TUI
- [ ] revisar padding/altura/foco del composer TUI
- [ ] reforzar la sensación de command surface
- [ ] revisar labels visibles del session route que todavía suenan genéricos o viejos
- [ ] revisar branding del exit banner / session banner
- [ ] revisar labels visibles de sesión que todavía mencionen OpenCode si aplica
- [ ] mantener funcionalidad actual de prompt/history/paste/attachments intacta

## QA mínimo
- [ ] prompt vacío TUI
- [ ] prompt con texto TUI
- [ ] shell mode TUI
- [ ] sesión TUI con tool calls
- [ ] sesión TUI con sidebar visible

## Criterios de aceptación
- [ ] el corazón del flujo TUI ya no se siente genérico
- [ ] la voz del producto es coherente con Lightcode
- [ ] no se rompieron atajos, submit, paste, shell mode o history

## No hacer en esta PR
- [ ] no introducir todavía un composer inteligente complejo si no está bien definido
- [ ] no reescribir arquitectura de sesión sin necesidad

---

# PR-05 — Home app + empty states + loading

**Objetivo:** cambiar por completo la primera impresión de la app/desktop.

**Estado:** [ ]

## Archivos principales
- `packages/app/src/pages/home.tsx`
- `packages/app/src/components/session/session-new-view.tsx`
- `packages/desktop/src/loading.tsx`

## Checklist
- [ ] rediseñar `home.tsx` con el nuevo branding
- [ ] ajustar composición visual de la home
- [ ] mejorar jerarquía entre logo, recent projects y CTA
- [ ] revisar estado de server visible en home
- [ ] actualizar `session-new-view.tsx` para que el empty state de nueva sesión use la nueva identidad
- [ ] revisar spacing y jerarquía en `session-new-view.tsx`
- [ ] actualizar `desktop/src/loading.tsx` para usar el nuevo `Splash`
- [ ] revisar progress/loading feel con la nueva paleta

## QA mínimo
- [ ] screenshot home sin proyectos
- [ ] screenshot home con proyectos recientes
- [ ] screenshot new session state
- [ ] screenshot loading desktop

## Criterios de aceptación
- [ ] la primera pantalla ya no se siente heredada de OpenCode
- [ ] home, new session y loading hablan el mismo lenguaje visual

## No hacer en esta PR
- [ ] no rehacer todavía el composer app

---

# PR-06 — Composer app

**Objetivo:** convertir el composer de la app en la pieza más distintiva de Lightcode.

**Estado:** [ ]

## Archivos principales
- `packages/app/src/components/prompt-input.tsx`
- `packages/app/src/components/prompt-input/placeholder.ts`
- `packages/app/src/i18n/en.ts` (solo claves necesarias del composer si conviene separarlo)

## Checklist
- [ ] redefinir placeholder base de prompt app
- [ ] redefinir placeholder de shell app
- [ ] revisar lógica de placeholders en `placeholder.ts`
- [ ] refinar visualmente `DockShellForm`
- [ ] revisar gradiente y fondo inferior del composer
- [ ] revisar attach button izquierdo
- [ ] revisar send/stop button derecho
- [ ] revisar tray inferior de agent/model/variant/permissions
- [ ] mejorar jerarquía visual del tray inferior
- [ ] evaluar introducción de chips/modos visibles sin romper estado actual
- [ ] documentar si se pospone el “composer inteligente” a otra PR
- [ ] asegurar que drag/drop, paste, slash, at-mention, comments y history sigan funcionando

## QA mínimo
- [ ] composer vacío
- [ ] composer con texto
- [ ] composer con imágenes
- [ ] composer con comentarios/context items
- [ ] shell mode
- [ ] slash commands
- [ ] at-mention files/agentes

## Criterios de aceptación
- [ ] el composer app ya tiene identidad propia
- [ ] no parece una textarea genérica con botones alrededor
- [ ] el flujo principal no sufrió regresiones funcionales

## No hacer en esta PR
- [ ] no mezclar con migración masiva de strings de toda la app
- [ ] no mezclar con side panel estructural profundo

---

# PR-07 — Side panel + estructura de sesión app

**Objetivo:** hacer que la sesión se sienta más como un workspace propio y menos como paneles genéricos.

**Estado:** [ ]

## Archivos principales
- `packages/app/src/pages/session/session-side-panel.tsx`
- componentes relacionados de tabs si hace falta

## Checklist
- [ ] refinar tabs de `review`, `context` y archivos
- [ ] reforzar el estado activo de tabs
- [ ] revisar contraste de tabs y superficies
- [ ] reemplazar branding viejo del empty state lateral
- [ ] mejorar sensación de rail/sistema
- [ ] revisar divisores, fondos y densidad visual del panel
- [ ] revisar coherencia con la nueva paleta
- [ ] validar que drag/drop de tabs siga funcionando

## QA mínimo
- [ ] review tab
- [ ] context tab
- [ ] file tabs
- [ ] empty side panel
- [ ] drag/reorder tabs

## Criterios de aceptación
- [ ] la sesión se siente más estructurada y propia
- [ ] tabs y panel lateral tienen un tratamiento visual intencional

## No hacer en esta PR
- [ ] no tocar navegación profunda sin necesidad

---

# PR-08 — Microcopy fuente e identidad verbal

**Objetivo:** eliminar el tono genérico y normalizar la voz Lightcode en la fuente principal de i18n.

**Estado:** [ ]

## Archivos principales
- `packages/app/src/i18n/en.ts`
- strings inline del TUI que no estén centralizadas

## Checklist
- [ ] reescribir placeholders visibles más importantes
- [ ] reescribir home / empty state copy
- [ ] revisar strings de settings que dicen OpenCode
- [ ] revisar toasts que dicen OpenCode
- [ ] revisar release/update text que dice OpenCode
- [ ] revisar provider onboarding copy donde convenga
- [ ] revisar `Build anything` y otros títulos visibles
- [ ] normalizar naming visible del producto a Lightcode
- [ ] documentar qué strings se dejan legacy temporalmente y por qué

## QA mínimo
- [ ] home
- [ ] prompt
- [ ] settings principales
- [ ] toasts más comunes
- [ ] loading/update strings visibles

## Criterios de aceptación
- [ ] el producto suena consistente
- [ ] ya no hay mezcla de voz genérica + branding nuevo
- [ ] la mayoría de referencias visibles a OpenCode desaparecieron de la app principal

## No hacer en esta PR
- [ ] no intentar traducir todos los idiomas completos en la misma PR salvo que sea pequeño

---

# PR-09 — Docs visibles + naming de compatibilidad

**Objetivo:** alinear documentación y naming visible sin romper compatibilidad técnica existente.

**Estado:** [ ]

## Áreas principales
- README(s)
- docs visibles
- tips restantes
- referencias de config pública
- naming de share/docs/proveedor si aplica

## Checklist
- [ ] revisar README principal visible
- [ ] revisar docs públicas más visibles del producto
- [ ] revisar menciones a `opencode.json` vs `lightcode.json`
- [ ] revisar menciones a `.opencode/` vs `.lightcode/`
- [ ] documentar compatibilidad si se mantienen alias legacy
- [ ] revisar branding visible de sharing/docs/proveedor donde aplique
- [ ] revisar títulos/meta visibles restantes

## Criterios de aceptación
- [ ] la documentación visible no contradice al producto
- [ ] existe una decisión explícita de compatibilidad sobre config/naming

## No hacer en esta PR
- [ ] no renombrar carpetas internas del monorepo sin plan

---

# PR-10 — Metadata desktop / identidad de release

**Objetivo:** migrar la identidad técnica del desktop solo si ya existe un plan de compatibilidad.

**Estado:** [ ]

## Archivo principal
- `packages/desktop/src-tauri/tauri.conf.json`

## Checklist
- [ ] decidir `productName` final visible
- [ ] decidir `mainBinaryName` final
- [ ] decidir si cambia el deep-link scheme
- [ ] decidir si cambia `identifier`
- [ ] preparar icon bundle final de release
- [ ] validar impactos sobre updates/instalación/deep links
- [ ] documentar migración y rollback si aplica

## Criterios de aceptación
- [ ] el cambio no rompe instalaciones existentes sin aviso
- [ ] existe una estrategia clara de migración

## No hacer en esta PR
- [ ] no mezclar con rediseño visual general

---

# Checklist transversal de QA

## Branding visible
- [ ] no quedan logos OpenCode visibles en app principal
- [ ] no quedan logos OpenCode visibles en TUI principal
- [ ] favicon y splash son Lightcode

## Voz del producto
- [ ] placeholders principales alineados
- [ ] home y empty states alineados
- [ ] no quedan frases clave que digan OpenCode sin querer

## Composer app
- [ ] send/stop funcionan
- [ ] attach funciona
- [ ] paste funciona
- [ ] comments/context siguen funcionando
- [ ] history funciona
- [ ] slash y at-mention funcionan

## Composer TUI
- [ ] submit funciona
- [ ] paste funciona
- [ ] shell mode funciona
- [ ] history funciona
- [ ] command palette y hints siguen bien

## Session / structure
- [ ] tabs laterales siguen funcionando
- [ ] drag/drop tabs sigue funcionando
- [ ] review/context/files siguen accesibles

## Desktop
- [ ] loading screen sin errores
- [ ] iconos correctos
- [ ] branding visible correcto

---

# Checklist de rollout final

## Antes de mergear la fase fuerte de identidad
- [ ] screenshots comparativas antes/después
- [ ] revisión visual de TUI
- [ ] revisión visual de app
- [ ] revisión visual de desktop loading
- [ ] pasada rápida por i18n visible
- [ ] pasada rápida por docs visibles

## Antes de anunciar la nueva identidad
- [ ] home terminada
- [ ] composer terminada
- [ ] TUI home/prompt terminadas
- [ ] branding viejo visible eliminado

---

# Recomendación de ejecución real

## Batch 1
- PR-00
- PR-01
- PR-02

## Batch 2
- PR-03
- PR-04

## Batch 3
- PR-05
- PR-06
- PR-07

## Batch 4
- PR-08
- PR-09

## Batch 5
- PR-10 (solo si quieres cerrar también identidad de bundle desktop)

---

# Definición de done

La nueva identidad de Lightcode se puede considerar implementada cuando:

- [ ] la app principal muestra branding Lightcode de forma consistente
- [ ] la TUI muestra branding Lightcode de forma consistente
- [ ] el composer app y TUI tienen voz y presencia propias
- [ ] la paleta oficial ya está aplicada
- [ ] no hay mezcla visible OpenCode/Lightcode en superficies principales
- [ ] docs y naming visible no contradicen la implementación
- [ ] no hubo regresiones graves en el flujo central del producto