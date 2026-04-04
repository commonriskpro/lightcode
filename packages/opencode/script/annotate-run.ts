import { AnnotateTool } from "../src/tool/annotate"
import { closeBrowser } from "../src/tool/browser"

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

  const result = await def.execute(
    {
      action: "once",
      url: "https://news.ycombinator.com",
      mode: "picker",
      headed: false,
      max: 30,
      wait: 1500,
      elementScreenshots: false,
      fullPage: true,
      closeOnComplete: true,
    },
    ctx,
  )

  return JSON.parse(result.output)
}

run()
  .then((result) => {
    console.log("\n=== ANNOTATE RESULTS ===\n")
    console.log(`URL: ${result.url}`)
    console.log(`Title: ${result.title}`)
    console.log(`Mode: ${result.mode}`)
    console.log(`Elements found: ${result.elements?.length ?? 0}`)
    console.log(
      `Screenshot captured: ${result.screenshot?.length > 100 ? "YES (" + Math.round(result.screenshot.length / 1024) + "KB)" : "NO"}`,
    )

    if (result.elements && result.elements.length > 0) {
      console.log("\n=== 3-5 KEY FINDINGS ===\n")
      result.elements.slice(0, 5).forEach((el: any, i: number) => {
        console.log(`${i + 1}. ${el.element.tag} | selector: ${el.element.selector}`)
        console.log(
          `   role: ${el.element.accessibility?.role || "none"}, name: "${el.element.accessibility?.name?.slice(0, 60) || ""}"`,
        )
        if (el.element.box) {
          console.log(`   box: ${el.element.box.width}x${el.element.box.height}`)
        }
      })
    }

    console.log("\n=== RAW JSON (truncated) ===\n")
    const out = JSON.stringify(result, null, 2)
    console.log(out.slice(0, 2500) + "\n...")

    return closeBrowser()
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
