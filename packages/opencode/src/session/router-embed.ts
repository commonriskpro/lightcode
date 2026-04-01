/**
 * Embeddings: under Bun we delegate to a Node subprocess (`router-embed-ipc`) so Bun never loads
 * onnxruntime-node. Set OPENCODE_ROUTER_EMBED_INPROCESS=1 to force in-process (debug).
 */
export {
  DEFAULT_LOCAL_EMBED_MODEL,
  type IntentPrototype,
  BUILTIN_INTENT_PROTOTYPES,
  CONVERSATION_INTENT_LABEL,
  CONVERSATION_INTENT_PROTOTYPE,
  ROUTER_INTENT_PROTOTYPES,
} from "./router-embed-impl"

import {
  augmentMatchedEmbed as augmentMatchedEmbedImpl,
  classifyIntentEmbed as classifyIntentEmbedImpl,
} from "./router-embed-impl"
import * as ipc from "./router-embed-ipc"
import { Log } from "@/util/log"

const log = Log.create({ service: "router-embed" })

function useIpc() {
  return (
    typeof process.versions?.bun === "string" && process.env.OPENCODE_ROUTER_EMBED_INPROCESS !== "1"
  )
}

function shouldFallback(err: unknown) {
  const msg = String(err)
  return (
    msg.includes("router_embed_ipc_no_child") ||
    msg.includes("router_embed_root_missing") ||
    msg.includes("router_embed_worker_missing")
  )
}

export async function classifyIntentEmbed(
  input: Parameters<typeof classifyIntentEmbedImpl>[0],
): ReturnType<typeof classifyIntentEmbedImpl> {
  if (useIpc()) {
    try {
      return await ipc.classifyIntentEmbed(input)
    } catch (err) {
      if (!shouldFallback(err)) throw err
      log.warn("router_embed_ipc_fallback_inprocess", { method: "classifyIntentEmbed", message: String(err) })
    }
  }
  return classifyIntentEmbedImpl(input)
}

export async function augmentMatchedEmbed(
  input: Parameters<typeof augmentMatchedEmbedImpl>[0],
): ReturnType<typeof augmentMatchedEmbedImpl> {
  if (useIpc()) {
    try {
      return await ipc.augmentMatchedEmbed(input)
    } catch (err) {
      if (!shouldFallback(err)) throw err
      log.warn("router_embed_ipc_fallback_inprocess", { method: "augmentMatchedEmbed", message: String(err) })
    }
  }
  return augmentMatchedEmbedImpl(input)
}
