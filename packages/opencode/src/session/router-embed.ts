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

function useIpc() {
  return (
    typeof process.versions?.bun === "string" && process.env.OPENCODE_ROUTER_EMBED_INPROCESS !== "1"
  )
}

export async function classifyIntentEmbed(
  input: Parameters<typeof classifyIntentEmbedImpl>[0],
): ReturnType<typeof classifyIntentEmbedImpl> {
  if (useIpc()) return ipc.classifyIntentEmbed(input)
  return classifyIntentEmbedImpl(input)
}

export async function augmentMatchedEmbed(
  input: Parameters<typeof augmentMatchedEmbedImpl>[0],
): ReturnType<typeof augmentMatchedEmbedImpl> {
  if (useIpc()) return ipc.augmentMatchedEmbed(input)
  return augmentMatchedEmbedImpl(input)
}
