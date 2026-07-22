---
name: ego-chrome
description: Control the user's currently running Chrome profile through the local ego-chrome extension and CLI. Use for browser tasks that need existing login state, opening tabs, reading pages with compact semantic snapshots, clicking, filling forms, choosing items in dynamic interfaces, extracting data, or testing websites. Prefer semantic text snapshots and targeted DOM reads; do not use screenshots unless the user explicitly requests visual inspection and another tool is available.
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

On PowerShell:

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

Every invocation must explicitly select an automation tab before using `page.*`.

Choose one:

```javascript
await browser.openTab(url, { active: false, wait: true })
await browser.openOrReuseTab(url, { active: false, match: 'exact', wait: true })
await browser.continueLastTab()
await browser.useActiveTab()
await browser.useTab(tabId)
```

Use them as follows:

- When the user says to open a new site or destination, call `browser.openTab()`. It creates a new background tab.
- Use `browser.openOrReuseTab()` only when reuse or duplicate avoidance is explicitly desired.
- Use `browser.continueLastTab()` only for a follow-up invocation that must continue the previous automation tab.
- Use `browser.useActiveTab()` only when the user explicitly refers to the currently visible Chrome tab.
- Use `page.goto()` only after selecting a tab and only for navigation within that chosen workflow.

The runtime intentionally refuses `page.*` when no tab was selected. Do not work around this by listing tabs and guessing an ID.

## Observation policy

1. Use `page.snapshot()` to understand an unfamiliar page.
2. Prefer a compact character budget; use `page.snapshot({ maxChars: 12000 })` unless less is enough.
3. Never dump complete HTML merely to inspect controls.
4. After structure is known, use targeted reads or semantic locators.
5. Re-snapshot after navigation or a major DOM replacement before reusing `@N` refs.
6. Snapshot refs are temporary; do not hardcode or carry them across invocations.
7. Screenshots are not part of this skill. For visual-only surfaces, report the semantic limitation instead of guessing coordinates.

## Dynamic interfaces

For menus, popups, listboxes, dialogs, and nested custom elements, prefer the generic text helpers when a stable selector is not obvious:

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

`findText()` returns compact visible candidates. `clickText()` marks the selected visible element and finishes with the normal CDP-backed mouse click.

When multiple candidates match, inspect the compact list and pass `nth`. Do not expose unrelated private text in the final response.

Do not stop merely because an ordinary menu, popup, chooser, or dialog opened. Continue through normal selections. Ask the user to intervene only when a genuine secret, human-verification, payment-authorization, or destructive-confirmation checkpoint appears.

## Route and wait policy

Use a stable URL when it reliably encodes the requested outcome and the user did not ask to test the interaction itself. Otherwise use page controls. Never invent undocumented URLs.

`page.waitForLoadState()` checks the current document only. It does not prove that a click or key press triggered navigation. Start `page.waitForURL()` or `page.waitForSelector()` before the action:

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
if (!(await navigated)) throw new Error('Expected navigation did not occur')
console.log({ url: await page.url(), title: await page.title() })
'@ | ego-chrome nodejs
```

Locator `press()` focuses the element and sends a trusted CDP key event.

## Verification

Do not treat a successful click as proof of completion. Read the resulting URL, visible identity, value, message, row, or other postcondition.

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

CSS locator facade:

```javascript
const email = page.locator('input[name=email]')
await email.fill('me@example.com')
await email.press('Enter')
await page.locator('button[type=submit]').click()
```

### Task spaces

Task spaces are optional compatibility labels inside one invocation. Do not add them to simple tasks merely for ceremony.

## Failure handling

- `EXTENSION_DISCONNECTED`: stop and ask the user to reconnect the extension.
- `ATTACH_FAILED`: ask the user to close DevTools or another debugger on that tab.
- `STALE_REF`: take one new snapshot.
- `ELEMENT_NOT_FOUND`: verify page state, then use a compact snapshot, `findText()`, or a stable selector.
- `UNSUPPORTED_URL`: Chrome internal pages cannot be controlled.
- `No automation tab selected`: choose the correct explicit browser method; never attach to an arbitrary tab as a fallback.

Do not loop on the same failing action. Change strategy once, then report the boundary if the page remains unsupported.
