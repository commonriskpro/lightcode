# pi-annotate Implementation Plan

> Spec-driven implementation for visual UI annotation tool.

---

## Overview

Build a native tool that enables AI-assisted visual markup of web pages using Puppeteer headless Chrome.

**Key Principle**: Since we already have access to the customer's project, we open their URLs in our controlled browser. No Chrome Extension or Native Messaging required.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  annotate.ts (Main Tool)                                       │
│  ├── /annotate command                                          │
│  ├── Browser lifecycle management                                │
│  └── Structured output formatting                               │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  browser.ts (Browser Manager)                                   │
│  ├── Puppeteer instance management                              │
│  ├── CDP connection                                             │
│  └── Screenshot capture                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  picker.ts (Element Picker)                                     │
│  ├── DOM traversal                                              │
│  ├── Box model calculation                                      │
│  ├── Accessibility info extraction                              │
│  └── Selector generation (CSS + XPath)                         │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  etch.ts (Edit Capture)                                         │
│  ├── MutationObserver injection                                 │
│  ├── CSSOM diffing                                              │
│  └── Before/after snapshot management                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Core Browser Tool

### 1.1 Browser Manager (`browser.ts`)

**Responsibilities:**

- Launch/manage Puppeteer browser instance
- Create new page for each annotation session
- Handle browser cleanup on exit/errors
- Screenshot capture (full-page and element crops)

**Interface:**

```typescript
export interface BrowserManager {
  page: Page
  browser: Browser

  open(url: string): Promise<void>
  screenshot(options?: ScreenshotOptions): Promise<string>
  elementScreenshot(selector: string): Promise<string>
  close(): Promise<void>
}

interface ScreenshotOptions {
  fullPage?: boolean
  clip?: { x: number; y: number; width: number; height: number }
  type?: "png" | "jpeg"
  quality?: number
}
```

**Implementation Notes:**

- Use `puppeteer.launch()` with `--headless` flag
- Set `defaultViewport: null` for full-page screenshots
- Use `page.screenshot()` with `clip` option for element crops
- Implement singleton pattern for browser reuse across tool calls

### 1.2 Basic Tool Test

**Test Case:**

1. Open a test URL (e.g., `https://example.com`)
2. Capture full-page screenshot
3. Return page title and basic element count

---

## Phase 2: Element Picker

### 2.1 Element Inspection (`picker.ts`)

**Responsibilities:**

- Get element at coordinates (for click detection)
- Calculate box model (content, padding, border, margin)
- Extract accessibility information (ARIA)
- Generate unique selectors (CSS + XPath)
- Capture computed styles

**Interface:**

```typescript
export interface ElementInfo {
  selector: string // CSS selector
  xpath: string // XPath
  tag: string // HTML tag
  text: string // Inner text (truncated to 500 chars)
  attributes: Record<string, string>
  box: BoxModel
  accessibility: AccessibilityInfo
  styles: Record<string, string>
}

interface BoxModel {
  top: number
  left: number
  width: number
  height: number
  padding: { top: number; right: number; bottom: number; left: number }
  border: { top: number; right: number; bottom: number; left: number }
  margin: { top: number; right: number; bottom: number; left: number }
}

interface AccessibilityInfo {
  role: string // ARIA role
  name: string // Accessible name
  live: string // Live region status
}
```

**CDP Methods Used:**

- `DOM.getDocument` - Get document root
- `DOM.getBoxModel` - Get element box model
- `DOM.querySelectorAll` - Query elements
- `AXNode` - Accessibility tree queries

### 2.2 Visual Picker Flow

**Step 1**: User provides URL

```typescript
await browser.open("https://example.com")
```

**Step 2**: Take screenshot of full page

```typescript
const screenshot = await browser.screenshot({ fullPage: true })
```

**Step 3**: Get all interactive elements

```typescript
const elements = await picker.getInteractiveElements()
```

**Step 4**: Generate overlay data for UI

```typescript
const overlay = elements.map((el) => ({
  box: el.box,
  tag: el.tag,
  selector: el.selector,
}))
```

**Step 5**: User clicks element (via terminal UI or external viewer)

```typescript
const selected = await picker.getElementAt(x, y)
```

---

## Phase 3: Annotation System

### 3.1 Annotation Storage

**Structure:**

```typescript
interface Annotation {
  id: string // ULID
  url: string
  title: string
  createdAt: Date
  elements: AnnotatedElement[]
}

interface AnnotatedElement {
  element: ElementInfo
  notes: string[]
  screenshot?: string
}
```

**Storage Location:** `.opencode/annotations/<id>.json`

### 3.2 Tool Output Format

When user runs `/annotate` and completes selection:

```typescript
interface AnnotationResult {
  type: "annotation"
  url: string
  title: string
  timestamp: number
  elements: AnnotatedElement[]
  screenshot: string // base64 full-page
}
```

**This becomes part of the LLM context for the current session.**

---

## Phase 4: Advanced Features

### 4.1 Etch Mode (Edit Capture)

**Purpose**: Track CSS/styling changes made to the page.

**Implementation:**

1. Inject MutationObserver via CDP
2. Capture "before" state (computed styles, CSSOM)
3. Wait for user edits
4. Capture "after" state
5. Generate diff

**CDP Injection:**

```typescript
await page.evaluate(() => {
  const observer = new MutationObserver((mutations) => {
    // Send mutations back via CDP
  })
  observer.observe(document.body, {
    attributes: true,
    attributeOldValue: true,
    childList: true,
    subtree: true,
  })
})
```

### 4.2 CSS Diffing

**Compare:**

- Inline styles (`element.style`)
- Computed styles (`window.getComputedStyle(element)`)
- Stylesheet rules affecting element

### 4.3 Before/After Snapshots

```typescript
interface EtchResult {
  type: "etch"
  url: string
  before: {
    screenshot: string
    styles: Record<string, Record<string, string>>
  }
  after: {
    screenshot: string
    styles: Record<string, Record<string, string>>
  }
  changes: StyleChange[]
}
```

---

## Phase 5: Tool Integration

### 5.1 Native Session Command Path

Implement native dispatch in `SessionPrompt.command` for:

- `/annotate` -> `annotate` tool with `action=start`
- `/annotate-complete` -> `annotate` tool with `action=complete`
- `/annotate-cancel` -> `annotate` tool with `action=cancel`

This bypasses command template prompting for annotate workflow.

### 5.2 Tool Registration

**File:** `packages/opencode/src/tool/registry.ts`

```typescript
import { annotateTool } from "./annotate"

const annotate = yield * build(annotateTool)

return [
  // ...existing tools
  annotate,
]
```

### 5.3 Main Tool (`annotate.ts`)

```typescript
export const annotateTool = Tool.define("annotate", async (ctx) => {
  // 1. Parse URL from context or prompt user
  // 2. Launch browser manager
  // 3. Open URL
  // 4. Capture screenshot
  // 5. Get elements
  // 6. Present picker to user (terminal UI or external viewer)
  // 7. Collect annotations
  // 8. Return structured result
})
```

---

## File Structure

```
packages/opencode/src/tool/
├── annotate.ts      # Main tool entry
├── browser.ts      # Puppeteer management
├── picker.ts       # Element inspection
├── etch.ts         # Edit capture
├── annotate-types.ts # Shared types
└── registry.ts     # Tool registration (modify)
```

---

## Dependencies

```json
{
  "dependencies": {
    "puppeteer": "^24.0.0"
  }
}
```

**Note**: Puppeteer downloads Chromium by default (~50MB). Configure via:

```typescript
puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
})
```

---

## Testing Strategy

1. **Unit tests** for picker logic (mock CDP responses)
2. **Integration tests** with actual Puppeteer (mark as slow)
3. **E2E tests** with `@playwright/test`

---

## Open Questions

1. **Picker UI**: Terminal-based overlay or external viewer?
   - Option A: ASCII art + click coordinates
   - Option B: Open screenshot in browser + return click coords
   - Option C: TUI with mouse support

2. **Browser reuse**: Singleton or per-call launch?
   - Reuse: Faster but state may persist
   - Per-call: Cleaner but slower startup

3. **Headless vs headed**: Default headless, headed for debugging?

4. **Screenshot delivery**: Base64 in context or file path?

---

## Milestones

| Milestone | Deliverable                             | Complexity |
| --------- | --------------------------------------- | ---------- |
| M1        | Open URL, screenshot, return basic info | Low        |
| M2        | Element picker with box model           | Medium     |
| M3        | Annotation storage + LLM output         | Medium     |
| M4        | Per-element screenshots                 | Low        |
| M5        | Etch mode (edit capture)                | High       |
| M6        | CSS diffing                             | Medium     |

---

## Reference Files

- Original pi-annotate: `/Users/saturno/Downloads/pi-annotate-main/`
- Tool patterns: `packages/opencode/src/tool/*.ts`
- Command execution path: `packages/opencode/src/session/prompt.ts` (native annotate interception)
