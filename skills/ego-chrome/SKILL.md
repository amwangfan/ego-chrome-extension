---
name: ego-chrome
description: Control the user's currently running Chrome profile through the local ego-chrome extension and CLI. Use for browser tasks that need existing login state, opening tabs, reading pages with compact semantic snapshots, clicking, filling forms, choosing items in dynamic menus, extracting data, or testing websites. Prefer semantic text snapshots and targeted DOM reads; do not use screenshots unless the user explicitly requests visual inspection and another tool is available.
metadata:
  version: "0.1.2"
---

# ego-chrome

`ego-chrome` exposes the user's current Chrome profile to Codex through a local CLI. It reuses existing site login state and returns compact semantic text instead of screenshots.

## Preflight

For the first browser task in a session, run:

```powershell
ego-chrome --doctor
```

If `extension` is not `connected`, tell the user to open Chrome, verify the extension token, and click the extension icon. Do not repeatedly retry a disconnected extension.

## Invocation

On PowerShell, pipe one JavaScript here-string to the CLI:

```powershell
@'
await browser.openTab('https://example.com', { active: false, wait: true })
console.log(await page.snapshot())
'@ | ego-chrome nodejs
```

On Bash-compatible shells:

```bash
ego-chrome nodejs <<'EOF'
await browser.openTab('https://example.com', { active: false, wait: true })
console.log(await page.snapshot())
EOF
```

Keep predictable observations, actions, waits, extraction, and verification in one invocation.

## Explicit tab selection

Every CLI invocation must explicitly select an automation tab before using `page.*`.

Choose exactly one:

```javascript
await browser.openTab(url, { active: false, wait: true })
await browser.openOrReuseTab(url, { active: false, match: 'exact', wait: true })
await browser.continueLastTab()
await browser.useActiveTab()
await browser.useTab(tabId)
```

Use them as follows:

- When the user says to **open** a new site or destination, call `browser.openTab()`. It creates a new background tab and does not overwrite another page.
- Use `browser.openOrReuseTab()` only when the user explicitly asks to reuse an existing tab or avoid duplicates.
- Use `browser.continueLastTab()` only for a follow-up invocation that must continue the previous automation tab.
- Use `browser.useActiveTab()` only when the user explicitly refers to the currently visible Chrome tab.
- Use `page.goto()` only after a tab has been selected, and only to navigate within that chosen workflow tab.

The runtime intentionally refuses `page.*` when no automation tab was selected. Do not work around this safety check by listing tabs and guessing an ID.

## Route selection

Choose the least-stateful reliable route that satisfies the requested outcome.

- When a stable URL directly encodes the requested state and the user did not ask to test the interaction itself, navigate directly and verify the result.
- Use page controls when the interaction is requested, under test, or no reliable URL is known.
- Never invent an undocumented URL merely to avoid interacting with a page.

## Observation policy

1. Use `page.snapshot()` to understand an unfamiliar page.
2. Prefer a compact character budget; use `page.snapshot({ maxChars: 12000 })` unless less is enough.
3. Never dump complete HTML merely to inspect controls.
4. After structure is known, use `page.evaluate`, `page.textContent`, `page.count`, or semantic locators for targeted reads.
5. Re-snapshot after navigation or a major DOM replacement before reusing `@N` refs.
6. A snapshot ref is temporary. Do not hardcode it or carry it across CLI invocations.
7. Screenshots are not part of this skill. For canvas, WebGL, maps, remote desktops, and visual-only editors, report the semantic limitation rather than guessing coordinates.

## Dynamic menus and text controls

For menus, popups, custom elements, account choosers, listboxes, and other dynamic UI, do not assume that a CSS class or a synthetic JavaScript event is enough.

Use the generic semantic text helpers:

```javascript
const matches = await page.findText('Settings', {
  exact: false,
  selector: '[role="menuitem"], [role="option"], button, a, li',
})

await page.clickText('Settings', {
  exact: true,
  selector: '[role="menuitem"], button, a, li',
})

await page.getByText('Continue', { exact: true }).click()
```

`findText()` returns a compact list of visible candidates. `clickText()` marks the selected visible element and finishes with a real CDP mouse click, so normal browser behavior and framework handlers run.

When several candidates match, inspect the compact candidate list and pass `nth`. Do not expose unrelated private text in the final response.

Do not stop merely because a menu, popup, chooser, or dialog opened. Continue through ordinary selections. Ask the user to intervene only when the page requests a password, passkey, CAPTCHA, security key, two-factor code, recovery confirmation, payment authorization, destructive confirmation, or another genuine human/secret checkpoint.

## Navigation waits

`page.waitForLoadState()` only checks whether the current document is ready. Immediately after a click or Enter key, the old document may still report `complete`, so it does not prove that navigation occurred.

For actions expected to navigate, start the URL or result-element wait before the action:

```powershell
@'
await browser.openTab('https://www.google.com/', { active: false, wait: true })
const search = page.locator('textarea[name=q], input[name=q]')
const query = 'youtube'
const navigated = page.waitForURL(
  (url) => url.pathname === '/search' && url.searchParams.get('q') === query,
  { timeout: 15000 },
)
await search.fill(query)
await search.press('Enter')
if (!(await navigated)) throw new Error('Search did not navigate to the expected result URL')
console.log({ url: await page.url(), title: await page.title() })
'@ | ego-chrome nodejs
```

Locator `press()` focuses the element and sends a trusted CDP key event. Prefer it over `page.press()` when focus matters.

## Reliable workflow

Use the smallest read that determines the next action, then verify the requested final state.

```powershell
@'
await browser.openTab('https://example.com/profile', { active: false, wait: true })
console.log(await page.snapshot({ maxChars: 3000 }))
await page.fill('@1', 'New name')
await page.click('@2')
const saved = await page.waitForSelector('.success', { state: 'visible', timeout: 10000 })
if (!saved) throw new Error('Save confirmation did not appear')
console.log({ url: await page.url(), confirmation: await page.textContent('.success') })
'@ | ego-chrome nodejs
```

Do not treat a successful click as proof of task completion. Read the resulting URL, identity, value, message, row, or other postcondition.

## API

### Browser

```javascript
await browser.listTabs()
await browser.currentTab()
await browser.openTab(url, { active: false, wait: true })
await browser.openOrReuseTab(url, { active: false, match: 'exact', wait: true })
await browser.continueLastTab()
await browser.useActiveTab()
await browser.useTab(tabId)
await browser.closeTab(tabId)
await browser.activateTab(tabId)
```

Match modes: `exact`, `origin`, `origin+path`, and `includes`.

### Page

```javascript
await page.snapshot({ maxChars: 12000, includeText: true })
await page.click('@1')
await page.click('button[type=submit]')
await page.fill('@2', 'value')
await page.findText('Menu item', { exact: false })
await page.clickText('Menu item', { exact: true, nth: 0 })
await page.getByText('Continue', { exact: true }).click()
await page.press('Enter')
await page.goto('https://example.com')
await page.info()
await page.url()
await page.title()
await page.evaluate(() => document.title)
await page.textContent('.message')
await page.count('table tbody tr')
await page.waitForSelector('.ready', { state: 'visible', timeout: 10000 })
await page.waitForURL('/complete', { timeout: 10000 })
await page.waitForURL(/\/orders\/\d+$/, { timeout: 10000 })
await page.waitForURL((url) => url.searchParams.get('saved') === '1')
await page.waitForLoadState({ timeout: 20000 })
await page.waitForTimeout(250)
```

Basic CSS locator facade:

```javascript
const email = page.locator('input[name=email]')
await email.fill('me@example.com')
await email.press('Enter')
await page.locator('button[type=submit]').click()
const status = await page.locator('.status').textContent()
```

### Task spaces

```javascript
const task = await taskSpaces.useOrCreate('short goal name')
await taskSpaces.complete(task.name, { keep: true })
```

Task spaces are optional compatibility labels inside one CLI invocation. They do not isolate cookies, local storage, tabs, or site sessions. Do not add them to simple tasks merely for ceremony.

## Failure handling

- `EXTENSION_DISCONNECTED`: stop and ask the user to reconnect the extension.
- `ATTACH_FAILED`: the tab may have DevTools or another debugger attached. Ask the user to close it.
- `STALE_REF`: take one new snapshot and select a new ref.
- `ELEMENT_NOT_FOUND`: verify page state, then use a compact snapshot, `findText()`, or a stable selector.
- `UNSUPPORTED_URL`: Chrome internal pages cannot be controlled.
- `No automation tab selected`: choose the correct explicit browser tab method; never attach to an arbitrary tab as a fallback.

Do not loop on the same failing action. Use the error to change strategy once, then report the boundary if the page remains unsupported.
