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
  classifyIntentEmbedMerged as classifyIntentEmbedMergedImpl,
} from "./router-embed-impl"
import * as ipc from "./router-embed-ipc"
import { Log } from "@/util/log"

const log = Log.create({ service: "router-embed" })

function useIpc() {
  return (
    typeof process.versions?.bun === "string" && process.env.OPENCODE_ROUTER_EMBED_INPROCESS !== "1"
  )
}

export async function classifyIntentEmbed(
  input: Parameters<typeof classifyIntentEmbedImpl>[0],
): ReturnType<typeof classifyIntentEmbedImpl> {
  if (useIpc()) {
    try {
      return await ipc.classifyIntentEmbed(input)
    } catch (err) {
      log.error("router_embed_ipc_failed", { method: "classifyIntentEmbed", message: String(err) })
      throw err
    }
  }
  return classifyIntentEmbedImpl(input)
}

export async function classifyIntentEmbedMerged(
  input: Parameters<typeof classifyIntentEmbedMergedImpl>[0],
): ReturnType<typeof classifyIntentEmbedMergedImpl> {
  if (useIpc()) {
    try {
      return await ipc.classifyIntentEmbedMerged(input)
    } catch (err) {
      log.error("router_embed_ipc_failed", { method: "classifyIntentEmbedMerged", message: String(err) })
      throw err
    }
  }
  return classifyIntentEmbedMergedImpl(input)
}

export async function augmentMatchedEmbed(
  input: Parameters<typeof augmentMatchedEmbedImpl>[0],
): ReturnType<typeof augmentMatchedEmbedImpl> {
  if (useIpc()) {
    try {
      return await ipc.augmentMatchedEmbed(input)
    } catch (err) {
      log.error("router_embed_ipc_failed", { method: "augmentMatchedEmbed", message: String(err) })
      throw err
    }
  }
  return augmentMatchedEmbedImpl(input)
}
