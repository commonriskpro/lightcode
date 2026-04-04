---
description: Visual UI annotation with Puppeteer (picker/etch)
---

Run the `annotate` tool directly (no `bun --eval`) using this syntax:

`/annotate <url> [--mode picker|etch] [--max N] [--selectors sel1,sel2] [--track sel1,sel2] [--wait ms] [--shots] [--headed true|false] [--script "js"]`

Rules:

1. `<url>` is required.
2. Default mode is `picker`.
3. `--shots` means `elementScreenshots: true`.
4. `--headed` defaults to `true` (visible browser for visual picking).
5. In `etch` mode, use `--track` if provided; fallback to `--selectors`.
6. Parse comma-separated selector lists into arrays.
7. Return a compact summary plus the raw JSON result.

Use the tool with params equivalent to:

```json
{
  "url": "https://example.com",
  "mode": "picker",
  "headed": true,
  "max": 30,
  "selectors": ["button.primary"],
  "track": ["h1"],
  "wait": 1500,
  "elementScreenshots": false,
  "fullPage": true,
  "script": "document.body.style.outline='2px solid red'"
}
```

Then print:

- URL and page title
- Mode used
- Element count (`picker`) or style-change/mutation counts (`etch`)
- 3-5 key findings (selectors, accessibility roles, notable style diffs)

User input:

$ARGUMENTS
