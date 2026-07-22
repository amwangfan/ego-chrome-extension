# ego-chrome-extension

A personal, local-first Chrome extension and Codex skill for browser automation with two priorities:

1. reuse the login state in your current Chrome profile;
2. keep model input small by using semantic text snapshots instead of screenshots.

The project is inspired by the interaction model of ego-lite, but it does not ship or modify Chromium. A Manifest V3 extension attaches to selected Chrome tabs through `chrome.debugger`, reads the accessibility tree plus a compact DOM fallback, and exposes a small Playwright-like JavaScript API to Codex through the `ego-chrome` CLI.

## What works in this MVP

- Uses the currently running Chrome profile, including existing cookies and logged-in sessions.
- Opens automation tabs in the background by default, so Codex does not steal the active tab.
- Produces compact text snapshots with `@N` references.
- Clicks and fills elements by snapshot ref or CSS selector.
- Supports navigation, key presses, page evaluation, text extraction, selectors, and waits.
- Includes an installable Codex skill under `skills/ego-chrome`.
- Does not expose screenshot capture in the default API.

## Architecture

```text
Codex
  │
  │ ego-chrome heredoc
  ▼
Local Node CLI ── WebSocket ── Local bridge ── WebSocket ── Chrome MV3 extension
                                                             │
                                                             ▼
                                                   chrome.debugger / CDP
                                                             │
                                                             ▼
                                                   current Chrome profile
```

The bridge binds only to `127.0.0.1` and requires a random token. The extension accepts the token through its options page. This is designed for personal use on one machine, not as a hardened multi-user service.

## Requirements

- Windows 10 or 11.
- Google Chrome.
- Node.js 20 or newer.
- Codex CLI or Codex app with Agent Skills support.

## Install

### 1. Clone and install the CLI

```powershell
git clone https://github.com/amwangfan/ego-chrome-extension.git
cd ego-chrome-extension
npm install
npm link
```

`npm link` makes the `ego-chrome` command available globally for the current Node installation.

### 2. Create the local bridge token

```powershell
ego-chrome init
```

The command prints a 64-character token. Keep the terminal open or copy the token.

The token is stored in:

```text
%LOCALAPPDATA%\ego-chrome\config.json
```

### 3. Load the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the repository's `extension` directory.
5. Open the extension's **Details**, then **Extension options**.
6. Paste the token from `ego-chrome init` and save.

The toolbar badge shows:

- `ON`: connected to the local bridge;
- `OFF`: bridge is not running or the token is missing;
- `…`: connecting.

The bridge starts automatically when the CLI is first used. Clicking the extension icon asks it to reconnect.

### 4. Check the connection

```powershell
ego-chrome --doctor
```

A healthy result looks like:

```json
{
  "bridge": "connected",
  "extension": "connected",
  "tabs": 8
}
```

If the extension is disconnected, keep Chrome open and click the extension icon once.

### 5. Install the Codex skill

From PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-skill.ps1
```

This copies the skill to:

```text
~\.agents\skills\ego-chrome
```

Restart Codex after installation.

Alternatively, ask Codex's skill installer to install the skill directory from GitHub:

```text
$skill-installer install https://github.com/amwangfan/ego-chrome-extension/tree/main/skills/ego-chrome
```

## Direct CLI usage

```powershell
ego-chrome <<'EOF'
const task = await taskSpaces.useOrCreate('check profile')
await browser.openOrReuseTab('https://github.com/settings/profile', {
  active: false,
  wait: true
})
console.log(await page.snapshot())
EOF
```

Typical snapshot:

```text
page "Your profile" url="https://github.com/settings/profile"
main
  heading "Public profile" [level=2]
  @1 textbox "Name" [value="Example User"]
  @2 textbox "Public email"
  @3 button "Update profile"
```

A follow-up action can stay in the same heredoc:

```powershell
ego-chrome <<'EOF'
await browser.openOrReuseTab('https://example.com/account', { active: false })
const snapshot = await page.snapshot()
console.log(snapshot)
await page.fill('@1', 'New display name')
await page.click('@2')
await page.waitForSelector('.success-message')
console.log(await page.textContent('.success-message'))
EOF
```

Refs are rebuilt by `page.snapshot()`. After navigation or a major DOM change, take a new snapshot before reusing refs.

## API

### `browser`

```javascript
await browser.listTabs()
await browser.currentTab()
await browser.useTab(tabId)
await browser.openOrReuseTab(url, { active: false, match: 'exact', wait: true })
await browser.openTab(url, { active: false })
await browser.closeTab(tabId)
await browser.activateTab(tabId)
```

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
await page.waitForLoadState({ timeout: 20000 })
await page.waitForTimeout(250)
```

Basic locator facade:

```javascript
await page.locator('input[name=email]').fill('me@example.com')
await page.locator('button[type=submit]').click()
const text = await page.locator('.status').textContent()
```

### `taskSpaces`

The MVP provides task-space-shaped helpers so the skill can keep a similar workflow:

```javascript
const task = await taskSpaces.useOrCreate('order lookup')
await taskSpaces.complete(task.name, { keep: true })
```

These are logical names only. They do not isolate cookies, local storage, tabs, or site sessions.

## Token-saving rules

The bundled skill tells Codex to:

- use `page.snapshot()` instead of screenshots;
- avoid dumping raw HTML;
- keep snapshots under 12,000 characters by default;
- use direct extraction with `page.evaluate()` after page structure is known;
- keep predictable actions and verification in one JavaScript heredoc;
- take another snapshot only when a new page state must be understood.

The snapshot engine uses:

1. `Accessibility.getFullAXTree` for roles, accessible names, values, and states;
2. `DOMSnapshot.captureSnapshot` only to recover meaningful clickable elements omitted by the accessibility tree;
3. `backendDOMNodeId` references for actions.

No image is sent to Codex.

## Login state and privacy

The extension controls tabs inside your current Chrome profile, so sites see the same login cookies and storage that your normal tabs use.

The project does not export cookies or credentials. Page content returned by snapshots and explicit reads is sent to the local Codex process because that is the information Codex needs to perform the requested browser task.

Treat the extension's `debugger` permission as sensitive. Only install code you have reviewed. Rotate the bridge token with:

```powershell
ego-chrome init --force
```

Then update the token in the extension options.

## Important limitations

- The extension uses `chrome.debugger`. Opening DevTools on the same tab or attaching another debugger can disconnect automation.
- The MVP snapshots the top-level document. Deep cross-origin iframe support is not implemented yet.
- Canvas, WebGL, remote desktops, maps, and other visual-only surfaces are not semantically observable.
- Browser-internal pages such as `chrome://settings` cannot be controlled.
- Background tabs share the same cookie and storage state. This is intentional for login reuse, but it is not security isolation.
- The bridge is personal-use software. It has localhost token authentication but has not received a security audit.

## Troubleshooting

### Badge stays `OFF`

Run:

```powershell
ego-chrome --doctor
```

Then verify that the extension options contain the same token as `%LOCALAPPDATA%\ego-chrome\config.json`.

### `Another debugger is already attached`

Close Chrome DevTools for that tab and disable other browser automation extensions temporarily.

### `Unknown or stale ref`

The page navigated or changed after the last snapshot. Call `page.snapshot()` again and use the new ref.

### Port 32145 is already used

Change `port` in `%LOCALAPPDATA%\ego-chrome\config.json`, then enter the same port in the extension options.

## Development

```powershell
npm install
npm test
npm run bridge
```

After changing extension files, open `chrome://extensions` and click **Reload** on the extension card.

## Roadmap

The most valuable next improvements are:

1. recursive cross-origin iframe attachment and snapshot merging;
2. incremental snapshot diffs;
3. tab-group-backed task spaces;
4. more semantic locators such as `getByRole` and `getByLabel`;
5. downloads, uploads, dialogs, and network waits;
6. an explicit visual fallback for exceptional pages, disabled by default.

## License

MIT
