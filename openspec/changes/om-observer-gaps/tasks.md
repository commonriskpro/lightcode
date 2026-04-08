# Tasks: om-observer-gaps

## Phase 1: RED — Tests que fallan primero

- [x] 1.1 En `observer.test.ts`, dentro del bloque `"session.om.observer.parseObserverOutput"`, agregar test: `parseObserverOutput` extrae `<thread-title>` en `result.threadTitle`
- [x] 1.2 En `observer.test.ts`, agregar test: `parseObserverOutput` retorna `threadTitle: undefined` cuando el tag está ausente
- [x] 1.3 En `observer.test.ts`, dentro del bloque `"session.om.observer.PROMPT"`, agregar test: `PROMPT` contiene `COMPLETION TRACKING`
- [x] 1.4 En `observer.test.ts`, agregar test: `PROMPT` contiene `CONVERSATION CONTEXT`
- [x] 1.5 En `observer.test.ts`, agregar test: `PROMPT` contiene `USER MESSAGE FIDELITY`
- [x] 1.6 En `observer.test.ts`, agregar test: `PROMPT` contiene `<thread-title>` en la sección de output format
- [x] 1.7 Correr `bun test test/session/observer.test.ts` — verificar que los 6 tests nuevos fallan (RED)

## Phase 2: GREEN — Implementación en `observer.ts`

- [x] 2.1 Extender `ObserverResult` con `threadTitle?: string`
- [x] 2.2 Actualizar `parseObserverOutput`: extraer `<thread-title>` tag en `threadTitle` con el mismo patrón regex que `currentTask`
- [x] 2.3 Agregar sección `## COMPLETION TRACKING` al `PROMPT`: instrucción para emitir `✅` al inicio del bullet cuando el asistente completa una tarea de forma unambigua
- [x] 2.4 Agregar sección `## CONVERSATION CONTEXT` al `PROMPT`: capturar code snippets, multi-step sequences y constraints explícitas como `🔴` assertions
- [x] 2.5 Agregar sección `## USER MESSAGE FIDELITY` al `PROMPT`: near-verbatim para valores concretos; omitir filler conversacional
- [x] 2.6 Agregar `<thread-title>` al bloque `## Output Format` del `PROMPT` con instrucción de 2-5 palabras
- [x] 2.7 Correr `bun test test/session/observer.test.ts` — verificar que todos los tests pasan (GREEN)
- [x] 2.8 Correr `bun typecheck` desde `packages/opencode` — sin errores de tipos

## Phase 3: Wiring en `processor.ts`

- [x] 3.1 En el path `buffer` de `processor.ts` (después de `OM.addBufferSafe`): leer `Session.get(ctx.sessionID)` y verificar `Session.isDefaultTitle(session.title)`
- [x] 3.2 Si `result.threadTitle` es truthy y el título es default → llamar `Session.setTitle({ sessionID: ctx.sessionID, title: result.threadTitle })` (non-blocking, ignorar error)
- [x] 3.3 Correr `bun typecheck` desde `packages/opencode` — sin errores
- [x] 3.4 Correr `bun test test/session/observer.test.ts test/session/reflector.test.ts` — 140 tests en verde

## Phase 4: Verificación final

- [x] 4.1 Revisar que `✅` en el PROMPT aparece ANTES del emoji de rol (`🔴`/`🟡`) en el ejemplo de output format
- [x] 4.2 Revisar que el guard `isDefaultTitle` está en `processor.ts` y no en `observer.ts` (observer no tiene contexto de sesión)
- [x] 4.3 Confirmar que `PROMPT` sigue exportando `<observations>`, `<current-task>`, `<suggested-response>` intactos (no rompe tests existentes del PROMPT block)
