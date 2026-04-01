Trazado completo de lo que se envía al LLM en este fork (openedit2)  
A continuación se muestra, paso a paso, qué información se construye y se envía al modelo de lenguaje (LLM) cada vez que el agente recibe un nuevo mensaje de usuario. El flujo está implementado en:
* packages/opencode/src/session/prompt.ts – función prompt → loop → resolveTools → construcción del system prompt y tools.
* packages/opencode/src/session/tool-router.ts – determina qué conjunto de herramientas se expone y qué nivel de contexto (contextTier) se debe usar.
---
1. Entrada: el mensaje del usuario
Cuando el usuario escribe algo (por ejemplo "quiero que hagas un trazado completo de lo que se envia a el llm en este fork"), el método SessionPrompt.prompt recibe un objeto PromptInput que contiene:
Campo	Valor (ejemplo)
sessionID	ULID de la sesión activa
messageID	ULID del nuevo mensaje de usuario
parts	[{type:"text", text:"quiero que hagas un trazado completo …"}]
tools	(opcional) overrides de herramientas provenientes de la UI o de @agent
noReply	false (queremos una respuesta)
format	{type:"text"} (salida libre)
agent	nombre del agente activo (por defecto "open-code" o el que haya sido seleccionado)
model	proveedor + modelo (p.ej. {providerID:"nemotron", modelID:"nemotron-3-super-free"})
El agente también carga su configuración (Config.get()) y sus permisos (session.permission).
---
2. Creación del MessageV2.User
const info: MessageV2.Info = {
  id: MessageID.ascending(),
  role: "user",
  sessionID: input.sessionID,
  time: { created: Date.now() },
  tools: input.tools,
  agent: agent.name,
  model: input.model ?? agent.model ?? (await lastModel(input.sessionID)),
  system: input.system,
  format: input.format,
  variant: input.variant ?? …,
};
Este MessageV2.Info se guarda en el historial de la sesión y será usado en los pasos siguientes.
---
3. Bucle principal (loop)
En cada iteración del bucle se:
1. Actualiza el estado (SessionStatus.set(sessionID, {type:"busy"})).
2. Extrae los mensajes relevantes del historial (MessageV2.stream(sessionID)) para obtener:
   * lastUser – el mensaje de usuario que acabamos de crear.
   * lastAssistant / lastFinished – el último mensaje del asistente (si lo hay).
   * tasks – cualquier parte de tipo compaction o subtask pendiente.
3. Incrementa el contador de step (se usa solo para lógica interna; el número real de turno se deriva de userMsgs.length).
4. Obtiene el modelo (Provider.getModel(...)).
5. Ejecuta tareas pendientes (task o compaction) – si las hay, se delega a un sub‑agente y el bucle continúa.
6. Llama a resolveTools (ver siguiente sección) para decidir qué herramientas exponer y cuánto contexto de system‑prompt incluir.
7. Construye el system prompt basado en el contextTier devuelto por el router.
8. Añade el toolRouterPrompt (si el router lo generó) y, si corresponde, el mensaje de StructuredOutput.
9. Ejecuta el LLM a través de SessionProcessor.process.
10. Registra token‑breakdown y persiste un registro JSONL para depuración.
11. Rompe el bucle cuando el modelo indica stop, se alcanza el máximo de pasos, o se produce una herramienta StructuredOutput.
---
4. resolveTools → detección de intención y selección de herramientas
Esta función está en packages/opencode/src/session/prompt.ts (líneas 901‑1139). Su flujo es:
1. Obtiene la configuración de router (Flag.OPENCODE_TOOL_ROUTER o cfg.experimental?.tool_router).
2. Si el router está desactivado o se indica skip:true → devuelve todas las herramientas y contextTier = "full".
3. Si el agente es de compactación → también devuelve full.
4. Extrae el texto del último mensaje de usuario (userText(messages) → normaliza, recorta a 16 000 caracteres).
5. Detecta modo conversación mediante:
   * detectConversational(text) – regex de saludos y frases charlas (español/inglés/portugués) sin palabras clave de herramientas.
   * isLikelyChat(text) – fallback para mensajes cortos sin señales de código.
   * (opcional) clasificador semántico (intent-classifier) para mensajes de 5‑200 caracteres que no coincidieron con los regex.
6. Si se detecta conversación → devuelve:
      { tools: {}, promptHint: undefined, contextTier: "conversation" }
      (sin herramientas, sin pista de router, y el system‑prompt será el modo conversación).
7. Si no es conversación → continúa con el router offline:
   * Calcula si el router es aditivo (experimental.tool_router.additive === true).
   * Aplica apply_after_first_assistant (por defecto false → el router actúa desde el primer turno).
   * Evalúa cada regla en RULES (expresiones regulares que detectan intenciones como edit, delete, web/research, etc.).
   * Si ninguna regla coincide y no_match_fallback !== false, agrega la etiqueta "fallback/no_match" y las herramientas de fallback (["glob","grep","read","task"]).
   * Ordena las herramientas según:
     * base_tools (por defecto ["read","task","skill"]).
     * Las herramientas que coincidieron con reglas.
     * Límite máximo (max_tools, default 12).
   * Aplica descripciones reducidas (SLIM_DESC) a las herramientas base que no fueron coincididas por ninguna regla (para ahorrar tokens).
   * Añade herramientas MCP si corresponde, filtrándolas por intención cuando mcp_filter_by_intent está activo.
   * Construye el promptHint (ver sección 5) y cuenta tokens estimados de:
     * descripciones de herramientas,
     * el propio promptHint.
   * Finalmente devuelve:
          {
       tools: <record de AITool filtrado y con descripciones posiblemente reducidas>,
       promptHint: <string o undefined>,
       contextTier: matchedLabels.length === 0 ? "minimal" : "full"
     }
     
> Nota: El contextTier le indica a prompt.ts cuánta parte del system prompt incluir:
> * "conversation" → solo un mensaje breve de ayuda, sin herramientas.
> * "minimal" → herramientas base (read/task/skill/glob/grep/…) + un system‑prompt reducido.
> * "full" → todo el system‑prompt completo + todas las herramientas permitidas.
---
5. Construcción del system prompt (en prompt.ts, líneas 700‑730)
let system: string[];
if (contextTier === "conversation") {
  system = [
    "You are a helpful AI assistant. Respond naturally and conversationally. " +
    "You do not have access to files, shell, or project tools in this mode. " +
    "If the user asks you to do something that requires code or file access, let them know they need to ask you to work on their project.",
  ];
} else {
  // Full or minimal: build the complete system prompt
  system = await SystemPromptCache.getParts({
    agent,
    model,
    instructions: instructionMode(cfg, msgs, format.type === "json_schema"),
  });
  if (toolRouterPrompt) system.push(toolRouterPrompt);
}
if (format.type === "json_schema") {
  system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT);
}
const systemText = system.join("\n\n");
* SystemPromptCache.getParts devuelve las partes estáticas del system‑prompt (definidas en archivos como plan.txt, build-switch.txt, max-steps.txt, etc.) más cualquier instruction dinámica que provenga de la configuración o del historial.
* toolRouterPrompt es el bloque que el router genera (ver sección 6).  
  Ejemplo de salida:  
    ## Offline tool router
  Mode: additive (minimal tier + rule matches merged from full registry).
  Intent from the last user message (keyword rules): explore/es.
  Tools attached for this request: bash, glob, grep, read, task, todowrite, webfetch, websearch, question, skill, codesearch, edit.
  Use only these tools; if something is missing, say so and suggest rephrasing the request.
  
* Si el usuario pidió salida JSON Schema (format.type === "json_schema"), se añade la instrucción de STRUCTURED_OUTPUT_SYSTEM_PROMPT.
---
6. promptHint – lo que realmente ve el modelo en el system‑prompt
La función promptHint (en tool-router.ts, líneas 186‑218) devuelve un bloque de texto que comienza con:
## Offline tool router
Mode: <additive|subtractive|disabled|first turn|compaction agent|empty passthrough>
Intent from the last user message (keyword rules): <etiquetas separadas por coma>.
Tools attached for this request: <lista ordenada de ids>.
Use only these tools; if something is missing, say so and suggest rephrasing the request.
Luego pueden añadirse líneas de advertencia cuando:
* El router sugiere una herramienta que el agente/tiene permiso denegado.
* La intención es delete/remove pero el conjunto de herramientas no incluye bash, edit o write.
---
7. Token accounting (para depuración)
Antes de llamar al LLM, prompt.ts calcula y registra:
Fuente	Cómo se cuenta
systemText	estimateTokens(systemText) (≈ len/4)
Texto de los mensajes de usuario (userTextTokens)	suma de estimateTokens de cada parte de texto no sintética.
Resultados de herramientas previas (toolResultTokens)	suma de estimateTokens de la salida de cada tool completado.
Definiciones de herramientas (toolDefTokens)	suma de estimateTokens de la description de cada herramienta expuesta (0 en modo conversación).
Total estimado	suma de los cuatro anteriores.
Todo eso se escribe en un archivo JSONL bajo {data}/debug/tokens/<sessionID>.jsonl con un registro por turno, conteniendo también:
* step (número de turno real, derivado de userMsgs.length);
* contextTier;
* desglose de tokens por categoría;
* timestamp ISO.
Esto permite al usuario (o a un desarrollador) revisar exactamente cuántos tokens se enviaron en cada turno y por qué.
---
8. Ejemplo concreto: el mensaje actual del usuario
> Usuario: "quiero que hagas un trazado completo de lo que se envia a el llm en este fork"
Paso a paso (simplificado)
1. Texto normalizado → mismo string (sin espacios extra).
2. detectConversational → falso porque contiene palabras clave como trazado, llm, fork (coinciden con reglas de explore/es y con señales de código).
3. isLikelyChat → falso (largo > 60 y tiene señales de trabajo).
4. Clasificador semántico (si se activa) probablemente devuelva "code" o "web" → no "conversation".
5. Router → coincide con la regla:
      /\b(verificar|muéstrame|analiza|analizar|encuentra|comprueba|explica|cuáles|cuales|dónde|donde|fichero|código|codigo|proyecto|compila)\b/i
      Etiqueta: "explore/es"  
   Herramientas añadidas por la regla: ["glob","grep","read","task"].
6. Base tools (por defecto) → ["read","task","skill"].  
   Después de unir y ordenar (máx 12) obtenemos, por ejemplo:  
   [read, task, skill, glob, grep, write?, edit?, …] (el router añade también bash si la intención de shell aparece, pero aquí no).
7. Se aplican descripciones reducidas a las herramientas base que no fueron coincididas por ninguna regla (p.ej. skill podría quedar con su descripción completa porque está en la base; read y task suelen recibir la versión slim).
8. promptHint generado (ejemplo real):
      ## Offline tool router
   Mode: additive (minimal tier + rule matches merged from full registry).
   Intent from the last user message (keyword rules): explore/es.
   Tools attached for this request: bash, glob, grep, read, task, todowrite, webfetch, websearch, question, skill, codesearch, edit.
   Use only these tools; if something is missing, say so and suggest rephrasing the request.
   
9. contextTier → como matchedLabels.length > 0 → "full".
10. System prompt → se obtienen las partes estáticas del SystemPromptCache (plan, build‑switch, max‑steps, etc.) + el bloque de promptHint anterior + (si no es JSON) nada más.
11. Se arma el mensaje final para el LLM:
        <system prompt completo de varias líneas>
    <último mensaje del usuario: "quiero que hagas un trazado completo de lo que se envia a el llm en este fork">
    <lista de herramientas disponibles (con sus nombres, descriptions y schemas)>
    
12. Token accounting (valores aproximados, dependiendo de la longitud exacta del system‑prompt):
    * system: ~ 1 200‑1 500 tokens
    * userText: ~ 30 tokens
    * toolResults: 0 (primera vuelta)
    * toolDefs: ~ 200‑300 tokens (descripciones de las ~12 herramientas)
    * Total estimado: ~ 1 500‑1 800 tokens.
13. El LLM recibe ese prompt, genera una respuesta, y el bucle continúa (si la respuesta contiene llamadas a herramientas, se ejecutan y el bucle da otra vuelta con el nuevo historial).
---
9. Resumen visual del flujo
[Usuario] ──► createUserMessage
   │
   ▼
[prompt()] ──► loop
   │
   ├─► obtener último mensaje de usuario
   ├─► ejecutar tareas pendientes (task/compaction) → (si hay, volver al inicio)
   │
   ▼
[resolveTools] ──► toolRouter.apply
   │
   ├─► detectar conversación? → sí → {tools:{}, contextTier:"conversation"}
   │
   └─► no conversación
       │
       ├─► aplicar reglas RULES
       ├─► fallback/no_match (si procede)
       ├─► ordenar y limitar herramientas (base + matches)
       ├─► aplicar SLIM_DESC a base no‑matched
       ├─► construir promptHint
       │
       ▼
   {tools, promptHint, contextTier}
   │
   ▼
[prompt.ts] ► construir system prompt
   │
   ├─► contextTier === "conversation" → mini‑mensaje
   │
   └─► else
         ├─► SystemPromptCache.getParts (plan, build‑switch, max‑steps, …)
         ├─► + promptHint (si existe)
         └─► + STRUCTURED_OUTPUT_SYSTEM_PROMPT (si JSON schema)
   │
   ▼
[LLM] recibe:
   system prompt + historial de mensajes + lista de herramientas
   │
   ▼
[respuesta del LLM] → (posibles tool calls) → bucle continúa
---
## 10. Cómo verificar el tracing en tu propia sesión
Si quieres ver exactamente qué se envió en un turno determinado:
1. **Activar el logging de token‑breakdown** (ya está activo por defecto en este fork).  
   Cada turno escribe una línea en:
   ```
   <ruta-de-datos-de-opencode>/debug/tokens/<sessionID>.jsonl
   ```
   Ejemplo de una línea:
   ```json
   {
     "step":3,
     "contextTier":"full",
     "system":{"tokens":1342,"instructionMode":"text"},
     "messages":{"total":5,"user":3,"assistant":2},
     "userText":{"tokens":28,"partCount":1},
     "toolResults":{"tokens":0,"partCount":0},
     "toolDefs":{"tokens":212,"count":12,"names":["bash","codesearch","edit","glob","grep","question","read","skill","task","todowrite","webfetch","websearch"]},
     "total":{"estimated":1582,"breakdown":"system=1342 + userText=28 + toolResults=0 + toolDefs=212"},
     "timestamp":"2026-03-30T12:34:56.789Z"
   }
   ```
2. **Para ver el prompt completo** (incluyendo el texto del system‑prompt y las herramientas) puedes agregar un `console.log` temporal en `prompt.ts` justo antes de llamar a `processor.process`:
   ```ts
   console.log("\n=== PROMPT ENVIADO AL LLM ===\n");
   console.log("SYSTEM:\n", systemText);
   console.log("\nUSER TEXT:\n", lastUser.parts.map(p=>p.type==="text"?p.text:"").join("\n\n"));
   console.log("\nTOOLS:\n", JSON.stringify(Object.keys(tools),null,2));
   ```
   (Recuerda eliminar el `console.log` después de hacer la depuración.)
---
Conclusión
El trazado de lo que se envía al LLM en este fork está completamente determinado por:
1. El mensaje del usuario (texto y posibles overrides de herramientas).
2. El detector de intención / tool‑router que decide:
   * Qué conjunto de herramientas exponer (posiblemente con descripciones reducidas).
   * Cuánto del system prompt incluir (conversation | minimal | full).
   * Un bloque de pista (promptHint) que se añade al system‑prompt para que el modelo sepa qué herramientas tiene disponibles y por qué fueron seleccionadas.
3. El system‑prompt base (plan, límites de pasos, instrucciones de modo, etc.) que se cachea y se combina con la pista del router.
4. El historial de la sesión (mensajes de usuario y asistente previos) que se incluye tal cual.
5. El registro de token‑accounting que permite auditoría posterior.
Con esa información puedes reproducir exactamente qué prompt recibió el modelo en cualquier turno de la sesión. Si necesitas un dump real de un turno concreto, basta con consultar el archivo JSONL de tokens mencionado arriba o habilitar el console.log temporal indicado. ¡Que lo disfrutes!