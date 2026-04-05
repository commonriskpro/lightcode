# pi-annotate Specification

> Visual UI annotation tool. Code-verified against `src/tool/annotate.ts`, `src/tool/etch.ts`, `src/tool/browser.ts`.

## Purpose

Enable AI-assisted visual inspection and markup of web pages within LightCode sessions. Two modes: **picker** (interactive element selection) and **etch** (before/after DOM mutation capture).

## Requirements

### Requirement: Element Picker Mode

The `annotate` tool MUST accept a `url` parameter and open it in a Puppeteer-managed Chromium browser. In `picker` mode, it MUST inject an interactive overlay and return structured element data for selected elements.

#### Scenario: Basic element annotation

- GIVEN a LightCode session with the `annotate` tool available
- WHEN the agent calls `annotate` with a valid URL and mode `picker`
- THEN the tool MUST open the URL in a managed browser instance
- AND MUST inject the picker overlay (CSS + JS) into the page
- AND MUST return a `PickerSession` ID for the interactive session
- AND the session MUST accept element click events via CDP

#### Scenario: Element data extraction

- GIVEN a picker session is active and the user clicks an element
- WHEN the element is selected
- THEN the tool MUST return for each selected element:
  - CSS selector (unique)
  - XPath
  - Tag name, text content, attributes
  - Box model: `{ top, left, width, height }`
  - Accessibility info: `{ role, name }`
  - Computed styles (key properties)
- AND MUST NOT select more than 200 elements per session

#### Scenario: URL validation

- GIVEN an invalid URL is passed to annotate
- WHEN the tool executes
- THEN it MUST return an error without launching a browser

### Requirement: Etch Mode (DOM Mutation Capture)

The `etch` tool MUST capture a DOM snapshot BEFORE a code change and a snapshot AFTER, then diff them to produce a structured mutation report.

#### Scenario: Before/after style diff

- GIVEN an active browser session with a URL loaded
- WHEN `etch` is called with `mode: "before"` before a code change
- THEN it MUST capture and store the current DOM state (selectors resolved at start)
- WHEN `etch` is called with `mode: "after"` after the change
- THEN it MUST capture the new DOM state and diff against the before snapshot
- AND MUST report: added elements, removed elements, style changes per selector

#### Scenario: Selector resolution

- GIVEN `etch` is initialized
- WHEN the before-state is captured
- THEN selectors MUST be resolved ONCE at start and reused for after-state
- This guarantees a consistent before/after diff even if the DOM structure changes

### Requirement: Browser Lifecycle

The system MUST reuse browser instances across annotate/etch calls within a session. A new browser MUST be launched only when no existing instance is available.

#### Scenario: Browser reuse

- GIVEN a browser instance is already running for the current session
- WHEN `annotate` or `etch` is called again
- THEN the existing browser MUST be reused (no new Chromium launch)

#### Scenario: Browser cleanup

- GIVEN a browser instance exists
- WHEN the session ends or the tool errors
- THEN the browser MUST be closed and the instance removed from the pool

### Requirement: Non-Functional

- Browser launch MUST complete in < 3 seconds
- Screenshot capture MUST complete in < 1 second
- Memory usage MUST remain < 500MB per browser instance
- Screenshots MUST be JPEG, < 2MB

## Implementation

| Component                    | File                         |
| ---------------------------- | ---------------------------- |
| Annotate tool (picker mode)  | `src/tool/annotate.ts`       |
| Etch tool (mutation capture) | `src/tool/etch.ts`           |
| Browser lifecycle management | `src/tool/browser.ts`        |
| Shared types                 | `src/tool/annotate-types.ts` |
| Picker overlay prompt        | `src/tool/annotate.txt`      |

## Status

✅ **Fully implemented.** All requirements above are code-verified against the implementation files.
