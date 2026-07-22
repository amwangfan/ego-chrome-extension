---
name: ego-chrome
description: Control the user's currently running Chrome profile through the local ego-chrome extension and CLI. Use for browser tasks that need existing login state, opening or reusing tabs, reading pages with compact semantic snapshots, clicking, filling forms, extracting data, or testing websites. Prefer semantic text snapshots and direct DOM reads; do not use screenshots unless the user explicitly requests visual inspection and another tool is available.
metadata:
  version: "0.1.1"
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
await browser.openOrReuseTab('https://example.com', { active: false, wait: true })
console.log(await page.snapshot())
'@ | ego-chrome nodejs
```

On Bash-compatible shells:

```bash
ego-chrome nodejs <<'EOF'
await browser.openOrReuseTab('https://example.com', { active: false, wait: true })
console.log(await page.snapshot())
EOF
```

Keep predictable observations, actions, waits, extraction, and verification in one invocation. The bridge remembers the last selected automation tab across CLI invocations, but a single invocation is still cheaper and less error-prone.

## Route selection

Choose the least-stateful reliable route that satisfies the user's requested outcome.

- When a stable URL directly encodes the requested state and the user did not ask to test the interaction itself, navigate directly and verify the result.
- Use page controls when the user explicitly asked to perform the interaction, when the interaction is under test, or when no reliable URL is known.
- Never invent an undocumented URL merely to avoid interacting with the page.

For example, a normal Google search can use a stable search URL:

```powershell
@'
const query = 'youtube'
const url = new URL('https://www.google.com/search')
url.searchParams.set('q', query)
await browser.openOrReuseTab(url.href, { active: false, wait: true })
if (!(await page.waitForURL((value) => value.searchParams.get('q') === query, { timeout: 10000 }))) {
  throw new Error('Google search URL was not reached')
}
console.log({ url: await page.url(), title: await page.title() })
'@ | ego-chrome nodejs
```

## Observation policy

1. Use `page.snapshot()` to understand an unfamiliar page.
2. Prefer the default compact budget. Use `page.snapshot({ maxChars: 12000 })` unless a smaller result is enough.
3. Never dump complete HTML merely to inspect controls.
4. After page structure is known, use `page.evaluate`, `page.textContent`, `page.count`, or locators for targeted reads.
5. Re-snapshot after navigation or a major DOM replacement before reusing `@N` refs.
6. A snapshot ref is temporary. Do not hardcode it into reusable scripts or carry it across CLI invocations.
7. Screenshots are not part of this skill. For canvas, WebGL, maps, remote desktops, and visual-only editors, report the semantic limitation rather than guessing coordinates.

## Navigation waits

`page.waitForLoadState()` only checks whether the current document is ready. Immediately after a click or Enter key, the old document may still report `complete`, so it does not prove that navigation occurred.

For actions expected to navigate, wait for the expected URL or a specific result element:

```powershell
@'
await browser.openOrReuseTab('https://www.google.com/', { active: false, wait: true })
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
await browser.openOrReuseTab('https://example.com/profile', { active: false, wait: true })

const initial = await page.snapshot()
console.log(initial)

await page.fill('@1', 'New name')
await page.click('@2')

const saved = await page.waitForSelector('.success', { state: 'visible', timeout: 10000 })
if (!saved) throw new Error('Save confirmation did not appear')
console.log({ url: await page.url(), confirmation: await page.textContent('.success') })
'@ | ego-chrome nodejs
```

Do not treat a successful click as proof of task completion. Read the resulting URL, value, message, row, or other postcondition.

## API

### Browser

```javascript
await browser.listTabs()
await browser.currentTab()
await browser.useTab(tabId)
await browser.openOrReuseTab(url, { active: false, match: 'exact', wait: true })
await browser.openTab(url, { active: false, wait: true })
await browser.closeTab(tabId)
await browser.activateTab(tabId)
```

Leave `active: false` unless the user needs to see or manually control the page. Match modes: `exact`, `origin`, `origin+path`, and `includes`.

The bridge remembers the last selected tab. A later CLI invocation starts from that tab unless it was closed or the bridge restarted.

### Page

```javascript
await page.snapshot({ maxChars: 12000, includeText: true })
await page.click('@1')
await page.click('button[type=submit]')
await page.fill('@2', 'value')
await page.press('Enter')
await page.press('Control+A')
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

Basic locator facade:

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
- `ELEMENT_NOT_FOUND`: verify page state, then take one targeted snapshot or use a stable selector.
- `UNSUPPORTED_URL`: Chrome internal pages cannot be controlled.
- For authentication, captcha, payment confirmation, destructive actions, or other manual checkpoints, prepare the page in a background tab, activate it only when needed, and ask the user to complete the step.

Do not loop on the same failing action. Use the error to change strategy once, then report the boundary if the page remains unsupported.
