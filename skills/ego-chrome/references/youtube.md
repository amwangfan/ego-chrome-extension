# YouTube playbook

Use this playbook for YouTube navigation, account-menu operations, and switching among accounts that are already signed in to the current Chrome profile.

## Tab policy

When the user says to open YouTube, create a new background tab:

```javascript
await browser.openTab('https://www.youtube.com/', { active: false, wait: true })
```

Do not use `page.goto()` for a new "open YouTube" task. `page.goto()` intentionally replaces the currently selected automation tab and is only for continuing navigation inside that tab.

## Existing-account switching is automatable

Selecting another account that is already listed in YouTube or Google's account chooser is a normal browser action. Continue automatically.

Ask the user to intervene only when the site requests a password, passkey, CAPTCHA, security-key interaction, two-factor code, recovery confirmation, or another secret/authentication challenge.

Do not expose the full list of account emails in model output. Read only enough text to identify the requested account.

## Trusted visible-text click helper

YouTube uses nested custom elements. A normal CSS selector may target a text child rather than the clickable menu item. Use this helper to mark the visible clickable ancestor, then call `page.click()` so the final action is a real CDP mouse click.

```javascript
async function clickVisibleText(text, options = {}) {
  const marker = `ego-text-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const exact = options.exact === true
  const caseSensitive = options.caseSensitive === true
  const nth = Number.isInteger(options.nth) ? options.nth : 0
  const selector = options.selector || '*'

  const selected = await page.evaluate(({ text, marker, exact, caseSensitive, nth, selector }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()
    const wanted = caseSensitive ? normalize(text) : normalize(text).toLowerCase()
    const interactive = [
      'button',
      'a',
      '[role="button"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="link"]',
      '[role="tab"]',
      'tp-yt-paper-item',
      'ytd-menu-service-item-renderer',
      'ytd-compact-link-renderer',
      'ytd-account-item-renderer'
    ].join(',')
    const visible = (element) => {
      if (!(element instanceof Element)) return false
      const style = getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
    }
    const candidates = []
    const seen = new Set()

    for (const element of document.querySelectorAll(selector)) {
      if (!visible(element)) continue
      const labels = [
        element.innerText,
        element.textContent,
        element.getAttribute('aria-label'),
        element.getAttribute('title')
      ].map(normalize).filter(Boolean)
      const matches = labels.some((label) => {
        const value = caseSensitive ? label : label.toLowerCase()
        return exact ? value === wanted : value.includes(wanted)
      })
      if (!matches) continue

      const target = element.matches(interactive) ? element : element.closest(interactive) || element
      if (!visible(target) || target.getRootNode() !== document || seen.has(target)) continue
      seen.add(target)
      candidates.push(target)
    }

    const target = candidates[nth]
    if (!target) return { found: false, count: candidates.length }
    target.setAttribute('data-ego-chrome-text-target', marker)
    return {
      found: true,
      count: candidates.length,
      text: normalize(target.innerText || target.textContent || target.getAttribute('aria-label'))
    }
  }, { text, marker, exact, caseSensitive, nth, selector })

  if (!selected.found) {
    throw new Error(`Visible text not found: ${text}; candidates=${selected.count}`)
  }

  try {
    await page.click(`[data-ego-chrome-text-target="${marker}"]`)
    return selected
  } finally {
    await page.evaluate((value) => {
      document.querySelector(`[data-ego-chrome-text-target="${value}"]`)?.removeAttribute('data-ego-chrome-text-target')
    }, marker).catch(() => {})
  }
}
```

## Switch-account workflow

1. Open YouTube in a new background tab.
2. Wait for `#avatar-btn`, then click it.
3. Read a compact snapshot or targeted visible menu text.
4. Click the menu item whose text is `切换账号` or `Switch account` with `clickVisibleText()`.
5. Wait for the account chooser or account list. Do not stop merely because a popup opened.
6. Identify the requested account by the user's description, such as a prefix. Prefer an account-item selector and partial matching:

```javascript
await clickVisibleText('wind', {
  exact: false,
  selector: 'ytd-account-item-renderer, [role="menuitem"], [role="option"], li, button, a'
})
```

When the user says "the second account", inspect the visible account-item texts, confirm that the second listed item matches the supplied prefix, then use `nth` only among the matching clickable candidates when necessary.

7. Wait for navigation or for the YouTube shell to settle.
8. Open `#avatar-btn` again and verify that the menu identity contains the requested prefix. Return only a minimal confirmation, not the full account list.

## Recommended script shape

```javascript
await browser.openTab('https://www.youtube.com/', { active: false, wait: true })
await page.waitForSelector('#avatar-btn', { state: 'visible', timeout: 20000 })
await page.click('#avatar-btn')
await page.waitForTimeout(300)

const menuText = await page.evaluate(() => document.querySelector('ytd-multi-page-menu-renderer')?.innerText || '')
if (/切换账号/.test(menuText)) await clickVisibleText('切换账号', { exact: true })
else await clickVisibleText('Switch account', { exact: true })

await page.waitForTimeout(500)
await clickVisibleText('wind', {
  exact: false,
  selector: 'ytd-account-item-renderer, [role="menuitem"], [role="option"], li, button, a'
})

await page.waitForTimeout(1000)
await page.waitForSelector('#avatar-btn', { state: 'visible', timeout: 20000 })
await page.click('#avatar-btn')
await page.waitForTimeout(300)
const identity = await page.evaluate(() => (document.querySelector('ytd-multi-page-menu-renderer')?.innerText || '').slice(0, 500))
if (!/wind/i.test(identity)) throw new Error('The requested YouTube account was not verified')
console.log({ switched: true, accountPrefix: 'wind' })
```

Adapt labels to the current YouTube language and page state. If the account chooser opens in the same automation tab, continue there. If a separate tab opens, call `browser.listTabs()`, select the newly created account-chooser tab, and continue without involving the user unless an actual authentication challenge appears.
