# Proposal: pi-annotate — Visual UI Annotation Tool

## Intent

Add a visual DOM annotation tool to LightCode that lets the agent inspect, select, and annotate elements on live web pages. Enables AI-assisted frontend work: CSS debugging, accessibility audits, visual regression capture.

## Scope

### In Scope

- `annotate` tool: Puppeteer-based picker mode with interactive overlay, element selection, structured output
- `etch` tool: before/after DOM snapshot diff for mutation tracking
- Browser lifecycle management (reuse + cleanup)

### Out of Scope

- Video recording
- Multi-page flows
- Authentication/login automation

## Capabilities

### New Capabilities

- `pi-annotate`: picker and etch modes for visual DOM inspection

## Approach

Puppeteer + Chrome DevTools Protocol. Browser managed as a session-scoped singleton. Overlay injected via CDP. Selectors resolved once at etch-start for diff consistency.

## Affected Areas

| Area                         | Impact                            |
| ---------------------------- | --------------------------------- |
| `src/tool/annotate.ts`       | New — picker mode tool            |
| `src/tool/etch.ts`           | New — etch mode tool              |
| `src/tool/browser.ts`        | New — browser lifecycle           |
| `src/tool/annotate-types.ts` | New — shared types                |
| `src/tool/registry.ts`       | Modified — register annotate tool |

## Success Criteria

- [x] Agent can open any URL and receive structured element data
- [x] Selectors, box model, accessibility, computed styles returned per element
- [x] Etch mode captures before/after diff with consistent selectors
- [x] Browser instances reused within session
