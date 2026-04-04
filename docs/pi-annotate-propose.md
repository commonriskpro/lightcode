# pi-annotate Change Proposal

## Metadata

| Field                | Value                     |
| -------------------- | ------------------------- |
| **Change ID**        | `pi-annotate`             |
| **Title**            | Visual UI Annotation Tool |
| **Status**           | Proposed                  |
| **Author**           | LightCode Team            |
| **Created**          | 2026-04-04                |
| **Target Milestone** | v1.4.0                    |
| **Priority**         | High                      |
| **Type**             | Feature (Native Tool)     |

---

## 1. Problem Statement

LightCode currently lacks the ability to visually inspect and annotate web pages during code editing sessions. When working on frontend projects, developers must manually describe UI elements or switch between tools to communicate which elements need changes.

### Current Limitations

- No ability to open and inspect web pages within the CLI
- No visual element selection or annotation
- No screenshot capture for documentation or AI context
- No way to track CSS/styling changes visually

### Impact

- Reduced productivity when working on UI-heavy projects
- Poor communication of visual requirements
- No visual documentation for design decisions

---

## 2. Proposed Solution

Build a native tool (`/annotate`) that uses Puppeteer to open web pages in a headless Chrome browser, enabling visual element inspection, screenshot capture, and annotation — all without requiring a Chrome Extension.

### Key Principle

> Since LightCode already has access to the customer's project files, opening their URLs in our controlled browser is valid and sufficient for DOM inspection.

---

## 3. Scope

### In Scope

| Component          | Description                                 |
| ------------------ | ------------------------------------------- |
| Browser Manager    | Puppeteer lifecycle management              |
| Element Picker     | DOM inspection with box model visualization |
| Screenshot Capture | Full-page and per-element screenshots       |
| Annotation Storage | JSON-based annotation persistence           |
| LLM Integration    | Structured output for AI context            |
| Etch Mode          | Edit capture via MutationObserver           |
| CSS Diffing        | Before/after style comparison               |

### Out of Scope

| Component               | Reason                                     |
| ----------------------- | ------------------------------------------ |
| Chrome Extension        | Not needed — we open URLs in our browser   |
| Native Messaging        | Not needed — no browser extension required |
| Live browser inspection | Customer's browser not required            |
| Multi-user sync         | Single-session annotations only            |
| Firefox/Safari support  | Puppeteer is Chrome-only initially         |

---

## 4. Approach

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Tool Layer (annotate.ts)                                       │
│  └── /annotate command → Deferred tool execution               │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Service Layer (browser.ts, picker.ts, etch.ts)                │
│  ├── BrowserManager - Puppeteer lifecycle                       │
│  ├── ElementPicker - CDP-based DOM inspection                   │
│  └── EditCapture - MutationObserver injection                   │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Integration Layer                                              │
│  ├── Command registration                                       │
│  └── Tool registry                                              │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Choice

| Technology                         | Rationale                                            |
| ---------------------------------- | ---------------------------------------------------- |
| **Puppeteer**                      | Chrome-only but excellent CDP access, bundled Chrome |
| **CDP (Chrome DevTools Protocol)** | Direct DOM access, box model, accessibility          |
| **JSON**                           | Annotation storage (no external DB needed)           |
| **Base64**                         | Screenshot encoding for LLM context                  |

---

## 5. User Experience

### Command Flow

```
User: /annotate https://example.com
      │
      ▼
LightCode: Opens URL in headless Chrome
      │
      ▼
LightCode: Captures full-page screenshot
      │
      ▼
LightCode: Lists interactive elements with box model
      │
      ▼
User: Selects element(s) by clicking or selector
      │
      ▼
LightCode: Captures annotations with notes
      │
      ▼
LightCode: Returns structured output to LLM context
```

### Output Format (LLM Context)

```json
{
  "type": "annotation",
  "url": "https://example.com",
  "title": "Example Domain",
  "timestamp": 1712236800000,
  "elements": [
    {
      "selector": "#main-nav > li:nth-child(1) > a",
      "xpath": "//nav[@id='main-nav']/ul/li[1]/a",
      "tag": "a",
      "text": "Home",
      "box": { "top": 10, "left": 20, "width": 80, "height": 40 },
      "accessibility": { "role": "link", "name": "Home", "live": "" },
      "styles": { "color": "blue", "fontSize": "14px" },
      "notes": ["Primary navigation link"]
    }
  ],
  "screenshot": "data:image/png;base64,..."
}
```

---

## 6. Deliverables

### New Files

| File                                           | Purpose                           |
| ---------------------------------------------- | --------------------------------- |
| `packages/opencode/src/tool/annotate.ts`       | Main tool entry point             |
| `packages/opencode/src/tool/browser.ts`        | Puppeteer browser manager         |
| `packages/opencode/src/tool/picker.ts`         | Element picker and DOM inspection |
| `packages/opencode/src/tool/etch.ts`           | Edit capture mode                 |
| `packages/opencode/src/tool/annotate-types.ts` | TypeScript interfaces             |
| `docs/pi-annotate-arch.md`                     | Architecture documentation        |
| `docs/pi-annotate-implementation-plan.md`      | Implementation spec               |
| `docs/pi-annotate-propose.md`                  | This proposal                     |

### Modified Files

| File                                     | Change                   |
| ---------------------------------------- | ------------------------ |
| `packages/opencode/package.json`         | Add puppeteer dependency |
| `packages/opencode/src/tool/registry.ts` | Register annotate tool   |
| Project/user command config (optional)   | Add `/annotate` alias    |

---

## 7. Milestones

| Milestone | Description                        | Effort |
| --------- | ---------------------------------- | ------ |
| M1        | Browser manager + basic screenshot | Low    |
| M2        | Element picker with box model      | Medium |
| M3        | Annotation storage + LLM output    | Medium |
| M4        | Per-element screenshots            | Low    |
| M5        | Etch mode (edit capture)           | High   |
| M6        | CSS diffing                        | Medium |

---

## 8. Risks & Mitigations

| Risk                      | Likelihood | Impact | Mitigation                              |
| ------------------------- | ---------- | ------ | --------------------------------------- |
| Puppeteer bundle size     | High       | Low    | Lazy load, optional dependency          |
| Headless browser crashes  | Medium     | Medium | Graceful error handling, retry logic    |
| CDP version mismatch      | Low        | Medium | Pin Puppeteer version                   |
| Memory leaks from browser | Medium     | Medium | Explicit cleanup, singleton per session |

---

## 9. Dependencies

```json
{
  "puppeteer": "^24.0.0"
}
```

---

## 10. Open Questions

1. **Picker UI**: Terminal ASCII art, external viewer, or TUI?
2. **Browser reuse**: Singleton or per-call?
3. **Screenshot format**: Base64 inline or file path reference?

---

## 11. Approval

| Role       | Name           | Status      |
| ---------- | -------------- | ----------- |
| Author     | LightCode Team | ✅ Proposed |
| Maintainer | -              | Pending     |
