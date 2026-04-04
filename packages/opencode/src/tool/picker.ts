import type { Elem } from "./annotate-types"
import { box } from "./browser"
import type { Page } from "puppeteer"

const QUERY = "a,button,input,select,textarea,[role='button'],[role='link'],[tabindex]"

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 500)
}

function merge(list: string[], max: number) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
    if (out.length >= max) return out
  }
  return out
}

async function selectors(page: Page, custom?: string[], max = 30) {
  if (custom?.length) return merge(custom, max)
  const list = await page.evaluate(
    (arg: { query: string; max: number }) => {
      const query = arg.query
      const max = arg.max
      const nodes = Array.from(document.querySelectorAll(query)).slice(0, max * 3)
      const esc = (x: string) => (globalThis.CSS && CSS.escape ? CSS.escape(x) : x)

      const pick = (node: Element) => {
        if (node.id) return `#${esc(node.id)}`

        let cur: Element | null = node
        const out: string[] = []
        while (cur && out.length < 6) {
          const tag = cur.tagName.toLowerCase()
          const sib = cur.parentElement
          const all = sib ? Array.from(sib.children).filter((x) => x.tagName === cur?.tagName) : []
          const idx = all.length > 1 ? `:nth-of-type(${all.indexOf(cur) + 1})` : ""
          out.unshift(`${tag}${idx}`)
          cur = cur.parentElement
        }
        return out.join(" > ")
      }

      return nodes.map((node) => pick(node))
    },
    { query: QUERY, max },
  )
  return merge(list, max)
}

async function info(page: Page, selector: string): Promise<Omit<Elem, "box"> | null> {
  return page.evaluate((selector: string) => {
    const node = document.querySelector(selector)
    if (!node) return null
    const css = getComputedStyle(node)
    const tag = node.tagName.toLowerCase()
    const role = node.getAttribute("role") ?? (tag === "a" ? "link" : tag === "button" ? "button" : "")
    const text = node instanceof HTMLInputElement ? node.value : (node.textContent ?? "")
    const attrs = Object.fromEntries(Array.from(node.attributes).map((attr) => [attr.name, attr.value]))

    let cur: Element | null = node
    const chain: string[] = []
    while (cur && chain.length < 10) {
      const sib = cur.parentElement
      const all = sib ? Array.from(sib.children).filter((item) => item.tagName === cur?.tagName) : []
      const idx = all.length > 1 ? `[${all.indexOf(cur) + 1}]` : ""
      chain.unshift(`${cur.tagName.toLowerCase()}${idx}`)
      cur = cur.parentElement
    }

    return {
      selector,
      xpath: `//${chain.join("/")}`,
      tag,
      text,
      attributes: attrs,
      accessibility: {
        role,
        name:
          node.getAttribute("aria-label") ??
          node.getAttribute("title") ??
          (node instanceof HTMLImageElement ? node.alt : "") ??
          text,
        live: node.getAttribute("aria-live") ?? "",
      },
      styles: {
        display: css.display,
        position: css.position,
        color: css.color,
        backgroundColor: css.backgroundColor,
        fontSize: css.fontSize,
        fontWeight: css.fontWeight,
        lineHeight: css.lineHeight,
        borderRadius: css.borderRadius,
      },
    }
  }, selector)
}

export async function pick(page: Page, custom?: string[], max = 30) {
  const list = await selectors(page, custom, max)
  const all = await Promise.all(
    list.map(async (selector) => {
      const base = await info(page, selector)
      if (!base) return null
      const rect = await box(page, selector)
      if (!rect) return null
      const item: Elem = {
        ...base,
        text: clean(base.text),
        box: rect,
      }
      return item
    }),
  )
  return all.filter((item): item is Elem => Boolean(item))
}
