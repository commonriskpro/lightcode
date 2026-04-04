import type { Change } from "./annotate-types"
import { shot } from "./browser"
import type { Page } from "puppeteer"

const STYLE = [
  "display",
  "position",
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
] as const

type Mutation = {
  type: string
  selector: string
  attribute: string
}

export async function watch(page: Page) {
  await page.evaluate(() => {
    const to = (node: Node | null): string => {
      if (!(node instanceof Element)) return ""
      if (node.id) return `#${node.id}`

      let cur: Element | null = node
      const out: string[] = []
      while (cur && out.length < 8) {
        const tag = cur.tagName.toLowerCase()
        const parent = cur.parentElement
        const all = parent ? Array.from(parent.children).filter((x) => x.tagName === cur?.tagName) : []
        const idx = all.length > 1 ? `:nth-of-type(${all.indexOf(cur) + 1})` : ""
        out.unshift(`${tag}${idx}`)
        cur = cur.parentElement
      }
      return out.join(" > ")
    }

    const list: Mutation[] = []
    const obs = new MutationObserver((items) => {
      for (const item of items) {
        list.push({
          type: item.type,
          selector: to(item.target),
          attribute: item.attributeName ?? "",
        })
      }
    })

    obs.observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
      attributeOldValue: true,
    })
    ;(window as { __annotate_obs?: MutationObserver }).__annotate_obs = obs
    ;(window as { __annotate_mut?: Mutation[] }).__annotate_mut = list
  })
}

export async function stop(page: Page) {
  return page.evaluate(() => {
    const win = window as { __annotate_obs?: MutationObserver; __annotate_mut?: Mutation[] }
    win.__annotate_obs?.disconnect()
    return win.__annotate_mut ?? []
  })
}

export async function styles(page: Page, selectors: string[]) {
  return page.evaluate(
    (arg: { selectors: string[]; keys: string[] }) => {
      const selectors = arg.selectors
      const keys = arg.keys
      const out: Record<string, Record<string, string>> = {}
      for (const selector of selectors) {
        const el = document.querySelector(selector)
        if (!el) continue
        const css = getComputedStyle(el)
        const row: Record<string, string> = {}
        for (const key of keys)
          row[key] = css.getPropertyValue(key) || (css as unknown as Record<string, string>)[key] || ""
        out[selector] = row
      }
      return out
    },
    {
      selectors,
      keys: [...STYLE],
    },
  )
}

export function diff(before: Record<string, Record<string, string>>, after: Record<string, Record<string, string>>) {
  const set = new Set<string>([...Object.keys(before), ...Object.keys(after)])
  const out: Change[] = []
  for (const selector of set) {
    const a = before[selector] ?? {}
    const b = after[selector] ?? {}
    const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)])
    for (const key of keys) {
      const prev = a[key] ?? ""
      const next = b[key] ?? ""
      if (prev === next) continue
      out.push({ selector, property: key, before: prev, after: next })
    }
  }
  return out
}

export async function take(page: Page, selectors: string[]) {
  const [screenshot, map] = await Promise.all([shot(page, true, "png"), styles(page, selectors)])
  return { screenshot, styles: map }
}
