---
name: ego-chrome
description: Control the user's Chrome profile through ego-chrome with ego-style low-token browser workflows. Prefer one-shot automation, compact semantic observation, reusable browser state, and targeted actions over repeated inspection.
metadata:
  version: "0.2.0"
---

# ego-chrome

`ego-chrome` provides Codex with a local Chrome automation runtime. It keeps the user's existing login state and uses semantic snapshots instead of screenshots.

The goal is not to simulate human browsing. The goal is to complete browser tasks with the minimum number of observations and actions.

## Core execution rules

### One task = one browser script

Always complete a browser task inside one `ego-chrome nodejs` invocation when possible.

Bad:

```
open page
snapshot
analyze
new command
click
new command
snapshot
```

Good:

```powershell
@'
await browser.openTab(url, { active: false, wait: true })
const state = await page.snapshot({ maxChars: 3000 })
await page.click('@1')
await page.waitForSelector('.success')
console.log(await page.textContent('.success'))
'@ | ego-chrome nodejs
```

Keep observation, actions, waits, extraction, and verification together.

## Avoid unnecessary observation

Do not call `page.snapshot()` after every action.

Use snapshot only when:

- entering an unknown page;
- navigation reaches a new state;
- a previous `@N` reference becomes invalid;
- the next action cannot be determined otherwise.

Do not snapshot for:

- typing into a known field;
- clicking a known control;
- waiting for a known selector;
- extracting a known value.

After a page structure is understood, prefer:

- `page.locator()`;
- `page.getByText()`;
- `page.findText()`;
- direct `page.evaluate()` for small reads.

## Prefer direct actions over exploration

If the URL, selector, or semantic target is already reliable, act directly.

Example:

```javascript
await browser.openTab('https://www.google.com/search?q=youtube', {
  active: false,
  wait: true,
})
```

Do not open a page only to discover a URL that is already deterministic.

## Compact snapshots

Default snapshot budget:

```javascript
await page.snapshot({ maxChars: 3000 })
```

Use larger snapshots only for genuinely complex pages.

Never dump:

- full HTML;
- large DOM trees;
- unrelated page text.

The model needs interactive state, not the whole document.

## Tab selection

Every invocation must explicitly select a tab before `page.*`.

Use:

```javascript
await browser.openTab(url, { active: false, wait: true })
await browser.openOrReuseTab(url, { active: false, wait: true })
await browser.continueLastTab()
await browser.useActiveTab()
await browser.useTab(tabId)
```

`openTab()` creates a background automation tab and does not disturb the user's active page.

## Observation and action pattern

Preferred pattern:

```
unknown page
    ↓
compact snapshot
    ↓
choose target
    ↓
perform several actions
    ↓
verify final state
```

Avoid:

```
action
snapshot
action
snapshot
action
snapshot
```

## Dynamic interfaces

For menus, dialogs, dropdowns, and custom components:

1. Try semantic locators first.
2. Use `findText()` / `clickText()` if selectors are unstable.
3. Only inspect another snapshot if the state is genuinely unknown.

Example:

```javascript
await page.clickText('Continue', { exact: true })
```

Do not stop for ordinary menus or account selectors. Continue until a real security boundary appears.

Ask the user only for:

- passwords;
- MFA/security codes;
- payment authorization;
- destructive confirmation.

## Learning from successful patterns

When a repeated website pattern is discovered, prefer recording a reusable locator or interaction hint instead of rediscovering it every run.

Store only:

- domain;
- stable selectors;
- roles/names;
- useful interaction notes.

Do not store:

- cookies;
- tokens;
- private page content.

## Verification

A successful click is not proof of success.

Verify with:

- URL change;
- visible confirmation;
- changed value;
- created row;
- resulting state.

## API

### Browser

```javascript
await browser.openTab(url, { active: false, wait: true })
await browser.openOrReuseTab(url, { active: false, wait: true })
await browser.continueLastTab()
await browser.useActiveTab()
await browser.useTab(tabId)
```

### Page

```javascript
await page.snapshot({ maxChars: 3000 })
await page.click('@1')
await page.fill('@2', 'value')
await page.findText('text')
await page.clickText('text')
await page.getByText('text').click()
await page.evaluate(() => document.title)
await page.waitForSelector('.ready')
await page.waitForURL('/complete')
```

## Failure handling

- `STALE_REF`: take one new compact snapshot.
- `ELEMENT_NOT_FOUND`: change strategy once; do not repeat blindly.
- `EXTENSION_DISCONNECTED`: stop and reconnect.
- `ATTACH_FAILED`: close conflicting DevTools/debuggers.

Do not enter retry loops that repeatedly consume browser actions and tokens.
