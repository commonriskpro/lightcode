# pi-annotate — Visual UI Annotation Architecture

> Native Puppeteer-based visual annotation tool for LightCode.
>
> **Key Principle**: Since we already have access to the customer's project, we open their URLs in our controlled browser. No Chrome Extension or Native Messaging required.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Tool Layer                                                       │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  annotate.ts                                                │ │
│  │  - Native session flow (start/complete/cancel)             │ │
│  │  - Live browser annotation capture                           │ │
│  │  - Structured output for chat/session consumption            │ │
│  └─────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Service Layer                                                    │
│  ┌──────────────────┐  ┌─────────────────┐  ┌────────────────┐ │
│  │  browser.ts      │  │  picker.ts      │  │  etch.ts       │ │
│  │  Puppeteer mgmt  │  │  Element picker │  │  Edit capture  │ │
│  │  CDP connection  │  │  Box model calc │  │  CSS diffing   │ │
│  │  Screenshots     │  │  Selector gen   │  │  Mutations     │ │
│  └──────────────────┘  └─────────────────┘  └────────────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Integration Layer                                               │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  registry.ts — Tool registration                           │ │
│  │  session/prompt.ts — native command interception             │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Technology Stack**:

| Component | Technology               | Rationale                                          |
| --------- | ------------------------ | -------------------------------------------------- |
| Browser   | Puppeteer ^24.0.0        | Chrome CDP access, bundled browser                 |
| CDP       | Chrome DevTools Protocol | DOM inspection, box model, accessibility           |
| Storage   | JSON                     | Annotation persistence in `.opencode/annotations/` |
| Output    | Base64                   | Screenshot encoding for LLM context                |

---

## 2. Data Flow

### Annotation Creation Flow

```
User: /annotate https://example.com
    │
    ▼
SessionPrompt.command intercepts native annotate command
    │
    ▼
annotate.ts action=start opens headed controlled browser
    │
    ▼
User navigates and clicks elements in live page overlay
    │
    ▼
User runs /annotate-complete
    │
    ▼
annotate.ts action=complete resolves picks + metadata + screenshot
    │
    ▼
AnnotationResult persisted in session as native tool output (no command prompt template)
```

### Edit Capture ("Etch") Flow

```
User: /annotate https://example.com --mode etch
    │
    ▼
etch.ts injects MutationObserver via page.evaluate()
    │
    ▼
Before state captured (screenshot + computed styles)
    │
    ▼
User makes CSS changes (via page.evaluate or external)
    │
    ▼
MutationObserver detects DOM/style changes
    │
    ▼
User completes etch session
    │
    ▼
After state captured
    │
    ▼
Diff generated (property changes, before/after values)
    │
    ▼
EtchResult returned to LLM context
```

---

## 3. Module Design

### 3.1 browser.ts — Browser Manager

**Responsibilities:**

- Launch and manage Puppeteer browser instance
- Create/destroy page instances
- Screenshot capture (full-page and element crops)
- Graceful cleanup on errors

**Key Methods:**

```typescript
class BrowserManager {
  async launch(): Promise<void>
  async open(url: string): Promise<void>
  async screenshot(options?: ScreenshotOptions): Promise<string>
  async elementScreenshot(selector: string): Promise<string>
  async close(): Promise<void>
  get page(): Page | null
  get isOpen(): boolean
}
```

**Implementation Notes:**

- Singleton pattern for browser reuse across tool calls
- Launch with `--headless` and `--no-sandbox` flags
- Use `page.screenshot()` with `clip` option for element crops

### 3.2 picker.ts — Element Picker

**Responsibilities:**

- Get element at coordinates (for click detection)
- Calculate box model (content, padding, border, margin)
- Extract accessibility information (ARIA)
- Generate unique selectors (CSS + XPath)
- Capture computed styles

**Key Methods:**

```typescript
class ElementPicker {
  constructor(private page: Page) {}

  async getElementAt(x: number, y: number): Promise<ElementInfo | null>
  async getInteractiveElements(): Promise<ElementInfo[]>
  async getElementBySelector(selector: string): Promise<ElementInfo | null>
  generateSelector(element: Element): string
  generateXPath(element: Element): string
}
```

**CDP Integration:**

Uses `page.evaluate()` to access DOM directly:

- `DOM.getDocument` for document root
- `DOM.getBoxModel` for element dimensions
- `DOM.querySelectorAll` for element queries
- `AXNode` for accessibility tree

### 3.3 etch.ts — Edit Capture

**Responsibilities:**

- Inject MutationObserver into page
- Capture "before" state (screenshot + styles)
- Detect DOM/style changes
- Generate diff output

**Key Methods:**

```typescript
class EditCapture {
  constructor(private page: Page) {}

  async start(): Promise<void>
  async captureState(): Promise<EtchState>
  async stop(): Promise<EtchResult>
  async getChanges(before: EtchState, after: EtchState): Promise<StyleChange[]>
}
```

**MutationObserver Injection:**

```typescript
await page.evaluate(() => {
  const observer = new MutationObserver((records) => {
    mutations.push(...records)
  })
  observer.observe(document.body, {
    attributes: true,
    attributeOldValue: true,
    childList: true,
    subtree: true,
  })
})
```

### 3.4 annotate.ts — Main Tool

**Pattern**: Follow existing `Tool.define()` pattern from `skill.ts`

```typescript
import { Tool } from "./tool"
import { BrowserManager } from "./browser"
import { ElementPicker } from "./picker"
import { EditCapture } from "./etch"

export const annotateTool = Tool.define("annotate", async (ctx) => {
  // 1. Parse parameters (url, mode, fullPage)
  // 2. Launch browser
  // 3. Open URL
  // 4. Capture screenshot
  // 5. Get elements or handle Etch mode
  // 6. Return structured AnnotationResult
})
```

---

## 4. File Structure

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

## 5. Dependencies

```json
{
  "dependencies": {
    "puppeteer": "^24.0.0"
  }
}
```

**Notes:**

- Puppeteer bundles Chromium (~50MB)
- Configure launch args: `--no-sandbox --disable-setuid-sandbox`
- Set `defaultViewport: null` for full-page screenshots

---

## 6. Integration Points

### Tool Registry (`registry.ts`)

```typescript
import { annotateTool } from "./annotate"

const annotate = yield * build(annotateTool)

return [
  // ...existing tools
  annotate,
]
```

### Native Command Dispatch (`session/prompt.ts`)

```typescript
// /annotate, /annotate-complete, /annotate-cancel
// are intercepted in SessionPrompt.command and dispatched
// directly to annotate tool actions (start/complete/cancel).
// This path bypasses command template prompting.
```

---

## 7. Error Handling

| Error                  | Handling                                  |
| ---------------------- | ----------------------------------------- |
| Browser launch failure | Show error, suggest `bun add puppeteer`   |
| Page load timeout      | Retry once, then error with URL           |
| Invalid URL            | Validate with Zod, show format hint       |
| Element not found      | Return empty elements array with warning  |
| Screenshot failure     | Return without screenshot, note in output |

---

## 8. Performance Considerations

| Concern              | Mitigation                                         |
| -------------------- | -------------------------------------------------- |
| Browser startup time | Singleton browser, reuse across calls              |
| Memory usage         | Close page after each annotation                   |
| Screenshot size      | Use JPEG for smaller output, allow quality setting |
| CDP overhead         | Batch element queries, avoid per-element CDP calls |

---

## 9. Milestones

| Milestone | Description                             | Complexity |
| --------- | --------------------------------------- | ---------- |
| M1        | Open URL, screenshot, return basic info | Low        |
| M2        | Element picker with box model           | Medium     |
| M3        | Annotation storage + LLM output         | Medium     |
| M4        | Per-element screenshots                 | Low        |
| M5        | Etch mode (edit capture)                | High       |
| M6        | CSS diffing                             | Medium     |

---

## 10. Reference Implementation

**Original pi-annotate** (for feature reference):

- `index.ts` - Command handler
- `content.js` - Element picker logic
- `types.ts` - Type definitions

**LightCode patterns**:

- `packages/opencode/src/tool/skill.ts` - Tool.define example
- `packages/opencode/src/tool/registry.ts` - Effect-based tool registration
