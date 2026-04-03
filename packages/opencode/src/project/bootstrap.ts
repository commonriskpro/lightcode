import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Snapshot } from "../snapshot"
import { Project } from "./project"
import { Vcs } from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"

const bootLog = Log.create({ service: "bootstrap" })

export async function InstanceBootstrap() {
  bootLog.info("bootstrapping", { directory: Instance.directory })
  {
    using _ = bootLog.time("plugin.init")
    await Plugin.init()
  }
  {
    using _ = bootLog.time("share_next.init")
    ShareNext.init()
  }
  {
    using _ = bootLog.time("format.init")
    Format.init()
  }
  {
    using _ = bootLog.time("lsp.init")
    await LSP.init()
  }
  {
    using _ = bootLog.time("file.init")
    File.init()
  }
  {
    using _ = bootLog.time("file_watcher.init")
    FileWatcher.init()
  }
  {
    using _ = bootLog.time("vcs.init")
    Vcs.init()
  }
  {
    using _ = bootLog.time("snapshot.init")
    Snapshot.init()
  }

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      Project.setInitialized(Instance.project.id)
    }
  })
}
