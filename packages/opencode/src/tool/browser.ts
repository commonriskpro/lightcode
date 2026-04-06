import puppeteer, { type Browser, type Page } from "puppeteer"

let browser: Browser | undefined
let mode: { headless: boolean; slow: number } | undefined

function envHeadless() {
  const raw = process.env.PUPPETEER_HEADLESS
  if (!raw) return true
  if (raw === "0") return false
  if (raw.toLowerCase() === "false") return false
  return true
}

function envSlow() {
  const raw = Number.parseInt(process.env.PUPPETEER_SLOWMO ?? "0", 10)
  if (Number.isNaN(raw)) return 0
  if (raw < 0) return 0
  return raw
}

export async function getBrowser(opts?: { headless?: boolean; slow?: number }) {
  const headless = opts?.headless ?? envHeadless()
  const slow = opts?.slow ?? envSlow()

  if (browser?.connected && mode?.headless === headless && mode?.slow === slow) return browser

  if (browser?.connected) await browser.close()

  browser = await puppeteer.launch({
    headless,
    slowMo: slow,
    defaultViewport: headless ? { width: 1366, height: 900 } : null,
    args: ["--no-sandbox", "--disable-setuid-sandbox", ...(headless ? [] : ["--start-maximized"])],
  })
  mode = { headless, slow }
  return browser
}

export class NavigationError extends Error {
  constructor(
    public readonly kind: "invalid_url" | "timeout" | "load_failed",
    public readonly url: string,
    cause?: unknown,
  ) {
    const msg =
      kind === "invalid_url"
        ? `Invalid URL: "${url}". Make sure it starts with http:// or https://.`
        : kind === "timeout"
          ? `Timed out loading "${url}". The page took too long to respond.`
          : `Failed to load "${url}". Check the URL is reachable and try again.`
    super(msg, { cause })
    this.name = "NavigationError"
  }
}

export function validateUrl(url: string): void {
  if (url === "about:blank") return
  try {
    const parsed = new URL(url)
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad protocol")
  } catch {
    throw new NavigationError("invalid_url", url)
  }
}

export async function open(url: string, timeout = 30_000, opts?: { headless?: boolean; slow?: number }) {
  validateUrl(url)

  const app = await getBrowser(opts)

  // Reuse the default blank tab Puppeteer opens on launch so we don't leak tabs
  const pages = await app.pages()
  const blank = pages.find((p) => p.url() === "about:blank")
  const page = blank ?? (await app.newPage())

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout })
  } catch (err) {
    const msg = String(err)
    if (msg.includes("TimeoutError") || msg.includes("timeout")) throw new NavigationError("timeout", url, err)
    throw new NavigationError("load_failed", url, err)
  }

  return page
}

function edge(page: Page, selector: string, type: "padding" | "border" | "margin") {
  return page.evaluate(
    (arg: { selector: string; type: "padding" | "border" | "margin" }) => {
      const el = document.querySelector(arg.selector)
      if (!el) return null
      const css = getComputedStyle(el)
      const read = (side: string) => Number.parseFloat(css.getPropertyValue(`${arg.type}-${side}`)) || 0
      return {
        top: read("top"),
        right: read("right"),
        bottom: read("bottom"),
        left: read("left"),
      }
    },
    { selector, type },
  )
}

export async function shot(page: Page, fullPage = true, type: "png" | "jpeg" = "png") {
  const data = await page.screenshot({ fullPage, type, quality: type === "jpeg" ? 85 : undefined })
  return `data:image/${type};base64,${Buffer.from(data).toString("base64")}`
}

export async function crop(page: Page, selector: string) {
  const node = await page.$(selector)
  if (!node) return undefined
  const rect = await node.boundingBox()
  if (!rect) return undefined
  if (rect.width <= 0 || rect.height <= 0) return undefined
  const data = await page.screenshot({
    type: "png",
    clip: {
      x: Math.max(0, rect.x),
      y: Math.max(0, rect.y),
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    },
  })
  return `data:image/png;base64,${Buffer.from(data).toString("base64")}`
}

export async function close(page: Page) {
  await page.close()
}

export async function closeBrowser() {
  if (!browser) return
  await browser.close()
  browser = undefined
  mode = undefined
}

export async function box(page: Page, selector: string) {
  const rect = await page.evaluate((selector: string) => {
    const el = document.querySelector(selector)
    if (!el) return null
    const box = el.getBoundingClientRect()
    return {
      top: box.top,
      left: box.left,
      width: box.width,
      height: box.height,
    }
  }, selector)
  if (!rect) return null
  const [padding, border, margin] = await Promise.all([
    edge(page, selector, "padding"),
    edge(page, selector, "border"),
    edge(page, selector, "margin"),
  ])
  if (!padding || !border || !margin) return null
  return {
    ...rect,
    padding,
    border,
    margin,
  }
}
