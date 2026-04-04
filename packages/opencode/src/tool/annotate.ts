import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./annotate.txt"
import { close, closeBrowser, crop, open, shot, validateUrl } from "./browser"
import { diff, stop, styles, take, watch } from "./etch"
import { pick } from "./picker"
import type { AnnotationResult, EtchResult, Mark, StoredPick } from "./annotate-types"
import type { Page } from "puppeteer"

const schema = z.object({
  action: z.enum(["once", "start", "complete", "cancel"]).default("once").describe("Session control action"),
  url: z.string().optional().describe("URL to annotate or open"),
  mode: z.enum(["picker", "etch"]).default("picker").describe("Annotation mode"),
  selectors: z.array(z.string()).optional().describe("Optional selector list to inspect"),
  track: z.array(z.string()).optional().describe("Selector list for style tracking in etch mode"),
  notes: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional()
    .describe("Map selector -> note text or note array"),
  elementScreenshots: z.boolean().default(false).describe("Include per-element screenshot crops"),
  headed: z.boolean().default(true).describe("Open a visible browser window"),
  fullPage: z.boolean().default(true).describe("Capture full-page screenshot"),
  max: z.coerce.number().int().min(1).max(200).default(30).describe("Max elements in picker mode"),
  wait: z.coerce.number().int().min(0).max(60000).default(1500).describe("Wait time in ms before etch after-capture"),
  script: z.string().optional().describe("Optional JavaScript run in page before after-capture"),
  closeOnComplete: z.boolean().default(true).describe("Close live browser session on complete"),
})

// Per-URL annotation store: survives navigation between pages in a session
// Stores full element snapshots so /annotate-complete works cross-page
const store = new Map<string, StoredPick[]>()
let seq = 1

let live: { page: Page; started: number; mode: "picker" | "etch"; etchSelectors?: string[] } | undefined

function meta(input: { status?: string; mode?: string; url?: string; count?: number; session_ms?: number }) {
  return {
    status: input.status,
    mode: input.mode,
    url: input.url,
    count: input.count,
    session_ms: input.session_ms,
  }
}

function notes(value: z.infer<typeof schema>["notes"], selector: string) {
  const raw = value?.[selector]
  if (!raw) return []
  if (typeof raw === "string") return [raw]
  return raw
}

function normalize(url: string) {
  if (/^https?:\/\//i.test(url)) return url
  // If already has some scheme (non-http), leave it — validateUrl will reject it
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(url)) return url
  return `https://${url}`
}

function unique(list: string[]) {
  return [...new Set(list)]
}

export function urlKey(raw: string) {
  try {
    const u = new URL(raw)
    return `${u.origin}${u.pathname}`
  } catch {
    return raw
  }
}

async function save(page: Page, knownUrl?: string) {
  try {
    const pageUrl = knownUrl ?? page.url()
    const key = urlKey(pageUrl)
    const raw = await page.evaluate(() => {
      const win = window as {
        __annotate_state?: { elements: { id: number; selector: string; note: string; ts: number }[] }
      }
      return win.__annotate_state?.elements ?? []
    })
    // Resolve element snapshots for selectors on the current page
    const items: StoredPick[] = await Promise.all(
      raw.map(async (item) => {
        if (store.has(key)) {
          const prev = store.get(key)!.find((p) => p.id === item.id)
          if (prev?.element) {
            // Update note only — preserve snapshot
            return { ...prev, note: item.note }
          }
        }
        // Resolve fresh element snapshot
        const elem = await (async () => {
          try {
            const list = await pick(page, [item.selector], 1)
            return list[0] ?? undefined
          } catch {
            return undefined
          }
        })()
        return { ...item, url: pageUrl, element: elem }
      }),
    )
    store.set(key, items)
    if (items.length) {
      const max = Math.max(0, ...items.map((x) => x.id))
      if (max >= seq) seq = max + 1
    }
  } catch {
    // page may be closed or mid-navigation
  }
}

async function install(page: Page) {
  const key = urlKey(page.url())
  const saved = store.get(key) ?? []
  const boot = (arg: { initial: { id: number; selector: string; note: string; ts: number }[]; startSeq: number }) => {
    const win = window as {
      __annotate_boot?: boolean
      __annotate_state?: {
        on: boolean
        seq: number
        elements: { id: number; selector: string; note: string; ts: number }[]
      }
      __annotate_cleanup?: () => void
    }
    win.__annotate_cleanup?.()
    win.__annotate_boot = true
    // Restore persisted annotations for this URL (passed from Node context via arg)
    win.__annotate_state = {
      on: true,
      seq: arg.startSeq,
      elements: arg.initial.slice(),
    }

    const state = win.__annotate_state
    const esc = (v: string) => (globalThis.CSS && CSS.escape ? CSS.escape(v) : v)
    const sel = (el: Element) => {
      if (el.id) return `#${esc(el.id)}`
      let cur: Element | null = el
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

    const panel = document.createElement("div")
    panel.style.position = "fixed"
    panel.style.top = "12px"
    panel.style.right = "12px"
    panel.style.zIndex = "2147483647"
    panel.style.background = "rgba(17,24,39,.95)"
    panel.style.color = "#fff"
    panel.style.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace"
    panel.style.padding = "8px 10px"
    panel.style.borderRadius = "8px"
    panel.style.boxShadow = "0 8px 24px rgba(0,0,0,.25)"
    panel.style.maxWidth = "360px"
    panel.style.pointerEvents = "auto"
    panel.style.width = "320px"
    panel.style.userSelect = "none"
    panel.style.cursor = "default"
    for (const ev of ["click", "mousedown", "mouseup", "pointerdown", "pointerup"] as const) {
      panel.addEventListener(ev, (e) => e.stopPropagation(), false)
    }

    const head = document.createElement("div")
    head.style.display = "flex"
    head.style.alignItems = "center"
    head.style.justifyContent = "space-between"
    head.style.gap = "8px"
    head.style.userSelect = "none"

    let collapsed = false

    const label = document.createElement("strong")
    label.textContent = "Visual Picker"
    label.style.fontSize = "12px"
    label.style.display = "flex"
    label.style.alignItems = "center"
    label.style.gap = "5px"

    const chevron = document.createElement("span")
    chevron.textContent = "▾"
    chevron.style.fontSize = "10px"
    chevron.style.lineHeight = "1"
    chevron.style.transition = "transform .15s"
    label.prepend(chevron)

    const tools = document.createElement("div")
    tools.style.display = "flex"
    tools.style.gap = "6px"

    const clear = document.createElement("button")
    clear.textContent = "Clear"
    clear.style.font = "inherit"
    clear.style.fontSize = "11px"
    clear.style.padding = "2px 6px"
    clear.style.borderRadius = "6px"
    clear.style.border = "1px solid rgba(255,255,255,.25)"
    clear.style.background = "rgba(255,255,255,.08)"
    clear.style.color = "#fff"
    clear.style.cursor = "pointer"
    clear.type = "button"
    clear.onclick = () => {
      for (const item of state.elements) {
        const target = document.querySelector(item.selector)
        if (target instanceof HTMLElement) target.style.outline = ""
      }
      state.elements = []
      draw()
    }

    tools.appendChild(clear)
    head.appendChild(label)
    head.appendChild(tools)

    const body = document.createElement("div")
    body.style.overflow = "hidden"
    body.style.transition = "max-height .2s ease, opacity .15s"
    body.style.maxHeight = "600px"
    body.style.opacity = "1"

    const status = document.createElement("div")
    status.style.marginTop = "6px"
    status.style.opacity = ".8"
    status.style.fontSize = "11px"

    const cards = document.createElement("div")
    cards.style.marginTop = "8px"
    cards.style.display = "grid"
    cards.style.gap = "6px"
    cards.style.maxHeight = "320px"
    cards.style.overflow = "auto"

    body.appendChild(status)
    body.appendChild(cards)

    panel.appendChild(head)
    panel.appendChild(body)

    const toggleCollapse = () => {
      collapsed = !collapsed
      if (collapsed) {
        body.style.maxHeight = "0"
        body.style.opacity = "0"
        chevron.style.transform = "rotate(-90deg)"
      } else {
        body.style.maxHeight = "600px"
        body.style.opacity = "1"
        chevron.style.transform = ""
      }
    }

    head.style.cursor = "pointer"
    head.addEventListener("click", (ev) => {
      const target = ev.target as Element
      if (target.tagName === "BUTTON") return
      toggleCollapse()
    })

    const hover = document.createElement("div")
    hover.style.position = "fixed"
    hover.style.zIndex = "2147483646"
    hover.style.pointerEvents = "none"
    hover.style.border = "2px dashed #f59e0b"
    hover.style.borderRadius = "4px"
    hover.style.display = "none"

    const badges = document.createElement("div")
    badges.style.position = "fixed"
    badges.style.inset = "0"
    badges.style.pointerEvents = "none"
    badges.style.zIndex = "2147483645"

    const links = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    links.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`)
    links.setAttribute("width", `${window.innerWidth}`)
    links.setAttribute("height", `${window.innerHeight}`)
    links.style.position = "fixed"
    links.style.inset = "0"
    links.style.pointerEvents = "none"
    links.style.zIndex = "2147483644"

    const marks = new Map<number, HTMLButtonElement>()
    const paths = new Map<number, SVGPathElement>()
    const root = document.createElement("div")
    root.style.position = "absolute"
    root.style.top = "0"
    root.style.left = "0"
    root.style.width = "0"
    root.style.height = "0"
    root.style.overflow = "visible"
    root.style.pointerEvents = "none"
    root.style.zIndex = "2147483647"
    root.setAttribute("data-annotate-root", "1")
    let obs: MutationObserver | undefined

    const note = document.createElement("div")
    note.style.position = "fixed"
    note.style.zIndex = "2147483647"
    note.style.display = "none"
    note.style.width = "280px"
    note.style.background = "rgba(17,24,39,.98)"
    note.style.border = "1px solid rgba(255,255,255,.18)"
    note.style.borderRadius = "8px"
    note.style.padding = "8px"
    note.style.boxShadow = "0 10px 28px rgba(0,0,0,.35)"
    note.style.pointerEvents = "auto"
    // Stop all events from leaking through to the page underneath
    for (const ev of ["click", "mousedown", "mouseup", "pointerdown", "pointerup"] as const) {
      note.addEventListener(ev, (e) => e.stopPropagation(), false)
    }

    const noteTitle = document.createElement("div")
    noteTitle.style.fontSize = "11px"
    noteTitle.style.opacity = ".85"
    noteTitle.style.marginBottom = "6px"
    noteTitle.style.userSelect = "none"

    const noteInput = document.createElement("textarea")
    noteInput.placeholder = "What should change?"
    noteInput.style.width = "100%"
    noteInput.style.minHeight = "80px"
    noteInput.style.maxHeight = "180px"
    noteInput.style.resize = "vertical"
    noteInput.style.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace"
    noteInput.style.color = "#fff"
    noteInput.style.background = "rgba(0,0,0,.25)"
    noteInput.style.border = "1px solid rgba(255,255,255,.15)"
    noteInput.style.borderRadius = "6px"
    noteInput.style.padding = "6px"

    const noteActions = document.createElement("div")
    noteActions.style.display = "flex"
    noteActions.style.justifyContent = "flex-end"
    noteActions.style.gap = "6px"
    noteActions.style.marginTop = "6px"

    const noteCancel = document.createElement("button")
    noteCancel.type = "button"
    noteCancel.textContent = "Cancel"
    noteCancel.style.font = "inherit"
    noteCancel.style.fontSize = "11px"
    noteCancel.style.padding = "2px 8px"
    noteCancel.style.borderRadius = "6px"
    noteCancel.style.border = "1px solid rgba(255,255,255,.2)"
    noteCancel.style.background = "rgba(255,255,255,.06)"
    noteCancel.style.color = "#fff"
    noteCancel.style.cursor = "pointer"

    const noteSave = document.createElement("button")
    noteSave.type = "button"
    noteSave.textContent = "Save"
    noteSave.style.font = "inherit"
    noteSave.style.fontSize = "11px"
    noteSave.style.padding = "2px 8px"
    noteSave.style.borderRadius = "6px"
    noteSave.style.border = "1px solid rgba(16,185,129,.45)"
    noteSave.style.background = "rgba(16,185,129,.25)"
    noteSave.style.color = "#fff"
    noteSave.style.cursor = "pointer"

    noteActions.appendChild(noteCancel)
    noteActions.appendChild(noteSave)
    note.appendChild(noteTitle)
    note.appendChild(noteInput)
    note.appendChild(noteActions)

    const makeDraggable = (el: HTMLElement, handle: HTMLElement) => {
      let startX = 0
      let startY = 0
      let origX = 0
      let origY = 0
      let dragging = false

      handle.style.cursor = "grab"

      const onDown = (ev: MouseEvent) => {
        if (ev.button !== 0) return
        const target = ev.target as Element
        if (target.tagName === "BUTTON" || target.tagName === "TEXTAREA" || target.tagName === "INPUT") return
        dragging = true
        startX = ev.clientX
        startY = ev.clientY
        origX = Number.parseInt(el.style.left || "0", 10) || el.getBoundingClientRect().left
        origY = Number.parseInt(el.style.top || "0", 10) || el.getBoundingClientRect().top
        el.style.left = `${origX}px`
        el.style.top = `${origY}px`
        el.style.right = "auto"
        handle.style.cursor = "grabbing"
        document.addEventListener("mousemove", onMove, true)
        document.addEventListener("mouseup", onUp, true)
        ev.preventDefault()
        ev.stopPropagation()
      }

      const onMove = (ev: MouseEvent) => {
        if (!dragging) return
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        const nx = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, origX + dx))
        const ny = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, origY + dy))
        el.style.left = `${nx}px`
        el.style.top = `${ny}px`
        ev.preventDefault()
        ev.stopPropagation()
      }

      const onUp = (ev: MouseEvent) => {
        if (!dragging) return
        dragging = false
        handle.style.cursor = "grab"
        document.removeEventListener("mousemove", onMove, true)
        document.removeEventListener("mouseup", onUp, true)
        ev.preventDefault()
        ev.stopPropagation()
      }

      handle.addEventListener("mousedown", onDown, true)
      return () => handle.removeEventListener("mousedown", onDown, true)
    }

    let active = 0

    const hideNote = () => {
      note.style.display = "none"
      active = 0
    }

    const openNote = (id: number, x: number, y: number) => {
      const item = state.elements.find((v) => v.id === id)
      if (!item) return
      active = id
      noteTitle.textContent = `#${item.id} ${item.selector}`
      noteInput.value = item.note
      note.style.display = "block"
      const maxX = Math.max(8, window.innerWidth - 296)
      const maxY = Math.max(8, window.innerHeight - 220)
      note.style.left = `${Math.max(8, Math.min(maxX, x))}px`
      note.style.top = `${Math.max(8, Math.min(maxY, y))}px`
      noteInput.focus()
      noteInput.setSelectionRange(noteInput.value.length, noteInput.value.length)
    }

    const saveNote = () => {
      if (!active) return
      const idx = state.elements.findIndex((v) => v.id === active)
      if (idx === -1) return
      state.elements[idx].note = noteInput.value
      const row = cards.querySelector(`[data-id=\"${active}\"] textarea`) as HTMLTextAreaElement | null
      if (row) row.value = noteInput.value
      hideNote()
    }

    // Make both panel and note draggable by their header/title bar
    makeDraggable(panel, head)
    makeDraggable(note, noteTitle)

    noteCancel.onclick = hideNote
    noteSave.onclick = saveNote
    noteInput.onkeydown = (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
        ev.preventDefault()
        saveNote()
      }
      if (ev.key === "Escape") {
        ev.preventDefault()
        hideNote()
      }
    }

    const makeBadge = (id: number) => {
      const node = document.createElement("button")
      node.type = "button"
      node.textContent = String(id)
      node.style.position = "fixed"
      node.style.minWidth = "22px"
      node.style.height = "22px"
      node.style.padding = "0 6px"
      node.style.borderRadius = "999px"
      node.style.border = "1px solid rgba(255,255,255,.4)"
      node.style.background = "#ef4444"
      node.style.color = "#fff"
      node.style.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace"
      node.style.fontWeight = "700"
      node.style.boxShadow = "0 4px 12px rgba(0,0,0,.28)"
      node.style.pointerEvents = "auto"
      node.style.cursor = "pointer"
      node.onclick = () => {
        const item = state.elements.find((x) => x.id === id)
        if (!item) return
        const row = cards.querySelector(`[data-id=\"${id}\"]`) as HTMLDivElement | null
        if (row) row.scrollIntoView({ block: "center", behavior: "smooth" })
        const target = document.querySelector(item.selector)
        if (target) target.scrollIntoView({ block: "center", behavior: "smooth" })
        openNote(id, 20, 20)
      }
      return node
    }

    const draw = () => {
      status.textContent = `Annotate ${state.on ? "ON" : "OFF"} | picks: ${state.elements.length} | Shift+click remove | Ctrl/Cmd+Shift+P toggle`
      cards.innerHTML = ""
      for (const item of state.elements) {
        const row = document.createElement("div")
        row.dataset.id = String(item.id)
        row.style.border = "1px solid rgba(255,255,255,.15)"
        row.style.borderRadius = "8px"
        row.style.padding = "6px"
        row.style.background = "rgba(255,255,255,.04)"

        const title = document.createElement("div")
        title.textContent = `#${item.id} ${item.selector}`
        title.style.fontSize = "11px"
        title.style.whiteSpace = "nowrap"
        title.style.overflow = "hidden"
        title.style.textOverflow = "ellipsis"

        const input = document.createElement("textarea")
        input.value = item.note
        input.placeholder = "What should change?"
        input.style.marginTop = "6px"
        input.style.width = "100%"
        input.style.minHeight = "56px"
        input.style.maxHeight = "120px"
        input.style.resize = "vertical"
        input.style.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace"
        input.style.color = "#fff"
        input.style.background = "rgba(0,0,0,.25)"
        input.style.border = "1px solid rgba(255,255,255,.15)"
        input.style.borderRadius = "6px"
        input.style.padding = "6px"
        input.oninput = () => {
          const idx = state.elements.findIndex((x) => x.id === item.id)
          if (idx === -1) return
          state.elements[idx].note = input.value
        }

        const del = document.createElement("button")
        del.type = "button"
        del.textContent = "Remove"
        del.style.marginTop = "6px"
        del.style.font = "inherit"
        del.style.fontSize = "11px"
        del.style.padding = "2px 6px"
        del.style.borderRadius = "6px"
        del.style.border = "1px solid rgba(255,255,255,.2)"
        del.style.background = "rgba(239,68,68,.2)"
        del.style.color = "#fff"
        del.style.cursor = "pointer"
        del.onclick = () => {
          const target = document.querySelector(item.selector)
          if (target instanceof HTMLElement) target.style.outline = ""
          state.elements = state.elements.filter((x) => x.id !== item.id)
          draw()
        }

        row.appendChild(title)
        row.appendChild(input)
        row.appendChild(del)
        cards.appendChild(row)
      }
      move()
    }

    const move = () => {
      links.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`)
      links.setAttribute("width", `${window.innerWidth}`)
      links.setAttribute("height", `${window.innerHeight}`)
      const keep = new Set<number>()
      const keepPath = new Set<number>()
      for (const item of state.elements) {
        const target = document.querySelector(item.selector)
        if (!target) continue
        const rect = target.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) continue
        let node = marks.get(item.id)
        if (!node) {
          node = makeBadge(item.id)
          marks.set(item.id, node)
          badges.appendChild(node)
        }
        node.style.display = "block"
        node.style.left = `${Math.max(8, rect.left + rect.width - 12)}px`
        node.style.top = `${Math.max(8, rect.top - 10)}px`
        keep.add(item.id)

        const row = cards.querySelector(`[data-id="${item.id}"]`) as HTMLDivElement | null
        if (!row) continue
        const body = row.getBoundingClientRect()
        let line = paths.get(item.id)
        if (!line) {
          line = document.createElementNS("http://www.w3.org/2000/svg", "path")
          line.setAttribute("stroke", "rgba(245,158,11,.85)")
          line.setAttribute("stroke-width", "1.5")
          line.setAttribute("fill", "none")
          line.setAttribute("stroke-dasharray", "4 4")
          paths.set(item.id, line)
          links.appendChild(line)
        }
        const x1 = rect.left + rect.width
        const y1 = rect.top + Math.min(rect.height / 2, 24)
        const x2 = body.left
        const y2 = body.top + Math.min(body.height / 2, 24)
        const curve = Math.max(24, Math.abs(x2 - x1) / 3)
        line.setAttribute("d", `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`)
        keepPath.add(item.id)
      }
      for (const [id, node] of marks) {
        if (keep.has(id)) continue
        node.remove()
        marks.delete(id)
      }
      for (const [id, line] of paths) {
        if (keepPath.has(id)) continue
        line.remove()
        paths.delete(id)
      }
    }

    const mount = () => {
      if (!document.documentElement) {
        requestAnimationFrame(mount)
        return
      }
      if (!root.isConnected) {
        const target = document.body ?? document.documentElement
        target.appendChild(root)
      }
      if (!links.isConnected) root.appendChild(links)
      if (!hover.isConnected) root.appendChild(hover)
      if (!badges.isConnected) root.appendChild(badges)
      if (!panel.isConnected) root.appendChild(panel)
      if (!note.isConnected) root.appendChild(note)
      draw()
    }
    mount()

    obs = new MutationObserver(() => {
      if (root.isConnected) return
      const target = document.body ?? document.documentElement
      if (target) target.appendChild(root)
    })
    obs.observe(document.documentElement, { childList: true, subtree: false })

    const tick = window.setInterval(() => {
      if (!root.isConnected) {
        const target = document.body ?? document.documentElement
        if (target) target.appendChild(root)
      }
      document.documentElement.style.cursor = state.on ? "crosshair" : "default"
      move()
      status.textContent = `Annotate ${state.on ? "ON" : "OFF"} | picks: ${state.elements.length} | Shift+click remove | Ctrl/Cmd+Shift+P toggle`
    }, 250)

    const onMove = (ev: MouseEvent) => {
      if (!state.on) {
        hover.style.display = "none"
        return
      }
      const node = ev.target
      if (!(node instanceof Element)) {
        hover.style.display = "none"
        return
      }
      if (root.contains(node)) {
        hover.style.display = "none"
        return
      }
      const rect = node.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        hover.style.display = "none"
        return
      }
      hover.style.display = "block"
      hover.style.left = `${rect.left}px`
      hover.style.top = `${rect.top}px`
      hover.style.width = `${rect.width}px`
      hover.style.height = `${rect.height}px`
    }

    const onClick = (ev: MouseEvent) => {
      if (!state.on) return
      const node = ev.target
      if (!(node instanceof Element)) return
      if (root.contains(node)) return
      // Also guard by attribute in case node is inside a detached root copy
      if ((node as Element).closest?.("[data-annotate-root]")) return
      ev.preventDefault()
      ev.stopPropagation()
      const selector = sel(node)
      if (!selector) return
      const found = state.elements.find((x) => x.selector === selector)
      if (found) {
        if (ev.shiftKey) {
          const target = document.querySelector(found.selector)
          if (target instanceof HTMLElement) target.style.outline = ""
          state.elements = state.elements.filter((x) => x.id !== found.id)
          draw()
          return
        }
        const row = cards.querySelector(`[data-id=\"${found.id}\"]`) as HTMLDivElement | null
        if (row) row.scrollIntoView({ block: "center", behavior: "smooth" })
        openNote(found.id, ev.clientX + 12, ev.clientY + 12)
        return
      }
      // Final safety: never mark overlay nodes as picks
      if (node.hasAttribute?.("data-annotate-root") || node.closest?.("[data-annotate-root]")) return
      node.setAttribute("data-annotate-picked", "1")
      ;(node as HTMLElement).style.outline = "2px solid #ef4444"
      const id = state.seq++
      state.elements.push({ id, selector, note: "", ts: Date.now() })
      draw()
      openNote(id, ev.clientX + 12, ev.clientY + 12)
      if (!ev.shiftKey) {
        const row = cards.querySelector(`[data-id=\"${id}\"]`) as HTMLDivElement | null
        if (row) row.scrollIntoView({ block: "center", behavior: "smooth" })
      }
    }

    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key.toLowerCase() === "p") {
        state.on = !state.on
      }
      if (ev.key === "Escape") state.on = false
      if (ev.key === "Escape") hideNote()
    }

    document.addEventListener("click", onClick, true)
    document.addEventListener("mousemove", onMove, true)
    window.addEventListener("scroll", move, true)
    window.addEventListener("resize", move)
    document.addEventListener("keydown", onKey, true)

    win.__annotate_cleanup = () => {
      for (const item of state.elements) {
        const target = document.querySelector(item.selector)
        if (target instanceof HTMLElement) target.style.outline = ""
      }
      window.clearInterval(tick)
      document.documentElement.style.cursor = ""
      hideNote()
      obs?.disconnect()
      obs = undefined
      root.remove()
      document.removeEventListener("click", onClick, true)
      document.removeEventListener("mousemove", onMove, true)
      window.removeEventListener("scroll", move, true)
      window.removeEventListener("resize", move)
      document.removeEventListener("keydown", onKey, true)
      win.__annotate_boot = false
    }
  }

  await page.evaluate(boot, { initial: saved, startSeq: seq })
}

async function collect(page: Page, args: z.infer<typeof schema>) {
  const raw = await page.evaluate(() => {
    const win = window as {
      __annotate_state?: { on: boolean; elements: { id: number; selector: string; note: string; ts: number }[] }
    }
    return {
      url: location.href,
      title: document.title,
      picks: win.__annotate_state?.elements ?? [],
    }
  })

  // Merge current-page picks into store (note updates only — snapshots were resolved at save time)
  const curKey = urlKey(raw.url)
  const curStored = store.get(curKey) ?? []
  const merged: StoredPick[] = raw.picks.map((p) => {
    const prev = curStored.find((s) => s.id === p.id)
    return prev ? { ...prev, note: p.note } : { ...p, url: raw.url }
  })
  store.set(curKey, merged)

  // Flatten all picks from all visited pages — use stored element snapshots cross-page
  const allPicks = [...store.values()].flat()
  const currentKey = urlKey(raw.url)

  const marks: Mark[] = []
  for (const item of allPicks) {
    const noteList = [item.note, ...notes(args.notes, item.selector)].filter(Boolean)
    if (item.element) {
      // Snapshot was captured at pick time — use it directly
      marks.push({ element: item.element, notes: noteList })
      continue
    }
    // Fallback: re-query only if on current page
    if (urlKey(item.url ?? "") !== currentKey) continue
    const list = await pick(page, [item.selector], 1)
    if (list[0]) marks.push({ element: list[0], notes: noteList })
  }

  if (args.elementScreenshots) {
    const onCurrent = marks.filter((m) => {
      const stored = allPicks.find((p) => p.selector === m.element.selector)
      return !stored?.url || urlKey(stored.url) === currentKey
    })
    const all = await Promise.allSettled(onCurrent.map((m) => crop(page, m.element.selector)))
    for (const [i, item] of all.entries()) {
      if (item.status !== "fulfilled" || !item.value) continue
      const idx = marks.indexOf(onCurrent[i])
      if (idx !== -1) marks[idx] = { ...marks[idx], screenshot: item.value }
    }
  }

  const screenshot = await shot(page, args.fullPage, "png")
  const out: AnnotationResult = {
    type: "annotation",
    url: raw.url,
    title: raw.title,
    timestamp: Date.now(),
    mode: "picker",
    screenshot,
    elements: marks,
  }
  return out
}

async function handlePicker(page: Awaited<ReturnType<typeof open>>, args: z.infer<typeof schema>) {
  const list = await pick(page, args.selectors, args.max)
  const marks: Mark[] = list.map((item) => ({
    element: item,
    notes: notes(args.notes, item.selector),
  }))

  if (args.elementScreenshots) {
    const all = await Promise.allSettled(marks.map((item) => crop(page, item.element.selector)))
    for (const [i, item] of all.entries()) {
      if (item.status !== "fulfilled") continue
      if (!item.value) continue
      marks[i] = {
        ...marks[i],
        screenshot: item.value,
      }
    }
  }

  const [title, screenshot] = await Promise.all([page.title(), shot(page, args.fullPage, "png")])
  const result: AnnotationResult = {
    type: "annotation",
    url: page.url(),
    title,
    timestamp: Date.now(),
    mode: "picker",
    screenshot,
    elements: marks,
  }
  return result
}

async function runScript(page: Awaited<ReturnType<typeof open>>, code: string) {
  await page.evaluate((code: string) => {
    const fn = new Function(code)
    fn()
  }, code)
}

async function handleEtch(page: Awaited<ReturnType<typeof open>>, args: z.infer<typeof schema>) {
  const base = await pick(page, args.track ?? args.selectors, 20)
  const target = base.map((item) => item.selector)
  await watch(page)
  const before = await take(page, target)

  if (args.script) await runScript(page, args.script)
  if (args.wait > 0) await Bun.sleep(args.wait)

  const [afterShot, afterStyles, mutations, title] = await Promise.all([
    shot(page, true, "png"),
    styles(page, target),
    stop(page),
    page.title(),
  ])

  const result: EtchResult = {
    type: "etch",
    url: page.url(),
    title,
    timestamp: Date.now(),
    mode: "etch",
    before,
    after: {
      screenshot: afterShot,
      styles: afterStyles,
    },
    changes: diff(before.styles, afterStyles),
    mutations,
  }
  return result
}

export const AnnotateTool = Tool.define("annotate", {
  description: DESCRIPTION,
  parameters: schema,
  async execute(input, ctx) {
    const url = input.url ? normalize(input.url) : undefined
    const args: z.infer<typeof schema> = {
      ...input,
      url,
    }

    if (args.action === "cancel") {
      if (!live) {
        return {
          title: "annotate:cancel",
          output: JSON.stringify({ status: "idle" }, null, 2),
          metadata: meta({ status: "idle" }),
        }
      }
      await close(live.page)
      await closeBrowser()
      live = undefined
      store.clear()
      seq = 1
      return {
        title: "annotate:cancel",
        output: JSON.stringify({ status: "cancelled" }, null, 2),
        metadata: meta({ status: "cancelled" }),
      }
    }

    if (args.action === "start") {
      if (url) {
        await ctx.ask({
          permission: "webfetch",
          patterns: [url],
          always: ["*"],
          metadata: {
            mode: args.mode,
          },
        })
      }
      if (live) await close(live.page)
      const page = await open(url ?? "about:blank", 30_000, { headless: !args.headed })
      await install(page)

      // Track previous URL so we can key the save correctly before navigation commits
      let prevUrl = page.url()
      page.on("request", (req) => {
        if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
          prevUrl = page.url()
        }
      })
      page.on("framenavigated", async (frame) => {
        if (frame !== page.mainFrame()) return
        try {
          // Save using the captured pre-navigation URL
          await save(page, prevUrl)
          prevUrl = page.url()
          await install(page)
        } catch {
          // page may be mid-navigation, ignore
        }
      })

      live = {
        page,
        started: Date.now(),
        mode: args.mode,
        etchSelectors: args.track ?? args.selectors,
      }

      // For etch mode: start watching mutations immediately
      if (args.mode === "etch") {
        await watch(page)
      }
      return {
        title: "annotate:start",
        output: JSON.stringify(
          {
            status: "started",
            url: page.url(),
            hint: "Navigate freely, click elements to annotate, then run annotate with action=complete",
          },
          null,
          2,
        ),
        metadata: {
          ...meta({ status: "started", url: page.url() }),
        },
      }
    }

    if (args.action === "complete") {
      if (!live) throw new Error("No live annotate session. Start with action=start first.")
      const duration = Date.now() - live.started

      if (live.mode === "etch") {
        const target = live.etchSelectors?.length
          ? live.etchSelectors
          : (await pick(live.page, undefined, 20)).map((e) => e.selector)
        const [afterShot, afterStyles, mutations, title] = await Promise.all([
          shot(live.page, true, "png"),
          styles(live.page, target),
          stop(live.page),
          live.page.title(),
        ])
        // before snapshot was taken at watch() time — reconstruct via styles diff
        const before = await take(live.page, target).catch(() => ({
          screenshot: afterShot,
          styles: Object.fromEntries(target.map((s) => [s, {} as Record<string, string>])),
        }))
        const result: EtchResult = {
          type: "etch",
          url: live.page.url(),
          title,
          timestamp: Date.now(),
          mode: "etch",
          before,
          after: { screenshot: afterShot, styles: afterStyles },
          changes: diff(before.styles, afterStyles),
          mutations,
        }
        if (args.closeOnComplete) {
          await close(live.page)
          await closeBrowser()
          live = undefined
          store.clear()
          seq = 1
        }
        return {
          title: `annotate:complete:etch:${result.url}`,
          output: JSON.stringify(result, null, 2),
          metadata: meta({ mode: "etch", url: result.url, count: result.changes.length, session_ms: duration }),
        }
      }

      await save(live.page)
      const out = await collect(live.page, args)
      if (args.closeOnComplete) {
        await close(live.page)
        await closeBrowser()
        live = undefined
        store.clear()
        seq = 1
      }
      return {
        title: `annotate:complete:${out.url}`,
        output: JSON.stringify(out, null, 2),
        metadata: meta({
          mode: "picker",
          url: out.url,
          count: out.elements.length,
          session_ms: duration,
        }),
      }
    }

    if (!url) throw new Error("url is required when action=once")
    validateUrl(url)

    await ctx.ask({
      permission: "webfetch",
      patterns: [url],
      always: ["*"],
      metadata: {
        mode: args.mode,
        selectors: args.selectors,
      },
    })

    const page = await open(url, 30_000, { headless: !args.headed })
    try {
      const out = args.mode === "etch" ? await handleEtch(page, args) : await handlePicker(page, args)
      return {
        title: `${out.mode}:${out.url}`,
        output: JSON.stringify(out, null, 2),
        metadata: meta({
          mode: out.mode,
          url: out.url,
          count: out.type === "annotation" ? out.elements.length : out.changes.length,
        }),
      }
    } finally {
      await close(page)
      await closeBrowser()
    }
  },
})
