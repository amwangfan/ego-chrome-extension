---
name: ego-chrome
description: Control the user's current Chrome profile through the local ego-chrome extension and CLI. Use for website navigation, forms, dynamic menus, extraction, and browser testing that benefit from existing login state. Minimize tool rounds and model input: keep predictable work in one invocation, prefer targeted DOM reads, use compact semantic snapshots only when needed, and never use screenshots unless the user explicitly requests visual inspection and another tool is available.
metadata:
  version: "0.2.0"
---

# ego-chrome

`ego-chrome` exposes the user's running Chrome profile through a local CLI. It reuses existing login state and operates background tabs with semantic text instead of screenshots.

## Execution model

Run the first real browser operation immediately. Do not run `ego-chrome --doctor` before every task. Use `--doctor` only after a connection or extension error.

On PowerShell:

```powershell
@'
await browser.openTab('https://example.com', { active: false, wait: true })
const result = { title: await page.title(), url: await page.url() }
console.log(JSON.stringify(result))
'@ | ego-chrome nodejs
```

A here-string is only the JavaScript container. **Default to one shell invocation for the whole browser task.** Encode every predictable read, branch, action, wait, extraction, fallback, and verification in that script. Use JavaScript variables, conditions, loops, and bounded alternatives instead of exiting after each action.

Start another invocation only when:

- the prior output is genuinely required for an unpredictable decision;
- the user must complete a real secret or human-verification checkpoint;
- the process failed and cannot recover in-process.

Do not print intermediate snapshots, candidate dumps, or progress logs. Print one small final JSON object containing only requested results and verification evidence.

## Explicit tab selection

Every invocation must select a tab before using `page.*`:

```javascript
await browser.openTab(url, { active: false, wait: true })
await browser.openOrReuseTab(url, { active: false, match: 'exact', wait: true })
await browser.continueLastTab()
await browser.useActiveTab()
await browser.useTab(tabId)
```

- “Open” means `browser.openTab()` in a new background tab.
- Reuse only when the user asks for it or duplicate avoidance matters.
- `continueLastTab()` is only for a necessary follow-up invocation.
- `useActiveTab()` is only for an explicit reference to the visible tab.
- `page.goto()` navigates the already selected workflow tab; it never selects one.

## Lowest-token observation ladder

Use the lowest rung that can determine the next action:

1. Known URL, selector, or final-state read.
2. Targeted locator collection: `count`, `allInnerTexts`, `evaluateAll`, `inputValue`, `getAttribute`.
3. Bounded text candidates: `page.findText(...)`.
4. Incremental change: `page.observe()` after an earlier snapshot/observe.
5. Compact snapshot: `page.snapshot()` only for an unfamiliar state.
6. Normal snapshot only when compact output is inadequate.

Never dump full HTML. Never use a broad `querySelectorAll('*')` dump. Bound collection outputs and map them to only fields needed for the task.

### Snapshot modes

```javascript
await page.snapshot()                                  // compact, ~3500 chars
await page.snapshot({ mode: 'compact', maxChars: 2000 })
await page.snapshot({ mode: 'normal', maxChars: 12000 })
```

Compact is the default and omits most body text. Do not request `debug` mode during normal agent work.

Do not snapshot after every action. Re-snapshot only after navigation, a major DOM replacement, a stale ref, or a materially unknown state.

### Incremental observation

After a baseline snapshot or observe, use:

```javascript
const change = await page.observe({ maxChanges: 12 })
```

It returns compact `added` and `removed` lines. On first observation or a large change it can include a compact snapshot. Prefer this over another full snapshot when checking what changed after an action.

## Outcome-first behavior

Choose the least-stateful reliable route before inspecting controls.

- When a stable URL reliably encodes the requested outcome and the interaction itself is not required, navigate directly and verify the goal state.
- Use controls when the user requested the interaction, the interaction is under test, or no reliable route is known.
- Never invent undocumented routes.

Before changing a control, perform only the smallest read needed to see whether the requested state is already satisfied. If it is, do not replay the action.

A successful click is not completion evidence. Verify the required URL, selected value, message, record, or other postcondition before the command exits.

## In-process branching pattern

```powershell
@'
await browser.openTab('https://example.com/settings', { active: false, wait: true })

const name = page.locator('input[name=displayName]')
const current = await name.inputValue()
if (current !== 'New name') {
  await name.fill('New name')
  await page.locator('button[type=submit]').click()
  const saved = await page.waitForSelector('.success', { state: 'visible', timeout: 10000 })
  if (!saved) throw new Error('Save confirmation did not appear')
}

console.log(JSON.stringify({ url: await page.url(), value: await name.inputValue() }))
'@ | ego-chrome nodejs
```

## Dynamic interfaces

For menus, popups, choosers, listboxes, dialogs, and nested custom elements, use generic bounded helpers instead of site-specific scripts:

```javascript
const candidates = await page.findText('Settings', {
  exact: false,
  selector: '[role="menuitem"], [role="option"], button, a, li',
  maxResults: 10,
})

if (!candidates.count) throw new Error('Settings action was not found')
await page.clickText('Settings', {
  exact: true,
  selector: '[role="menuitem"], button, a, li',
})
```

When multiple matches exist, inspect the compact candidate list in JavaScript and choose `nth` there. Do not print unrelated private text.

Ordinary account selection, menus, popups, and dialogs remain automatable. Ask the user only for passwords, passkeys, CAPTCHAs, security keys, two-factor codes, recovery confirmation, payment authorization, destructive confirmation, or another genuine human/secret checkpoint.

## Waits and recovery

Start URL or result-state waits before the triggering action:

```javascript
const navigated = page.waitForURL((url) => url.pathname === '/results', { timeout: 15000 })
await page.locator('input[type=search]').fill('query')
await page.locator('input[type=search]').press('Enter')
if (!(await navigated)) throw new Error('Expected navigation did not occur')
```

`waitForLoadState()` only checks the current document. It does not prove a newly triggered navigation happened.

On failure, make one targeted observation that materially changes strategy. Do not repeat near-identical selector guesses or snapshots. Prefer a stable semantic/text/DOM route based on the evidence, then stop and report the boundary if it still fails.

## API highlights

```javascript
await page.snapshot({ mode: 'compact', maxChars: 3500 })
await page.observe({ maxChanges: 20 })
await page.findText('Continue', { maxResults: 10 })
await page.clickText('Continue', { exact: true })

const rows = page.locator('table tbody tr')
await rows.count()
await rows.allInnerTexts()
await rows.evaluateAll((nodes) => nodes.map((node) => ({
  id: node.getAttribute('data-id'),
  text: node.innerText,
})))
await rows.first().innerText()
await rows.nth(1).click()
```

Snapshot `@N` refs are valid only for the latest snapshot in the current invocation. Prefer stable selectors or semantic locators for reusable logic.

`taskSpaces` are compatibility labels only in this project. Do not add them to simple tasks; they do not isolate tabs or sessions.
