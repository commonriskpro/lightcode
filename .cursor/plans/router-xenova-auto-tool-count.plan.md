---
name: Router Xenova auto tool count
overview: Política automática A+C (corte por ratio al mejor score + presupuesto de tokens) en lugar de top-K/max_tools fijos; mejora continua por curación de prototipos/EMBED_PHRASE/descr. a partir de fallos, sin reentrenar Xenova.
todos:
  - id: spec-cutoff
    content: Especificar A+C (rho, tau_abs, estimación tokens por tool, budget) y flags en config
    status: completed
  - id: impl-embed
    content: augmentMatchedEmbed + tool-router con corte dinámico; compat cuando auto off
    status: completed
  - id: tests
    content: Tests con scores sintéticos / sin HF en CI
    status: completed
  - id: feedback-loop
    content: Opcional — documentar o instrumentar log de (mensaje, tools router, fallo) para alimentar curación
    status: completed
isProject: false
---

# Política automática: cuántas tools mandar (con Xenova)

## Decisión confirmada

- **Conteo:** **A + C** — ratio respecto al mejor score (con suelo) → luego **presupuesto de tokens** que recorta si hace falta; techo duro `max_tools_cap`.
- **Mejora con fallos:** **sin reentrenar** — iterar **prototipos de intent**, `**EMBED_PHRASE`**, y **descripciones de tools** usando fallos reales (logs / feedback manual o export JSONL). Opcional: instrumentación mínima para facilitar esa curación.

## Problema con la política actual

- `max_tools` y `local_embed_top_k` son **límites fijos**: no reflejan que un turno necesite 15 o 30 tools.
- El usuario **no** quiere afinar manualmente estos números por caso.

## Idea central

**Xenova ya calcula** una puntuación por tool candidata (`dot(userVec, toolVec)`). Eso es la señal para decidir **cuántas** incluir, no solo “las K mejores” con K fijo.

Tres piezas encajadas:

1. **Ranking** (igual que ahora): todas las candidatas no en `matched`, ordenadas por score descendente.
2. **Corte automático** (nuevo): decidir el **prefijo** de esa lista que pasa, usando la **forma** de la distribución de scores, no un K global fijo.
3. **Techo de seguridad + presupuesto** (recomendado): evitar explosión de contexto sin volver a “un número mágico de tools”; el usuario puede configurar **presupuesto de tokens** para el bloque de definiciones de tools, estimado a partir de cada tool.

## Opciones de algoritmo de corte (elegir una o combinar)

### A) Corte por margen respecto al mejor score

Tras ordenar scores `s1 >= s2 >= ... >= sn`:

- Incluir tool `i` si `si >= s1 * rho` con `rho in (0,1)` (p. ej. 0.82–0.92), **y** `si >= tau_abs` (suelo mínimo, reemplaza en parte `local_embed_min_score` global).
- Ventaja: simple, un solo hiperparámetro interpretable (“mantener todo lo que esté cerca del mejor”).
- Riesgo: si muchas tools empatan alto, siguen entrando muchas → mitigar con B o C.

### B) Corte por “elbow” (caída brusca)

- Incluir `1..k` donde `k` maximiza `(s_i - s_{i+1})` por encima de un umbral mínimo, o el primer índice donde `s_i - s_{i+1} > delta`.
- Ventaja: adapta el número de tools al salto natural en la lista.
- Riesgo: ruido en embeddings si el salto es borroso.

### C) Presupuesto de tokens (automático en cuanto a “cuántas”, no manual por N)

- Ordenar por score; acumular tools hasta que `suma_tokens_estimados(tool_i) <= budget` (configurable una vez, p. ej. % de ventana o tokens fijos).
- Ventaja: **directamente** limita coste de contexto; el número de tools **sale** del budget.
- Combinación recomendada: **Corte A o B** para formar el candidato ordenado, luego **C** para recortar si el candidato sigue siendo demasiado grande.

## Piso y techo globales (no “política manual” por turno)

- **Piso**: `base_tools` siempre presentes si aplica el flujo actual.
- **Techo duro** (`max_tools_cap`, p. ej. 100): solo protección ante pathologías; no sustituye el corte dinámico.
- **Conversation tier**: 0 tools; sin cambio conceptual.

## Cambios de implementación (alto nivel)


| Área                                                                                               | Cambio                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[router-embed-impl.ts](packages/opencode/src/session/router-embed-impl.ts)` `augmentMatchedEmbed` | Devolver scores ordenados + lista de ids; aplicar función de corte (A/B/C) en lugar de `slice(0, topK)` fijo.                                                                                                                       |
| `[tool-router.ts](packages/opencode/src/session/tool-router.ts)`                                   | `orderIds` / `max`: usar tamaño resultante del conjunto **matched** después del augment dinámico, acotado por techo y presupuesto; deprecar o ignorar `max_tools` default cuando `tool_router_auto_count: true` (nombre tentativo). |
| `[config.ts](packages/opencode/src/config/config.ts)`                                              | Nuevos campos opcionales: `auto_tool_selection: true`, `auto_score_ratio`, `auto_token_budget`, `max_tools_cap`; mantener `local_embed_top_k` / `max_tools` como fallback cuando auto está off.                                     |


## Qué **no** es automático (sin otro modelo)

- **No** hay un “número óptimo” teórico sin señal: la señal es la **distribución de scores** Xenova + límites de **presupuesto** o **seguridad**.
- Si se quisiera **predecir** “este turno necesitas exactamente 17 tools” sin ranking, haría falta otro predictor (p. ej. LLM pequeño) — **fuera de alcance** de “solo Xenova”.

## ¿Se puede entrenar Xenova con los fallos para mejorar?

**Dentro de OpenCode tal como está:** no. El stack usa el modelo **solo en inferencia** (`feature-extraction`, ONNX vía `@huggingface/transformers` / Transformers.js). No hay bucle de entrenamiento ni pesos actualizables en runtime.

**Fuera de la app (sí, en principio):**

- **Fine-tuning offline** del mismo tipo de modelo (paraphrase / MiniLM) en Python con pares o tripletes (mensaje usuario ↔ tool correcta / incorrecta), luego **exportar** a ONNX y publicar un nuevo id de Hugging Face (`local_embed_model` apuntando a ese artefacto). Eso es **reentrenar el backbone**, no “Xenova” como marca distinta; la vía es **sentence-transformers** / similares + conversión ONNX.
- **Coste:** datos etiquetados, evaluación, reproducibilidad, y **redeploy** del binario o cache para que los usuarios carguen el nuevo modelo.

**Alternativas que capturan “fallos” sin reentrenar el modelo base:**

1. **Curación de datos → reglas de producto:** registrar (mensaje, tools elegidas, corrección humana) y **añadir frases** a prototipos / `EMBED_PHRASE` / descripciones — mejora inmediata sin ML.
2. **Capa ligera encima de embeddings congelados:** un **clasificador lineal** o **logit** por tool entrenado offline con vectores de Xenova como features (mismo modelo base, sin tocar ONNX).
3. **Feedback explícito en UI** que alimente un JSONL exportable para reentrenamiento o para (1).

**Conclusión:** “mejorar con fallos” **sí** es posible como **pipeline offline** o como **ajuste de datos/prototipos**; **no** como entrenamiento incremental automático del modelo Xenova dentro del TUI en cada sesión sin un proyecto adicional de ML.

## Recomendación de viabilidad (decisión de producto)

### Conteo automático de tools (A / B / C)

**Más viable:** **A + C en cadena** — primero **ratio respecto al mejor score** (A) con suelo `tau_abs`, luego **presupuesto de tokens** (C) que recorta el prefijo si aun así entran demasiadas tools.

- **Por qué:** (C) ataca el problema real (coste de contexto) con un solo knob estable (“cuántos tokens dedico a definiciones de tools”), sin fijar un número de tools a mano. (A) es barato de implementar y acota el conjunto antes del budget. **(B) elbow** es más frágil con embeddings ruidosos; reservarla como opción avanzada o heurística secundaria, no como única señal.

### Mejora con fallos (sin reentrenar)

**Más viable:** **curación: prototipos + `EMBED_PHRASE` + descripciones** a partir de logs / feedback.

- **Por qué:** impacto rápido, sin pipeline ML, encaja en releases pequeños. **Fine-tuning offline** del backbone solo compensa si hay **volumen y etiquetado** serios. **Clasificador lineal sobre embeddings** es un punto medio si más adelante hay datos estructurados.

## Próximo paso de producto

Pasar a **implementación**: A → C, `max_tools_cap`, compat con `max_tools` / `local_embed_top_k` cuando `auto_tool_selection` esté off; bucle de mejora vía curación (sin ML) según fallos acumulados.