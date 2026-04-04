# pi-annotate Integration Research

**Date**: 2026-04-04  
**Status**: Decision Made - Option B (Puppeteer Native Tool)  
**Priority**: Visual picker > CLI users | Full-featured, not fast-to-ship

## Executive Summary

The current fork has NO pi-annotate integration. We analyzed the original `pi-annotate-main` (v0.4.1) and determined that **a Puppeteer-based native tool** can achieve full DOM inspection without requiring a Chrome Extension.

### Key Insight

> Since we're already editing the customer's project, we can open their URL in our own controlled browser. This eliminates the need for Chrome Extension + Native Messaging infrastructure.

---

## Decision: Option B (Enhanced)

**Approach**: Native Tool + Puppeteer Headless Browser

```
┌─────────────────────────────────────────────────────────────────┐
│  packages/opencode/src/tool/annotate.ts                         │
│  ├── Spawns headless Chrome via Puppeteer (bundled)            │
│  ├── Opens target URL in controlled browser                    │
│  ├── Uses CDP (Chrome DevTools Protocol) for DOM inspection   │
│  ├── Element picker with visual overlay                       │
│  ├── Screenshot capture (full-page + per-element)             │
│  └── Annotation storage + structured output for LLM           │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Works

| Requirement             | Solution                                         |
| ----------------------- | ------------------------------------------------ |
| Inspect customer's page | Open their URL in our headless Chrome            |
| DOM inspection          | Puppeteer CDP provides full DOM access           |
| Visual picker           | Screenshot + canvas overlay with click detection |
| Screenshots             | `page.screenshot()` with element clipping        |
| Element notes           | Store in annotation object, output to LLM        |
| Etch mode               | MutationObserver in our controlled browser       |

---

## Original pi-annotate Architecture (Reference)

### Tech Stack

- Vanilla JS Chrome Extension (MV3)
- TypeScript Pi Extension
- Node.js Native Host

### Component Flow

```
Pi Extension ↔ Unix Socket ↔ Native Host ↔ Chrome Native Messaging ↔ Chrome Extension
```

### Key Components

| Component       | Lines | Purpose                                              |
| --------------- | ----- | ---------------------------------------------------- |
| `index.ts`      | 563   | Pi extension with `/annotate` command, socket client |
| `types.ts`      | 164   | TypeScript interfaces for annotations                |
| `content.js`    | ~2000 | Element picker, note cards, SVG connectors           |
| `background.js` | 209   | Native messaging, tab routing                        |
| `host.cjs`      | 212   | Unix socket server, auth token management            |

### Features (v0.4.0+)

- Element picker with box model & accessibility info
- Inline note cards (draggable, per-element comments)
- Per-element or full-page screenshots
- Edit Capture ("Etch" mode) with MutationObserver
- Before/after screenshots for edits
- CSS stylesheet diffing
- Dark/Light theme support

---

## Implementation Plan

### Phase 1: Core Browser Tool

- [ ] Add Puppeteer as dependency
- [ ] Create `packages/opencode/src/tool/browser.ts` (basic page open + screenshot)
- [ ] Test: Open URL, capture screenshot, return element info

### Phase 2: Element Picker

- [ ] CDP-based element inspection
- [ ] Hover highlighting with box model overlay
- [ ] Click-to-select with element data extraction
- [ ] CSS selector + XPath generation

### Phase 3: Annotation System

- [ ] Element notes (add/edit notes per element)
- [ ] Annotation storage format
- [ ] Structured output for LLM consumption

### Phase 4: Advanced Features

- [ ] Per-element screenshot crops
- [ ] Etch mode (MutationObserver for edit tracking)
- [ ] CSS diffing
- [ ] Before/after snapshots

### Phase 5: Integration

- [ ] `/annotate` command registration
- [ ] Tool registration (showAnnotations, hideAnnotations)
- [ ] Output formatting for LLM context

---

## Technical Considerations

### Puppeteer vs Playwright

| Aspect         | Puppeteer            | Playwright                   |
| -------------- | -------------------- | ---------------------------- |
| Chrome-only    | ✅ Faster CDP access | ❌ Cross-browser abstraction |
| Bundled Chrome | ✅ Yes               | ✅ Yes                       |
| NPM size       | ~50MB                | ~80MB                        |
| CDP maturity   | ✅ Excellent         | ⚠️ Good                      |

**Decision**: Puppeteer (Chrome-specific but faster CDP access)

### Architecture Pattern

Follow existing tool patterns in `packages/opencode/src/tool/`:

- `Tool.define(id, def)` pattern
- Deferred tool execution
- Zod schema for parameters

### Output Format

```typescript
interface AnnotationResult {
  url: string
  title: string
  timestamp: number
  mode: "picker" | "etch"
  elements: AnnotationElement[]
  screenshot?: string // base64
  cssChanges?: CssChange[]
}

interface AnnotationElement {
  selector: string // CSS selector
  xpath: string // XPath
  tag: string // HTML tag
  text: string // Inner text (truncated)
  attributes: Record<string, string>
  box: { top: number; left: number; width: number; height: number }
  accessibility: {
    role: string
    name: string
    live: string
  }
  styles: Record<string, string> // computed styles
  notes: string[]
  screenshot?: string // per-element crop
}
```

---

## Files to Create/Modify

### New Files

- `packages/opencode/src/tool/annotate.ts` - Main annotation tool
- `packages/opencode/src/tool/browser.ts` - Puppeteer browser management
- `packages/opencode/src/tool/types.ts` - Shared types
- `packages/opencode/src/tool/picker.ts` - Element picker logic
- `packages/opencode/src/tool/etch.ts` - Edit capture mode

### Modified Files

- `packages/opencode/src/tool/registry.ts` - Register annotate tool
- `packages/opencode/package.json` - Add puppeteer dependency

### Dependencies

```json
{
  "puppeteer": "^24.0.0"
}
```

---

## Comparison: Approaches Considered

| Approach                | Effort        | Visual Picker | DOM Access                | Cross-Platform      |
| ----------------------- | ------------- | ------------- | ------------------------- | ------------------- |
| A: Chrome Extension     | 2-3 weeks     | ✅ Full       | ✅ Live browser           | ⚠️ Native messaging |
| **B: Puppeteer Native** | **1-2 weeks** | ✅ **Full**   | ✅ **Controlled browser** | ✅ **Yes**          |
| C: MCP + Playwright     | 1-2 weeks     | ✅ Via MCP    | ✅ Via MCP                | ✅ Yes              |

**Selected**: Option B (Puppeteer Native) - Best balance of features, speed, and simplicity

---

## Next Steps

1. Add Puppeteer dependency
2. Create basic browser tool (`browser.ts`)
3. Implement element picker
4. Add annotation storage
5. Test with sample URLs
