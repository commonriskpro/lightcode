Sí. Ya lo verifiqué y te digo la diferencia REAL, no marketinera.
Respuesta corta
Hoy Mastra está mejor parado que LightCode para cache hit rate de prompt.
Y no por magia, sino por implementación.
---
Qué hace Mastra
Encontré evidencia concreta de que Mastra mete cache hints reales en el prompt, no solo en tools.
Mastra
- usa providerOptions / providerMetadata
- preserva eso cuando arma mensajes
- mete cacheControl explícito para Anthropic
- también expone prompt cache para OpenAI
Archivos relevantes en Mastra
- mastracode/src/providers/claude-max.ts
  - mete anthropic.cacheControl: { type: "ephemeral", ttl: "5m" }
  - lo aplica al último system message y al mensaje reciente
- packages/core/src/agent/message-list/adapters/AIV4Adapter.ts
  - preserva providerMetadata / providerOptions
- packages/core/src/agent/__tests__/instructions.test.ts
  - testea system instructions con providerOptions.anthropic.cacheControl
- client-sdks/ai-sdk/src/__tests__/provider-options.test.ts
  - testea forwarding de providerOptions
- docs:
  - Anthropic: cacheControl
  - OpenAI: promptCacheKey, promptCacheRetention
Qué implica eso
Mastra puede pegar cache hit sobre:
- system prompt estable
- partes repetidas del historial
- prefijos repetidos del prompt
No solamente “evitar rerun de tools”.
---
Qué hace LightCode hoy
En LightCode encontré esto:
Sí hay cache explícita en tools
En:
- packages/opencode/src/session/llm.ts:291-300
solo se setea:
- anthropic.cacheControl en el último tool
Pero NO vi cacheControl explícito en:
- observations
- recall
- workingMemory
- bloques del system prompt
Y eso es GRAVE, porque justamente esos son los bloques que más te inflan contexto.
---
Encima LightCode mete bastante memoria fija
Defaults actuales en:
- packages/opencode/src/memory/provider.ts
son aprox:
- workingMemoryBudget = 2000
- observationsBudget = 4000
- semanticRecallBudget = 2000
O sea, podés sumar ~8k tokens de memoria aunque el user mande un prompt chiquito.
---
Comparación práctica
Mastra
- mejor preparado para prompt caching real
- metadata de cache viaja con los mensajes
- estrategia más alineada con providers
LightCode hoy
- más contexto fijo
- menos cache hints reales sobre prompt estable
- comentarios hablan de BP slots/cacheability, pero la implementación no está al mismo nivel
---
Veredicto
Si tu sensación es:
> “con un prompt pequeño LightCode sube demasiado contexto y en opencode/mastra no pasa igual”
sí, tiene sentido técnico.
Porque hoy:
- Mastra parece optimizar mejor el prompt para cache hit
- LightCode está cargando memoria pesada y no está cacheando explícitamente esos bloques como debería
---
Conclusión brutalmente honesta
Mastra hoy gana en estrategia de cache-hit de prompt.
LightCode está más cerca de:
- “meto memoria útil”
que de
- “meto memoria útil sin romper cache efficiency”
---
Qué haría yo ahora
1. instrumentar tokens por capa en LightCode
2. bajar budgets por default
3. meter providerOptions/cacheControl real en bloques estables del system prompt
4. revisar orden fijo de bloques para maximizar prefix reuse
Si querés, el próximo paso te lo hago yo:
te preparo un plan exacto para que LightCode iguale o supere la estrategia de Mastra sin romper la arquitectura actual.
▣  Gentleman · GPT-5.4 · 2m 29s
Hazme ese plan ademas, no podemos bajar los budgets porque mi flujo de trabajo siempre incluye mucho mas contexto que el de mastra. 
⚙ engram_mem_save [content=**What**: Captured a user constraint for prompt-cache optimization work: do not reduce memory budgets because the user's workflow requires substantially more context than Mastra-style defaults.
**Why**: The user explicitly rejected budget reduction as a solution and wants cache-hit improvements without sacrificing high-context workflows.
**Where**: Planning constraint for LightCode memory/prompt caching work
**Learned**: The optimization direction must focus on cacheability, prompt structure, and provider metadata rather than shrinking memory payloads., project=lightcodev2, scope=project, session_id=session-2026-04-05-user-scope-activation, title=Preserved high-context budget constraint, topic_key=preference/high-context-no-budget-reduction, type=preference]
Sí. Y bien ahí: no bajar budgets es una restricción válida si tu flujo depende de contexto pesado. Entonces el plan correcto NO es “meter dieta”, sino hacer ese contexto más cacheable.
Plan para igualar o superar el cache hit de Mastra sin bajar budgets
Objetivo
Mantener:
- mucho contexto
- memory rica
- recall fuerte
Pero mejorar:
- prompt cache hit rate
- costo por turno
- tokens re-procesados
---
Diagnóstico base
Hoy LightCode tiene este problema estructural:
1. inyecta memoria grande
   - observations
   - semantic recall
   - working memory
2. esa memoria entra como system text
   - pero sin cache metadata explícita en esos bloques
3. solo tools tienen cacheControl explícito
   - eso ayuda, pero NO resuelve el costo del prompt enorme
4. observations cambian seguido
   - entonces si mezclás bien y mal bloques estables/volátiles, rompés el prefijo cacheable
---
Estrategia general
No tocar budgets.
En vez de eso, hacer esto:
Pilar 1 — separar bloques por estabilidad
Tenemos que clasificar todo el prompt por volatilidad.
A. Muy estable
Casi no cambia entre turnos:
- prompt base del agente
- system provider prompt
- skills cargadas
- instrucciones globales
- working memory estable
- parte durable de recall
B. Semi-estable
Cambia a veces, no siempre:
- semantic recall del turno
- observations reflejadas
- durable child context
- handoff/fork context
C. Volátil
Cambia TODO el tiempo:
- fecha
- model ID exacto
- tail reciente de mensajes
- suggested continuation
- unobserved tail
- system reminders dinámicos
Acción
No mezclar A + B + C en bloques gigantes.
Si lo mezclás, una variación chiquita te invalida un prefijo enorme.
---
Pilar 2 — cache metadata REAL sobre system/messages
Acá está la diferencia con Mastra.
Lo que hay que implementar
Agregar providerOptions / cacheControl explícito a los bloques estables del prompt.
Para Anthropic
Usar breakpoints cacheables sobre:
- último bloque de system estable
- working memory
- observations estables si no cambiaron
- recall estable si no cambió
Para OpenAI / compatibles
Explorar si el provider soporta:
- promptCacheKey
- promptCacheRetention
- o equivalente via providerOptions
Regla clave
No alcanza con comentarios tipo “BP3 slot”.
Tiene que existir metadata real en el request.
---
Pilar 3 — fingerprint por capa
Necesitamos saber si un bloque cambió de verdad.
Implementar fingerprints/hashes para:
- workingMemory
- observations
- semanticRecall
- system stable header
Ejemplo:
- wmHash
- obsHash
- recallHash
Uso
Si el hash no cambió:
- mismo bloque
- mismo orden
- mismo cache breakpoint
- mejor chance de hit real
Esto es FUNDAMENTAL, hermano.
Sin identidad estable del bloque, estás cacheando arena.
---
Pilar 4 — no recalcular ni reinyectar recall “por costumbre”
Hoy aunque el user mande algo chico, te podés traer memory fuerte.
No quiero bajar budgets, pero sí quiero cargar inteligentemente.
Hacer gating semántico, no recorte bruto
Working memory
Siempre entra, porque es la más estable y útil.
Observations
Siempre entran si son parte del flujo actual, pero separadas en bloque cacheable si no cambiaron.
Semantic recall
No debería entrar igual de fuerte en todos los turnos.
No por budget, sino por relevancia.
Ejemplo de política
Traer recall fuerte cuando:
- cambia el tema
- hay referencia a pasado
- el user pide continuidad
- aparece ambigüedad
- hay keywords que mapean a artifacts
Y en turnos de follow-up cortos:
- reutilizar el mismo recall del turno anterior si sigue siendo válido
Eso no baja budget.  
Eso evita churn inútil.
---
Pilar 5 — congelar el orden del prompt
El cache hit ama el orden determinista.
Regla
Orden fijo SIEMPRE:
1. provider/base prompt
2. agent prompt
3. stable instructions
4. skills
5. working memory
6. stable observations
7. stable recall
8. volatile continuation hint
9. volatile env/model/date
10. live tail messages
Si el orden cambia por condiciones del runtime, cagaste el prefijo cacheable.
---
Pilar 6 — dividir observations en “stable” y “live”
Acá hay oro.
Hoy observations se recargan cada turno.
Mejor enfoque
Separar:
- observations stable
  - lo ya consolidado / reflejado
- observations live
  - suggested continuation
  - último delta
  - estado reciente
Beneficio
La parte grande queda cacheable.
La parte chica rota.
Es exactamente el tipo de arquitectura que mejora hit rate sin bajar contexto total.
---
Pilar 7 — telemetría de cache-hit por capa
No se puede optimizar a ciegas.
Medir por request:
- tokens total
- tokens por capa:
  - system header
  - working memory
  - observations
  - recall
  - tail messages
- cache read/write report del provider
- hashes por bloque
- cambio de bloque vs turno anterior
Métricas concretas
- % de requests con mismo wmHash
- % con mismo obsHash
- % con mismo recallHash
- cache read tokens por provider/model
- costo por turno con y sin churn
Sin eso, estás piloteando un avión con los ojos cerrados.
---
Pilar 8 — cache-aware recall policy
Hay que meter una política explícita:
Reglas
Reusar recall previo si:
- query parecida
- mismo topic cluster
- user sigue en el mismo flujo
- no cambió el intent
Re-hacer recall si:
- shift fuerte de tema
- range/source exacto pedido
- nueva entidad o feature
- conflicto entre memory layers
Eso evita que el bloque de recall rote al pedo.
---
Pilar 9 — compatibilidad por provider
No todos cachean igual.
Implementación recomendada
Crear una capa tipo:
- PromptCacheTransform o extensión en ProviderTransform
Responsable de:
- decidir si el provider soporta prompt caching
- mapear metadata por provider
- marcar qué bloques son cacheables
- mantener política consistente
Para Anthropic
Prioridad máxima.
Para OpenAI/gateway
Soporte si existe API real.
Para otros
Fallback limpio sin romper nada.
---
Pilar 10 — rollout seguro
No se hace todo junto como un cowboy.
Fase 1 — observabilidad
- hashes por capa
- métricas por request
- logs de cache read/write
- diff entre turnos
Fase 2 — cache metadata en bloques estables
- working memory
- stable system header
- stable observations/reflections
Fase 3 — recall reuse policy
- reusar recall cuando siga vigente
- evitar churn
Fase 4 — split stable/live observations
- consolidado cacheable
- delta volátil separado
Fase 5 — tuning fino por provider
- Anthropic primero
- OpenAI/gateway después
---
Propuesta concreta de implementación en LightCode
Archivos a tocar
1. packages/opencode/src/session/llm.ts
- introducir estructura explícita de bloques cacheables
- adjuntar providerOptions a system/messages según provider
- mantener orden fijo
2. packages/opencode/src/session/prompt.ts
- separar memory estable vs volátil
- reusar recall cuando corresponda
- evitar rehacer bloques si el hash no cambió
3. packages/opencode/src/memory/provider.ts
- devolver metadata por capa además del string
  - hash
  - tokens
  - kind
  - stable/volatile
4. packages/opencode/src/provider/transform.ts
- agregar política real de prompt caching por provider
5. observabilidad / logs
- emitir métricas de cache-hit por capa
---
Tradeoffs
Ventajas
- mantenés contexto alto
- mejor cache hit rate
- menos costo
- menos reprocesamiento
- arquitectura más honesta que la actual
Costos
- más complejidad en armado del prompt
- más estado/fingerprinting
- testing por provider
- riesgo de regresión si mezclamos mal bloques
---
Mi recomendación final
La secuencia correcta es:
1. instrumentación
2. hash/fingerprint por capa
3. cacheControl real en bloques estables
4. reuso de recall
5. split stable/live observations
Eso te acerca a Mastra en cache-hit, PERO sin sacrificar tu flujo high-context.
Veredicto
Sí, se puede.
Y la clave es esta:
No optimizar cantidad de contexto. Optimizar IDENTIDAD y ESTABILIDAD del contexto.
Esa es la diferencia entre un sistema que “manda mucha memoria” y uno que “manda mucha memoria sin destruir cache”.
Si querés, el próximo paso te lo hago más serio todavía:
- te lo convierto en plan técnico ejecutable
- con fases
- archivos
- riesgos
- tests
- criterios de éxito.