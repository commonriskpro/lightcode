# Context7 + OpenCode en este fork

[Context7](https://context7.com) expone **documentación y ejemplos actualizados** de librerías y frameworks vía MCP. No sustituye a [Engram](./engram-opencode.md) (memoria de tu proyecto).

---

## Qué aporta

| Herramienta MCP (nombre en el servidor) | Uso |
|----------------------------------------|-----|
| `resolve-library-id` | Convierte un nombre de librería en un ID Context7 (`/org/proyecto`). |
| `query-docs` | Responde preguntas con trozos de documentación relevantes (tras resolver el ID si hace falta). |

En OpenCode los IDs de tool suelen aparecer como **`context7:resolve-library-id`** y **`context7:query-docs`** (prefijo del servidor + nombre).

---

## Configuración en el repo

**`.opencode/opencode.jsonc`** incluye:

```jsonc
"context7": {
  "type": "local",
  "command": ["npx", "-y", "@upstash/context7-mcp"],
  "enabled": true,
  "timeout": 60000
}
```

- Hace falta **Node.js** y **`npx`** en PATH (la primera vez descarga el paquete).
- **API key (opcional pero recomendada):** [context7.com/dashboard](https://context7.com/dashboard) — límites más generosos. Define **`CONTEXT7_API_KEY`** en el entorno (p. ej. en **`fork.opencode.env`**, comentado de ejemplo) para que el proceso herede la variable.

---

## Setup asistido (alternativa)

Si prefieres OAuth + skill oficial:

```bash
npx ctx7 setup --opencode
```

Eso puede tocar config global; revisa que no pise tu **`.opencode/opencode.jsonc`** del proyecto. La entrada anterior en el repo ya cubre el modo MCP estándar.

---

## Cómo pedirlo en el chat

Ejemplos (también en la [doc de Context7 — OpenCode](https://context7.com/docs/clients/opencode)):

- *use context7 to show me how to set up middleware in Next.js 15*
- *use context7 with /vercel/next.js for app router setup*

Para reglas persistentes, puedes añadir en tu `AGENTS.md` o reglas del IDE algo como: *cuando haga falta documentación de una librería, usa las tools Context7 antes que inventar APIs*.

---

## Referencias

- [upstash/context7 — README](https://github.com/upstash/context7) (MCP, `npx @upstash/context7-mcp`).
- [Engram en este fork](./engram-opencode.md) — memoria persistente SDD.
- [gentle-ai components — Context7](https://github.com/Gentleman-Programming/gentle-ai/blob/main/docs/components.md).
