# ego-chrome-extension

A personal, local-first Chrome extension and Codex skill for browser automation with two priorities:

1. reuse the login state in your current Chrome profile;
2. keep model input small with semantic text snapshots instead of screenshots.

The project is inspired by ego-lite's interaction model, but it does not ship or modify Chromium. A Manifest V3 extension attaches to selected tabs through `chrome.debugger`, reads the accessibility tree plus a compact DOM fallback, and exposes a small Playwright-like JavaScript API through the `ego-chrome` CLI.

## MVP capabilities

- Reuses current Chrome cookies, site storage, extensions, and logged-in sessions.
- Opens automation tabs in the background by default.
- Produces compact semantic snapshots with temporary `@N` references.
- Clicks and fills elements by snapshot ref or CSS selector.
- Supports navigation, trusted key presses, URL waits, page evaluation, targeted text extraction, selectors, and waits.
- Remembers the last selected automation tab across CLI invocations while the bridge is running.
- Includes an installable Codex skill under `skills/ego-chrome`.
- Does not expose screenshot capture in its default API.

## Architecture

```text
Codex
  │
  │ JavaScript piped to ego-chrome
  ▼
Local Node CLI ── HTTP RPC ── Local bridge ── long poll ── Chrome MV3 extension
                                                             │
                                                             ▼
                                                   chrome.debugger / CDP
                                                             │
                                                             ▼
                                                   current Chrome profile
```

The bridge binds only to `127.0.0.1` and requires a random 256-bit token. The extension stores the token in `chrome.storage.local` and maintains a localhost long-poll connection to the bridge. This avoids Windows Native Messaging registration and is intended for personal use on one machine.

## Requirements

- Windows 10 or 11.
- Google Chrome 120 or newer.
- Node.js 20 or newer.
- Codex with Agent Skills support.

## Install

### 1. Clone and install the CLI

```powershell
git clone https://github.com/amwangfan/ego-chrome-extension.git
cd ego-chrome-extension
npm install
npm link
```

`npm link` makes `ego-chrome` available globally for the current Node installation.

### 2. Create the bridge token

```powershell
ego-chrome init
```

The configuration is stored at:

```text
%LOCALAPPDATA%\ego-chrome\config.json
```

Copy the 64-character token printed by the command.

### 3. Load the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this repository's `extension` directory.
5. Open the extension's **Details**, then **Extension options**.
6. Paste the token from `ego-chrome init` and save.

The toolbar badge shows:

- `ON`: connected to the local bridge;
- `OFF`: the bridge is not running, the token is missing, or the connection failed;
- `…`: connecting.

The CLI starts the local bridge automatically on first use. Clicking the extension icon requests a reconnect.

### 4. Check the connection

```powershell
ego-chrome --doctor
```

A healthy result resembles:

```json
{
  "bridge": "connected",
  "extension": "connected",
  "tabs": 8,
  "port": 32145
}
```

### 5. Install the Codex skill

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-skill.ps1
```

The script copies the skill to:

```text
~\.agents\skills\ego-chrome
```

Restart Codex after installation.

When updating the repository, run the install script again so Codex receives the latest `SKILL.md`.

## Direct CLI usage

PowerShell uses a here-string piped to the CLI:

```powershell
@'
await browser.openOrReuseTab('https://example.com', {
  active: false,
  wait: true,
})
console.log(await page.snapshot({ maxChars: 2500 }))
'@ | ego-chrome nodejs
```

Bash-compatible shells can use a heredoc:

```bash
ego-chrome nodejs <<'EOF'
await browser.openOrReuseTab('https://example.com', { active: false, wait: true })
console.log(await page.snapshot({ maxChars: 2500 }))
EOF
```

## Google search example

For an outcome-oriented search, use the stable result URL instead of replaying the homepage UI:

```powershell
@'
const query = 'youtube'
const url = new URL('https://www.google.com/search')
url.searchParams.set('q', query)
await browser.openOrReuseTab(url.href, { active: false, wait: true })
if (!(await page.waitForURL((value) => value.searchParams.get('q') === query, { timeout: 10000 }))) {
  throw new Error('Search URL was not reached')
}
console.log({ url: await page.url(), title: await page.title() })
'@ | ego-chrome nodejs
```

When the interaction itself is being tested, fill the search control and wait for the resulting URL:

```powershell
@'
await browser.openOrReuseTab('https://www.google.com/', { active: false, wait: true })
const query = 'youtube'
const search = page.locator('textarea[name=q], input[name=q]')
const navigated = page.waitForURL(
  (url) => url.pathname === '/search' && url.searchParams.get('q') === query,
  { timeout: 15000 },
)
await search.fill(query)
await search.press('Enter')
if (!(await navigated)) throw new Error('Google search did not navigate')
console.log({ url: await page.url(), title: await page.title() })
'@ | ego-chrome nodejs
```

`page.waitForLoadState()` checks the current document's readiness. It can return before a newly triggered navigation starts, so use `page.waitForURL()` or a result selector to verify action-triggered navigation.

## Snapshot format

A typical result looks like:

```text
page "Account settings" url="https://example.com/account"
main
  heading "Profile" [level=1]
  @1 textbox "Display name" [value="Example User"]
  @2 button "Save"
```

Refs are temporary. A new snapshot rebuilds them, and navigation may make older refs stale.

The snapshot engine uses:

1. `Accessibility.getFullAXTree` for roles, accessible names, values, and states;
2. `DOMSnapshot.captureSnapshot` to recover meaningful clickable elements omitted by the accessibility tree;
3. `backendDOMNodeId` references for actions.

No image is sent to Codex.

## API

### `browser`

```javascript
await browser.listTabs()
await browser.currentTab()
await browser.useTab(tabId)
await browser.openOrReuseTab(url, { active: false, match: 'exact', wait: true })
await browser.openTab(url, { active: false, wait: true })
await browser.closeTab(tabId)
await browser.activateTab(tabId)
```

The bridge remembers the selected tab across CLI invocations while it remains running. This removes the need to call `browser.listTabs()` and manually copy a tab ID after every command.

Matching modes are `exact`, `origin`, `origin+path`, and `includes`.

### `page`

```javascript
await page.snapshot({ maxChars: 12000, includeText: true })
await page.click('@1')
await page.click('button[type=submit]')
await page.fill('@2', 'value')
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

Locator facade:

```javascript
const email = page.locator('input[name=email]')
await email.fill('me@example.com')
await email.press('Enter')
await page.locator('button[type=submit]').click()
const status = await page.locator('.status').textContent()
```

Locator `press()` focuses the element and sends a trusted CDP key event, so it can trigger normal browser default behavior such as form submission.

### `taskSpaces`

```javascript
const task = await taskSpaces.useOrCreate('short goal name')
await taskSpaces.complete(task.name, { keep: true })
```

Task spaces are optional compatibility labels inside one CLI invocation. They do not isolate cookies, local storage, tabs, or site sessions.

## Token-saving behavior

The bundled skill tells Codex to:

- use `page.snapshot()` instead of screenshots;
- avoid dumping raw HTML;
- keep snapshots under 12,000 characters by default;
- prefer a stable result URL when the requested outcome can be encoded reliably;
- use targeted reads after page structure is known;
- keep predictable actions and verification in one invocation;
- take another snapshot only when the new page state must be understood.

## Login state and privacy

The extension controls tabs inside your current Chrome profile, so sites see the same login cookies and storage as your normal tabs.

The project does not export cookies or credentials. Snapshot content and explicit page reads are returned to the local Codex process because Codex needs that information to perform the requested task.

Treat the extension's `debugger` permission as sensitive. Rotate the bridge token with:

```powershell
ego-chrome init --force
```

Then update the token in the extension options.

## Troubleshooting

### Badge stays `OFF`

Run:

```powershell
ego-chrome --doctor
```

Verify that the extension options contain the same token and port as `%LOCALAPPDATA%\ego-chrome\config.json`, then click the extension icon.

### `Another debugger is already attached`

Close DevTools for that tab and temporarily disable other browser automation extensions.

### `Unknown or stale ref`

The page changed after the last snapshot. Take one new snapshot and use the new ref.

### Action succeeded but Codex ran extra commands

Verify the postcondition with `page.waitForURL()` or `page.waitForSelector()` in the same invocation. `page.waitForLoadState()` alone does not prove that an action-triggered navigation occurred.

### Port 32145 is already in use

Change `port` in `%LOCALAPPDATA%\ego-chrome\config.json`, then enter the same port in the extension options.

## Important limitations

- Opening DevTools or attaching another debugger to the same tab can disconnect automation.
- Deep cross-origin iframe snapshot merging is not implemented yet.
- Canvas, WebGL, maps, remote desktops, and visual-only surfaces are not semantically observable.
- Browser-internal pages such as `chrome://settings` cannot be controlled.
- Background tabs share the same cookie and storage state. This is intentional for login reuse, not security isolation.
- The selected tab survives separate CLI invocations only while the local bridge process remains running.
- The bridge is personal-use software and has not received a security audit.

## Development

```powershell
npm install
npm run check
npm test
```

After changing extension files, open `chrome://extensions` and click **Reload** on the extension card. After changing the skill, rerun `scripts/install-skill.ps1` and restart Codex.

## Roadmap

1. Recursive cross-origin iframe attachment and snapshot merging.
2. Incremental snapshot diffs.
3. Tab-group-backed task spaces.
4. Semantic locators such as `getByRole` and `getByLabel`.
5. Downloads, uploads, dialogs, and network waits.
6. Explicit visual fallback for exceptional pages, disabled by default.

## License

MIT
