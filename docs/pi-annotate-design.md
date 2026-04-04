# pi-annotate Technical Design

> Detailed technical design for visual UI annotation tool.

---

## 1. Overview

**Change**: Add `/annotate` command for visual web page inspection  
**Approach**: Puppeteer-based native tool  
**Location**: `packages/opencode/src/tool/`

---

## 2. Technology Stack

| Component | Technology               | Version           | Rationale                          |
| --------- | ------------------------ | ----------------- | ---------------------------------- |
| Browser   | Puppeteer                | ^24.0.0           | Chrome CDP access, bundled browser |
| CDP       | Chrome DevTools Protocol | (via Puppeteer)   | DOM inspection, box model          |
| Language  | TypeScript               | (project default) | Type safety                        |
| Storage   | JSON                     | -                 | Annotation persistence             |

---

## 3. File Structure

```
packages/opencode/src/tool/
├── annotate.ts           # Main tool entry
├── annotate-types.ts     # TypeScript interfaces
├── browser.ts           # Puppeteer manager
├── picker.ts            # Element picker
├── etch.ts              # Edit capture
└── registry.ts          # (modified: register tool)
```

---

## 4. Type System

### annotate-types.ts

```typescript
// ============================================================================
// Element Information
// ============================================================================

export interface BoxModel {
  top: number
  left: number
  width: number
  height: number
  padding: { top: number; right: number; bottom: number; left: number }
  border: { top: number; right: number; bottom: number; left: number }
  margin: { top: number; right: number; bottom: number; left: number }
}

export interface AccessibilityInfo {
  role: string
  name: string
  live: string
}

export interface ElementInfo {
  selector: string // CSS selector
  xpath: string // XPath
  tag: string // HTML tag (lowercase)
  text: string // Inner text (truncated to 500 chars)
  attributes: Record<string, string>
  box: BoxModel
  accessibility: AccessibilityInfo
  styles: Record<string, string> // Key computed styles
}

// ============================================================================
// Annotation
// ============================================================================

export interface AnnotatedElement {
  element: ElementInfo
  notes: string[]
  screenshot?: string // Base64 per-element crop
}

export interface Annotation {
  id: string // ULID
  url: string
  title: string
  createdAt: Date
  mode: "picker" | "etch"
  elements: AnnotatedElement[]
}

// ============================================================================
// Tool Output
// ============================================================================

export interface AnnotationResult {
  type: "annotation"
  url: string
  title: string
  timestamp: number
  elements: AnnotatedElement[]
  screenshot: string // Base64 full-page
  mode: "picker" | "etch"
}

export interface EtchResult {
  type: "etch"
  url: string
  timestamp: number
  before: {
    screenshot: string
    styles: Record<string, Record<string, string>> // selector -> styles
  }
  after: {
    screenshot: string
    styles: Record<string, Record<string, string>>
  }
  changes: StyleChange[]
}

export interface StyleChange {
  selector: string
  property: string
  before: string
  after: string
}

// ============================================================================
// Tool Parameters
// ============================================================================

export interface AnnotateParams {
  url: string
  mode?: "picker" | "etch"
  fullPage?: boolean
}
```

---

## 5. Module Design

### 5.1 browser.ts — Browser Manager

**Responsibilities:**

- Launch and manage Puppeteer browser instance
- Create/destroy page instances
- Screenshot capture (full-page and element crops)
- Graceful cleanup on errors

**Interface:**

```typescript
import type { Page, Browser } from "puppeteer"

export class BrowserManager {
  private browser: Browser | null = null
  private page: Page | null = null

  async launch(): Promise<void>
  async open(url: string): Promise<void>
  async screenshot(options?: ScreenshotOptions): Promise<string>
  async elementScreenshot(selector: string): Promise<string>
  async close(): Promise<void>

  get page(): Page | null
  get isOpen(): boolean
}

interface ScreenshotOptions {
  fullPage?: boolean
  clip?: { x: number; y: number; width: number; height: number }
  type?: "png" | "jpeg"
  quality?: number
}
```

**Implementation Notes:**

```typescript
// Singleton pattern for browser reuse
let _browser: Browser | null = null
let _page: Page | null = null

export async function getBrowser(): Promise<Browser> {
  if (!_browser || !_browser.connected) {
    _browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    })
  }
  return _browser
}

// Cleanup on process exit
process.on("exit", () => _browser?.close())
```

**Error Handling:**

```typescript
try {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 })
} catch (error) {
  if (error instanceof TimeoutError) {
    throw new Error(`Page load timeout for ${url}`)
  }
  throw error
}
```

---

### 5.2 picker.ts — Element Picker

**Responsibilities:**

- Get element at coordinates (for click detection)
- Calculate box model (content, padding, border, margin)
- Extract accessibility information
- Generate unique selectors (CSS + XPath)
- Capture computed styles

**Interface:**

```typescript
import type { Page } from "puppeteer"

export class ElementPicker {
  constructor(private page: Page) {}

  // Get element at click coordinates
  async getElementAt(x: number, y: number): Promise<ElementInfo | null>

  // Get all interactive elements (a, button, input, etc.)
  async getInteractiveElements(): Promise<ElementInfo[]>

  // Get element by CSS selector
  async getElementBySelector(selector: string): Promise<ElementInfo | null>

  // Generate unique CSS selector for element
  generateSelector(element: Element): string

  // Generate XPath for element
  generateXPath(element: Element): string
}
```

**CDP Integration:**

```typescript
// Using page.evaluate for DOM access
const elementInfo = await this.page.evaluate((selector) => {
  const el = document.querySelector(selector)
  if (!el) return null

  const rect = el.getBoundingClientRect()
  const styles = window.getComputedStyle(el)

  return {
    tag: el.tagName.toLowerCase(),
    text: el.textContent?.slice(0, 500) ?? "",
    box: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    },
    styles: {
      display: styles.display,
      position: styles.position,
      color: styles.color,
      backgroundColor: styles.backgroundColor,
    },
  }
}, selector)
```

**Selector Generation:**

```typescript
// Build CSS selector from attributes
function buildSelector(el: Element): string {
  const parts: string[] = []

  // ID
  if (el.id) {
    parts.push(`#${CSS.escape(el.id)}`)
    return parts.join("")
  }

  // Classes (limited to 3 most specific)
  const classes = Array.from(el.classList)
    .filter((c) => !c.includes(":"))
    .slice(0, 3)
  if (classes.length > 0) {
    parts.push(`.${classes.map((c) => CSS.escape(c)).join(".")}`)
  }

  // Tag name
  parts.unshift(el.tagName.toLowerCase())

  return parts.join("")
}
```

---

### 5.3 etch.ts — Edit Capture

**Responsibilities:**

- Inject MutationObserver into page
- Capture "before" state (screenshot + styles)
- Detect DOM/style changes
- Generate diff output

**Interface:**

```typescript
import type { Page } from "puppeteer"

export class EditCapture {
  constructor(private page: Page) {}

  // Start edit capture mode
  async start(): Promise<void>

  // Capture current state
  async captureState(): Promise<EtchState>

  // Stop capture and return diff
  async stop(): Promise<EtchResult>

  // Check if element matches before state
  async getChanges(before: EtchState, after: EtchState): Promise<StyleChange[]>
}

interface EtchState {
  screenshot: string
  styles: Map<string, Record<string, string>>
  mutations: MutationRecord[]
}
```

**MutationObserver Injection:**

```typescript
// Inject via page.evaluate
await this.page.evaluate(() => {
  const mutations: Mutation[] = []

  const observer = new MutationObserver((records) => {
    mutations.push(...records)
  })

  observer.observe(document.body, {
    attributes: true,
    attributeOldValue: true,
    characterData: true,
    childList: true,
    subtree: true,
  })

  // Store observer reference
  ;(window as any).__etchObserver = observer
  ;(window as any).__etchMutations = mutations
})
```

---

### 5.4 annotate.ts — Main Tool

**Pattern**: Follow existing `Tool.define()` pattern

```typescript
import { Tool } from "./tool"
import { BrowserManager } from "./browser"
import { ElementPicker } from "./picker"
import { EditCapture } from "./etch"
import type { AnnotationResult, AnnotateParams } from "./annotate-types"
import z from "zod"

export const annotateTool = Tool.define("annotate", async (ctx) => {
  // 1. Parse parameters
  const params = await ctx.parse<z.infer<typeof schema>>(schema)

  // 2. Launch browser
  const browser = new BrowserManager()
  await browser.launch()

  try {
    // 3. Open URL
    await browser.open(params.url)

    // 4. Capture screenshot
    const screenshot = await browser.screenshot({ fullPage: params.fullPage ?? true })

    // 5. Get page title
    const title = await browser.page.title()

    // 6. Mode-specific handling
    if (params.mode === "etch") {
      return await handleEtchMode(browser, params)
    }

    return await handlePickerMode(browser, params)
  } finally {
    await browser.close()
  }
})

const schema = z.object({
  url: z.string().url().describe("URL to annotate"),
  mode: z.enum(["picker", "etch"]).default("picker"),
  fullPage: z.boolean().default(true),
})
```

---

## 6. Integration Points

### 6.1 Tool Registry (`registry.ts`)

```typescript
import { annotateTool } from "./annotate"

export const tools = {
  // ... existing tools
  annotate: annotateTool,
}
```

### 6.2 Command Registration (`command/index.ts`)

```typescript
export const commands = [
  // ... existing commands
  {
    name: "annotate",
    description: "Open a URL and visually annotate elements",
    aliases: ["ann"],
    template: "/annotate",
  },
]
```

---

## 7. Error Handling

| Error                  | Handling                                    |
| ---------------------- | ------------------------------------------- |
| Browser launch failure | Show error, suggest `npm install puppeteer` |
| Page load timeout      | Retry once, then error with URL             |
| Invalid URL            | Validate with Zod, show format hint         |
| Element not found      | Return empty elements array with warning    |
| Screenshot failure     | Return without screenshot, note in output   |
| Memory pressure        | Explicit browser.close() in finally block   |

---

## 8. Configuration

### 8.1 Environment Variables

| Variable             | Default                 | Purpose                   |
| -------------------- | ----------------------- | ------------------------- |
| `PUPPETEER_HEADLESS` | `true`                  | Run headless or headed    |
| `PUPPETEER_SLOWMO`   | `0`                     | Slow motion for debugging |
| `ANNOTATION_DIR`     | `.opencode/annotations` | Storage location          |

### 8.2 Tool Parameters (Zod Schema)

```typescript
const schema = z.object({
  url: z.string().url().describe("URL to annotate"),
  mode: z.enum(["picker", "etch"]).default("picker").describe("Annotation mode"),
  fullPage: z.boolean().default(true).describe("Capture full page screenshot"),
})
```

---

## 9. Testing Strategy

### Unit Tests

| Test                  | Location         | Purpose                     |
| --------------------- | ---------------- | --------------------------- |
| Selector generation   | `picker.test.ts` | Verify CSS/XPath generation |
| Box model calculation | `picker.test.ts` | Verify measurements         |
| Style change diff     | `etch.test.ts`   | Verify diff algorithm       |

### Integration Tests

| Test               | Location          | Purpose                         |
| ------------------ | ----------------- | ------------------------------- |
| Browser launch     | `browser.test.ts` | Verify Puppeteer initialization |
| Page load          | `browser.test.ts` | Verify navigation               |
| Screenshot capture | `browser.test.ts` | Verify image output             |

### E2E Tests

| Test                 | Location               | Purpose                 |
| -------------------- | ---------------------- | ----------------------- |
| Full annotation flow | `e2e/annotate.test.ts` | End-to-end verification |

---

## 10. Performance Considerations

| Concern              | Mitigation                                         |
| -------------------- | -------------------------------------------------- |
| Browser startup time | Singleton browser, reuse across calls              |
| Memory usage         | Close page after each annotation                   |
| Screenshot size      | Use JPEG for smaller output, allow quality setting |
| CDP overhead         | Batch element queries, avoid per-element CDP calls |

---

## 11. Security Considerations

| Concern              | Mitigation                                                  |
| -------------------- | ----------------------------------------------------------- |
| Arbitrary URL access | No additional attack surface (browser already handles URLs) |
| XSS in annotation    | Annotations are for inspection, not execution               |
| Screenshot data      | Base64 encoded, not saved to disk by default                |

---

## 12. Dependencies

### Runtime

```json
{
  "puppeteer": "^24.0.0"
}
```

### Development

```json
{
  "@types/puppeteer": "latest"
}
```

---

## 13. Milestone Checklist

### M1: Browser Manager + Screenshot

- [ ] `browser.ts` with launch/open/close/screenshot
- [ ] Singleton pattern for browser reuse
- [ ] Error handling for launch failures
- [ ] Unit tests for screenshot capture

### M2: Element Picker

- [ ] `picker.ts` with getElementAt
- [ ] Box model calculation
- [ ] Selector generation (CSS + XPath)
- [ ] Accessibility info extraction
- [ ] Unit tests

### M3: Annotation Storage + LLM Output

- [ ] `annotate.ts` main tool
- [ ] JSON storage in `.opencode/annotations/`
- [ ] Structured output for LLM
- [ ] Integration with tool registry

### M4: Per-Element Screenshots

- [ ] Element crop functionality
- [ ] Multiple element selection
- [ ] Note attachment per element

### M5: Etch Mode

- [ ] `etch.ts` with MutationObserver
- [ ] Before/after state capture
- [ ] Change detection
- [ ] Integration with annotate tool

### M6: CSS Diffing

- [ ] Computed style comparison
- [ ] Stylesheet rule diffing
- [ ] Visual diff output

---

## 14. Reference Implementation

**Original pi-annotate** (for feature reference):

- `index.ts` - Command handler
- `content.js` - Element picker logic
- `types.ts` - Type definitions

**LightCode patterns**:

- `packages/opencode/src/tool/skill.ts` - Tool.define example
- `packages/opencode/src/tool/browser.ts` - N/A (new file)
- `packages/opencode/src/command/index.ts` - Command registration
