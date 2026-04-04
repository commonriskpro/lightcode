# pi-annotate Specification

> Requirements and scenarios for visual UI annotation tool.

---

## 1. Overview

**Purpose**: Enable AI-assisted visual markup of web pages within LightCode  
**Tool Name**: `/annotate`  
**Technology**: Puppeteer + Chrome DevTools Protocol (CDP)

---

## 2. Requirements

### 2.1 Core Requirements

| ID  | Requirement                     | Priority | Notes                      |
| --- | ------------------------------- | -------- | -------------------------- |
| R1  | Open any URL in headless Chrome | MUST     | Validate URL format        |
| R2  | Capture full-page screenshot    | MUST     | Base64 encoded             |
| R3  | Inspect DOM elements            | MUST     | Tag, text, attributes      |
| R4  | Calculate box model             | MUST     | top, left, width, height   |
| R5  | Generate CSS selectors          | MUST     | Unique per element         |
| R6  | Generate XPath                  | SHOULD   | Alternative selector       |
| R7  | Extract accessibility info      | SHOULD   | ARIA role, name            |
| R8  | Capture computed styles         | SHOULD   | Key properties only        |
| R9  | Per-element screenshots         | SHOULD   | Element crop               |
| R10 | Add notes to elements           | SHOULD   | Multiple notes per element |
| R11 | Edit capture (Etch mode)        | COULD    | MutationObserver           |

### 2.2 Non-Functional Requirements

| ID   | Requirement         | Target       |
| ---- | ------------------- | ------------ |
| NFR1 | Browser launch time | < 3 seconds  |
| NFR2 | Screenshot capture  | < 1 second   |
| NFR3 | Memory usage        | < 500MB      |
| NFR4 | Screenshot size     | < 2MB (JPEG) |

---

## 3. User Scenarios

### 3.1 Basic Annotation

```
Scenario: User annotates a button element
Feature: Element Picker

Given I'm in a LightCode session editing a frontend project
When I run /annotate https://example.com
Then LightCode opens the URL in headless Chrome
And captures a full-page screenshot
And lists the interactive elements

When I select the "Sign In" button
Then LightCode captures:
- Element selector: #login-btn
- Element XPath: //button[@id='login-btn']
- Element tag: button
- Element text: "Sign In"
- Box model: { top: 100, left: 200, width: 120, height: 44 }
- Accessibility: { role: "button", name: "Sign In" }

When I add a note "Update to primary color"
Then the annotation includes the note

When I complete the annotation
Then the LLM context includes the structured output
```

### 3.2 Multi-Element Selection

```
Scenario: User annotates a navigation menu
Feature: Multiple Selection

Given I'm annotating https://example.com
When I select all menu items (Home, About, Contact, Blog)
Then each element is captured with its own annotation
And the output includes all 4 annotated elements

When I add a note to each:
- Home: "Current page"
- About: "Needs content update"
- Contact: "Add form link"
- Blog: "New section needed"

Then the annotation includes all notes per element
```

### 3.3 Per-Element Screenshots

```
Scenario: User needs individual element images
Feature: Element Crop

Given I'm annotating https://example.com
When I select the hero image
And I enable per-element screenshots
Then the output includes:
- Full-page screenshot (base64)
- Hero image crop (base64)

When I select the logo
Then the output includes:
- Logo crop (base64)
```

### 3.4 Edit Capture (Etch Mode)

```
Scenario: User captures CSS changes
Feature: Etch Mode

Given I'm in a LightCode session
When I run /annotate https://example.com --mode etch
Then LightCode captures the "before" state:
- Full-page screenshot
- Computed styles for key elements

When I make CSS changes via DevTools (or page.evaluate)
Then MutationObserver detects the changes

When I complete the etch session
Then LightCode captures the "after" state
And generates a diff:
- Changed properties
- Before/after values
- Visual comparison
```

### 3.5 Invalid URL

```
Scenario: User provides invalid URL
Feature: Input Validation

Given I'm in a LightCode session
When I run /annotate "not-a-url"
Then LightCode returns an error:
"Invalid URL format. Please provide a valid URL starting with http:// or https://"

When I run /annotate "https://"
Then LightCode returns an error:
"URL cannot be empty"
```

### 3.6 Page Load Timeout

```
Scenario: Page fails to load
Feature: Error Handling

Given I'm annotating https://slow-site.example.com
When the page takes longer than 30 seconds
Then LightCode returns an error:
"Page load timeout. The site may be slow or unavailable."

When I run /annotate https://invalid-domain-12345.com
Then LightCode returns an error:
"Failed to load page. Check the URL and your connection."
```

---

## 4. Output Format

### 4.1 Annotation Result

```json
{
  "type": "annotation",
  "url": "https://example.com",
  "title": "Example Domain",
  "timestamp": 1712236800000,
  "mode": "picker",
  "screenshot": "data:image/png;base64,iVBORw0KG...",
  "elements": [
    {
      "selector": "#main-nav > li:nth-child(1) > a",
      "xpath": "//nav[@id='main-nav']/ul/li[1]/a",
      "tag": "a",
      "text": "Home",
      "box": {
        "top": 10,
        "left": 20,
        "width": 80,
        "height": 40,
        "padding": { "top": 0, "right": 10, "bottom": 0, "left": 10 },
        "border": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
        "margin": { "top": 0, "right": 20, "bottom": 0, "left": 0 }
      },
      "accessibility": {
        "role": "link",
        "name": "Home",
        "live": ""
      },
      "styles": {
        "display": "inline-block",
        "position": "relative",
        "color": "rgb(0, 0, 238)"
      },
      "notes": ["Primary navigation link"],
      "screenshot": "data:image/png;base64,iVBORw0KG..."
    }
  ]
}
```

### 4.2 Etch Result

```json
{
  "type": "etch",
  "url": "https://example.com",
  "timestamp": 1712236800000,
  "before": {
    "screenshot": "data:image/png;base64,iVBORw0KG...",
    "styles": {
      "#main-header": { "backgroundColor": "white", "color": "black" }
    }
  },
  "after": {
    "screenshot": "data:image/png;base64,iVBORw0KG...",
    "styles": {
      "#main-header": { "backgroundColor": "black", "color": "white" }
    }
  },
  "changes": [
    {
      "selector": "#main-header",
      "property": "backgroundColor",
      "before": "white",
      "after": "black"
    },
    {
      "selector": "#main-header",
      "property": "color",
      "before": "black",
      "after": "white"
    }
  ]
}
```

---

## 5. Edge Cases

| Case                    | Expected Behavior                           |
| ----------------------- | ------------------------------------------- |
| Empty page              | Return empty elements array with screenshot |
| Dynamic content         | Wait for `networkidle2` before capture      |
| Hidden elements         | Include but mark with `visibility: hidden`  |
| Iframe content          | Not captured (cross-origin restriction)     |
| Large page              | Full-page screenshot with clipping          |
| No interactive elements | Return page info without elements           |

---

## 6. Acceptance Criteria

### AC1: Basic Annotation

- [ ] `/annotate https://example.com` opens the page
- [ ] Screenshot is captured and included in output
- [ ] At least 3 interactive elements are returned
- [ ] Each element has selector, xpath, tag, text, box

### AC2: Element Selection

- [ ] User can select a specific element by index
- [ ] Selected element is included in output with notes
- [ ] Multiple elements can be selected

### AC3: Error Handling

- [ ] Invalid URL shows clear error message
- [ ] Page load timeout shows clear error message
- [ ] Browser crash is handled gracefully

### AC4: Output Format

- [ ] Output is valid JSON
- [ ] Screenshot is valid base64
- [ ] Output is suitable for LLM context

### AC5: Performance

- [ ] Browser launches within 3 seconds
- [ ] Screenshot captured within 1 second
- [ ] Memory usage stays under 500MB

---

## 7. Test Cases

### TC1: Valid URL

```
Input: /annotate https://example.com
Expected: Opens page, returns annotation with screenshot
```

### TC2: Invalid URL

```
Input: /annotate not-a-url
Expected: Error "Invalid URL format..."
```

### TC3: Page Load

```
Input: /annotate https://example.com
Verify: Page title is captured
Verify: URL is correct in output
```

### TC4: Element Data

```
Input: /annotate https://example.com, select element 1
Verify: selector is non-empty string
Verify: xpath starts with //
Verify: tag is lowercase HTML tag
Verify: box has top, left, width, height >= 0
```

### TC5: Etch Mode

```
Input: /annotate https://example.com --mode etch
Action: Make CSS change
Action: Complete etch session
Verify: changes array is not empty
Verify: before/after screenshots are different
```
