# ego-chrome-extension

A personal, local-first Chrome extension and Codex skill for browser automation with two priorities:

1. reuse the login state in your current Chrome profile;
2. keep model input small by using semantic text snapshots instead of screenshots.

The project is inspired by ego-lite's interaction model, but it does not ship or modify Chromium. A Manifest V3 extension attaches to selected tabs through `chrome.debugger`, reads the accessibility tree plus a compact DOM fallback, and exposes a small Playwright-like JavaScript API through the `ego-chrome` CLI.

## MVP capabilities

- Reuses current Chrome cookies, site storage, extensions, and logged-in sessions.
- Opens automation tabs in the background by default.
- Produces compact semantic snapshots with temporary `@N` references.
- Clicks and fills elements by snapshot ref or CSS selector.
- Supports navigation, key presses, page evaluation, targeted text extraction, selectors, and waits.
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

The bridge binds only to `127.0.0.1` and requires a random 256-bit token. The extension stores the token in `chrome.storage.local` and maintains a localhost long-poll connection to the bridge. This avoids a Windows Native Messaging registration step and is intended for personal use on one machine.

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

The command writes the configuration to:

```text
%LOCALAPPDATA%\ego-chrome\config.json
```

It prints a 64-character hexadecimal token. Copy that token.

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

If the extension is disconnected, keep Chrome open, verify the token in the extension options, and click the extension icon once.

### 5. Install the Codex skill

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-skill.ps1
```

The script copies the skill to:

```text
~\.agents\skills\ego-chrome
```

Restart Codex after installation. The skill can also be installed from its GitHub directory with Codex's `$skill-installer`.

## Direct CLI usage

PowerShell uses a here-string piped to the CLI:

```powershell
@'
const task = await taskSpaces.useOrCreate('check profile')
await browser.openOrReuseTab('https://github.com/settings/profile', {
  active: false,
  wait: true
})
console.log(await page.snapshot())
await taskSpaces.complete(task.name, { keep: true })
'@ | ego-chrome nodejs
```

Bash-compatible shells can use a heredoc:

```bash
ego-chrome nodejs <<'EOF'
await browser.openOrReuseTab('https://example.com', { active: false, wait: true })
console.log(await page.snapshot())
EOF
```

A typical snapshot looks like:

```text
page "Your profile" url="https://github.com/settings/profile"
main
  heading "Public profile" [level=2]
  @1 textbox "Name" [value="Example User"]
  @2 textbox "Public email"
  @3 button "Update profile"
```

Refs are rebuilt by `page.snapshot()`. After navigation or a major DOM change, take a new snapshot before using refs again.

A full action and verification can remain in one invocation:

```powershell
@'
await browser.openOrReuseTab('https://example.com/account', { active: false, wait: true })
console.log(await page.snapshot())
await page.fill('@1', 'New display name')
await page.click('@2')
const saved = await page.waitForSelector('.success-message', {
  state: 'visible',
  timeout: 10000
})
if (!saved) throw new Error('Save confirmation did not appear')
console.log({
  url: await page.url(),
  message: await page.textContent('.success-message')
})
'@ | ego-chrome nodejs
```

For small commands, `-e` is also supported:

```powershell
ego-chrome -e "console.log(await browser.listTabs())"
```

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

URL match modes are `exact`, `origin`, `origin+path`, and `includes`.

### `page`

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
await page.waitForLoadState({ timeout: 20000 })
await page.waitForTimeout(250)
```

Basic locator facade:

```javascript
const email = page.locator('input[name=email]')
await email.fill('me@example.com')
await page.locator('button[type=submit]').click()
const text = await page.locator('.status').textContent()
```

### `taskSpaces`

```javascript
const task = await taskSpaces.useOrCreate('order lookup')
await taskSpaces.complete(task.name, { keep: true })
```

In this MVP, task spaces are logical labels within one CLI invocation. They do not isolate cookies, local storage, tabs, or site sessions.

## How snapshots save tokens

The extension uses:

1. `Accessibility.getFullAXTree` for roles, accessible names, values, and control states;
2. `DOMSnapshot.captureSnapshot` only to recover labeled clickable elements omitted by the accessibility tree;
3. `backendDOMNodeId` references for clicking and filling.

The result is compact text, not an image. The bundled skill tells Codex to:

- use `page.snapshot()` to discover an unfamiliar page;
- avoid dumping raw HTML;
- keep snapshots under 12,000 characters by default;
- use direct extraction once the page structure is known;
- keep predictable actions and verification in one JavaScript invocation;
- take another snapshot only when a new page state must be understood.

## Login state and privacy

The extension controls tabs inside your current Chrome profile, so sites use the same cookies and storage as your normal tabs.

The project does not export cookies or credentials. Snapshot text and explicit reads are returned to the local Codex process because Codex needs that page information to carry out the requested task.

The Chrome `debugger` permission is powerful. Only install source you have reviewed. Rotate the bridge token with:

```powershell
ego-chrome init --force
```

Then update the token in the extension options.

The bridge checks all of the following:

- it listens only on localhost;
- every connection must present the configured token;
- extension connections must use a Chrome extension origin;
- each routed RPC response is returned only to the requesting CLI connection.

This is still personal-use software and has not received a security audit.

## Limitations

- Opening DevTools on the same tab or attaching another debugger can disconnect automation.
- The MVP snapshots and controls the top-level document. Deep cross-origin iframe support is not implemented yet.
- Canvas, WebGL, remote desktops, maps, and other visual-only surfaces are not semantically observable.
- Browser-internal pages such as `chrome://settings` cannot be controlled.
- Background tabs share the same cookies and storage. This enables login reuse but is not isolation.
- `taskSpaces` currently provides lifecycle-shaped labels, not true browser workspaces.
- Snapshot refs are temporary and process-local.

## Troubleshooting

### Badge stays `OFF`

Run:

```powershell
ego-chrome --doctor
```

Verify that the extension options contain the same token and port as:

```text
%LOCALAPPDATA%\ego-chrome\config.json
```

### `Another debugger is already attached`

Close Chrome DevTools for that tab and temporarily disable other automation/debugging extensions.

### `Unknown or stale ref`

The page changed after the last snapshot. Call `page.snapshot()` again and use the new ref.

### Port 32145 is already used

Change `port` in `%LOCALAPPDATA%\ego-chrome\config.json`, then enter the same port in the extension options.

### CLI is installed but Codex does not see the skill

Confirm this file exists:

```text
~\.agents\skills\ego-chrome\SKILL.md
```

Then restart Codex.

## Development

```powershell
npm install
npm run check
npm test
npm run bridge
```

After changing extension files, open `chrome://extensions` and click **Reload** on the extension card.

## Roadmap

The highest-value next improvements are:

1. recursive cross-origin iframe attachment and snapshot merging;
2. incremental snapshot diffs;
3. tab-group-backed task spaces;
4. semantic `getByRole` and `getByLabel` locators;
5. downloads, uploads, dialogs, and network waits;
6. an explicit visual fallback for exceptional pages, disabled by default.

## License

MIT
