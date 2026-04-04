import { AnnotateTool } from "@/tool/annotate"
import { closeBrowser } from "@/tool/browser"

const run = async () => {
  const def = await AnnotateTool.init()
  const ctx = {
    sessionID: "session_test",
    messageID: "message_test",
    agent: "test",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    ask: async () => {},
  } as never

  const picker = await def.execute(
    {
      action: "once",
      url: "https://example.com",
      mode: "picker",
      headed: false,
      max: 3,
      elementScreenshots: false,
      fullPage: false,
      wait: 300,
      closeOnComplete: true,
    },
    ctx,
  )

  const p = JSON.parse(picker.output)
  console.log(`picker_title=${p.title}`)
  console.log(`picker_elements=${p.elements.length}`)

  const etch = await def.execute(
    {
      action: "once",
      url: "https://example.com",
      mode: "etch",
      headed: false,
      track: ["h1"],
      max: 3,
      elementScreenshots: false,
      fullPage: false,
      wait: 300,
      script: 'const h1=document.querySelector("h1"); if(h1){ h1.style.color="rgb(255, 0, 0)"; }',
      closeOnComplete: true,
    },
    ctx,
  )

  const e = JSON.parse(etch.output)
  console.log(`etch_changes=${e.changes.length}`)
  console.log(`etch_mutations=${e.mutations.length}`)
}

run()
  .then(() => closeBrowser())
  .then(() => process.exit(0))
  .catch((err) =>
    closeBrowser()
      .catch(() => undefined)
      .then(() => {
        console.error(err)
        process.exit(1)
      }),
  )
