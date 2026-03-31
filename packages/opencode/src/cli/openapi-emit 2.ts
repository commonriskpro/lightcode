import { Server } from "../server/server"

/** JSON OpenAPI 3.1 con muestras de código para el SDK; sin dependencias del TUI. */
export async function emitOpenapiJson(): Promise<string> {
  const specs = await Server.openapi()
  for (const item of Object.values(specs.paths ?? {})) {
    for (const method of ["get", "post", "put", "delete", "patch"] as const) {
      const operation = item[method]
      if (!operation?.operationId) continue
      // @ts-expect-error hono-openapi operation objects accept extension fields
      operation["x-codeSamples"] = [
        {
          lang: "js",
          source: [
            `import { createOpencodeClient } from "@opencode-ai/sdk`,
            ``,
            `const client = createOpencodeClient()`,
            `await client.${operation.operationId}({`,
            `  ...`,
            `})`,
          ].join("\n"),
        },
      ]
    }
  }
  return JSON.stringify(specs, null, 2)
}
