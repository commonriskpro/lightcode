import { createMemo } from "solid-js"
import { useSync } from "./sync"
import { Global } from "@/global"
import { userCwd } from "@/cli/bootstrap"

export function useDirectory() {
  const sync = useSync()
  return createMemo(() => {
    const directory = sync.data.path.directory || userCwd()
    const result = directory.replace(Global.Path.home, "~")
    if (sync.data.vcs?.branch) return result + ":" + sync.data.vcs.branch
    return result
  })
}
