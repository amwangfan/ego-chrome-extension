const DEFAULT_TIMEOUT = 10_000

export function createRuntime(rpc, options = {}) {
  let selectedTabId = options.tabId || null
  const taskMap = new Map()
  let nextTaskId = 1

  const call = (method, params = {}, requestOptions) => rpc.request(method, params, requestOptions)

  async function rememberTabId(tabId) {
    selectedTabId = tabId
    await call('bridge.session.selectTab', { tabId })
    return tabId
  }

  async function clearRememberedTab(tabId) {
    if (selectedTabId === tabId) selectedTabId = null
    await call('bridge.session.clearTab', { tabId })
  }

  async function ensureTabId() {
    if (selectedTabId) return selectedTabId
    const remembered = await call('bridge.session.currentTab')
    if (remembered?.tabId) {
      selectedTabId = remembered.tabId
      return selectedTabId
    }
    const tab = await call('tabs.active')
    if (!tab?.id) throw new Error('No controllable Chrome tab is active')
    await rememberTabId(tab.id)
    return selectedTabId
  }

  const browser = {
    async listTabs() {
      return call('tabs.list')
    },

    async currentTab() {
      const rememberedId = selectedTabId || (await call('bridge.session.currentTab'))?.tabId
      if (rememberedId) {
        const tabs = await call('tabs.list')
        const tab = tabs.find((candidate) => candidate.id === rememberedId)
        if (tab) {
          selectedTabId = tab.id
          return tab
        }
        await clearRememberedTab(rememberedId)
      }
      const tab = await call('tabs.active')
      if (tab?.id) await rememberTabId(tab.id)
      return tab
    },

    async useTab(tabOrId) {
      const id = typeof tabOrId === 'number' ? tabOrId : tabOrId?.id
      if (!Number.isInteger(id)) throw new TypeError('browser.useTab requires a numeric tab id')
      const tabs = await call('tabs.list')
      const tab = tabs.find((candidate) => candidate.id === id)
      if (!tab) throw new Error(`Chrome tab not found: ${id}`)
      await rememberTabId(id)
      return tab
    },

    async openTab(url = 'about:blank', options = {}) {
      const tab = await call('tabs.open', { url, active: options.active === true })
      await rememberTabId(tab.id)
      if (options.wait !== false && isWebUrl(url)) {
        const loaded = await page.waitForLoadState({ timeout: options.timeout || 20_000 })
        if (!loaded) throw new Error(`Timed out loading ${url}`)
      }
      return tab
    },

    async openOrReuseTab(url, options = {}) {
      if (typeof url !== 'string' || !url) throw new TypeError('browser.openOrReuseTab requires a URL')
      const match = options.match || 'exact'
      const tabs = await call('tabs.list')
      const existing = tabs.find((tab) => matchUrl(tab.url, url, match))
      if (existing) {
        await rememberTabId(existing.id)
        if (options.active === true) await call('tabs.activate', { tabId: existing.id })
        if (options.wait !== false && isWebUrl(existing.url)) {
          const loaded = await page.waitForLoadState({ timeout: options.timeout || 20_000 })
          if (!loaded) throw new Error(`Timed out loading ${existing.url}`)
        }
        return { ...existing, reused: true }
      }
      const tab = await browser.openTab(url, options)
      return { ...tab, reused: false }
    },

    async closeTab(tabOrId = selectedTabId) {
      const id = typeof tabOrId === 'number' ? tabOrId : tabOrId?.id
      if (!Number.isInteger(id)) throw new TypeError('browser.closeTab requires a numeric tab id')
      await call('tabs.close', { tabId: id })
      await clearRememberedTab(id)
      return id
    },

    async activateTab(tabOrId = selectedTabId) {
      const id = typeof tabOrId === 'number' ? tabOrId : tabOrId?.id
      if (!Number.isInteger(id)) throw new TypeError('browser.activateTab requires a numeric tab id')
      const tab = await call('tabs.activate', { tabId: id })
      await rememberTabId(id)
      return tab
    },
  }

  const page = {
    async snapshot(options = {}) {
      return call('page.snapshot', {
        tabId: await ensureTabId(),
        options: {
          maxChars: options.maxChars ?? 12_000,
          includeText: options.includeText !== false,
        },
      }, { timeoutMs: options.timeout || 20_000 })
    },

    async click(target, options = {}) {
      return call('page.click', {
        tabId: await ensureTabId(),
        target,
        options,
      })
    },

    async fill(target, value, options = {}) {
      return call('page.fill', {
        tabId: await ensureTabId(),
        target,
        value: String(value ?? ''),
        options,
      })
    },

    async press(key, options = {}) {
      return call('page.press', {
        tabId: await ensureTabId(),
        key,
        options,
      })
    },

    async goto(url, options = {}) {
      const tabId = await ensureTabId()
      const result = await call('page.goto', { tabId, url })
      if (options.wait !== false) {
        const loaded = await page.waitForLoadState({ timeout: options.timeout || 20_000 })
        if (!loaded) throw new Error(`Timed out loading ${url}`)
      }
      return result
    },

    async info() {
      return call('page.info', { tabId: await ensureTabId() })
    },

    async url() {
      return (await page.info()).url
    },

    async title() {
      return (await page.info()).title
    },

    async evaluate(pageFunction, arg) {
      const expression = serializeEvaluation(pageFunction, arg)
      return call('page.evaluate', {
        tabId: await ensureTabId(),
        expression,
      })
    },

    async textContent(selector) {
      return page.evaluate((value) => document.querySelector(value)?.textContent ?? null, selector)
    },

    async count(selector) {
      return page.evaluate((value) => document.querySelectorAll(value).length, selector)
    },

    async waitForSelector(selector, options = {}) {
      const timeout = options.timeout ?? DEFAULT_TIMEOUT
      const state = options.state || 'attached'
      const deadline = Date.now() + timeout
      while (true) {
        try {
          const result = await page.evaluate(({ selector, state }) => {
            const element = document.querySelector(selector)
            const visible = Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
            if (state === 'detached') return !element
            if (state === 'hidden') return !element || !visible
            if (state === 'visible') return visible
            return Boolean(element)
          }, { selector, state })
          if (result) return true
        } catch (error) {
          if (!isTransientNavigationError(error)) throw error
        }
        if (Date.now() >= deadline) return false
        await page.waitForTimeout(100)
      }
    },

    async waitForURL(expected, options = {}) {
      const timeout = options.timeout ?? DEFAULT_TIMEOUT
      const deadline = Date.now() + timeout
      while (true) {
        try {
          const href = await page.url()
          if (urlExpectationMatches(href, expected)) return href
        } catch (error) {
          if (!isTransientNavigationError(error)) throw error
        }
        if (Date.now() >= deadline) return false
        await page.waitForTimeout(100)
      }
    },

    async waitForLoadState(options = {}) {
      const timeout = options.timeout ?? 20_000
      const deadline = Date.now() + timeout
      while (true) {
        try {
          const readyState = await page.evaluate(() => document.readyState)
          if (readyState === 'interactive' || readyState === 'complete') return true
        } catch (error) {
          if (!isTransientNavigationError(error)) throw error
        }
        if (Date.now() >= deadline) return false
        await page.waitForTimeout(100)
      }
    },

    async waitForTimeout(ms) {
      await new Promise((resolve) => setTimeout(resolve, Number(ms)))
    },

    locator(selector) {
      if (typeof selector !== 'string' || !selector) throw new TypeError('page.locator requires a selector')
      return createLocator(page, selector)
    },
  }

  const taskSpaces = {
    async list() {
      return [...taskMap.values()]
    },
    async useOrCreate(name) {
      if (typeof name !== 'string' || !name.trim()) throw new TypeError('taskSpaces.useOrCreate requires a name')
      let task = taskMap.get(name)
      if (!task) {
        task = { id: nextTaskId++, name, ownership: 'agent', createdAt: new Date().toISOString() }
        taskMap.set(name, task)
      }
      return task
    },
    async complete(nameOrId, options = {}) {
      const task = findTask(taskMap, nameOrId)
      if (!task) throw new Error(`Task space not found: ${nameOrId}`)
      task.completed = true
      task.keep = options.keep === true
      return { done: true, task }
    },
  }

  return { browser, page, taskSpaces }
}

function createLocator(page, selector) {
  return {
    click: (options) => page.click(selector, options),
    fill: (value, options) => page.fill(selector, value, options),
    press: async (key, options) => {
      await page.evaluate((value) => {
        const element = document.querySelector(value)
        if (!element) throw new Error(`Element not found: ${value}`)
        element.focus()
        return true
      }, selector)
      return page.press(key, options)
    },
    textContent: () => page.textContent(selector),
    count: () => page.count(selector),
    waitFor: (options) => page.waitForSelector(selector, options),
    evaluate: (fn, arg) => page.evaluate(({ selector, source, arg }) => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Element not found: ${selector}`)
      return (0, eval)(`(${source})`)(element, arg)
    }, { selector, source: fn.toString(), arg }),
  }
}

export function serializeEvaluation(pageFunction, arg) {
  if (typeof pageFunction === 'function') {
    return `(${pageFunction.toString()})(${serializeArg(arg)})`
  }
  if (typeof pageFunction === 'string') return pageFunction
  throw new TypeError(`page.evaluate expects a function or string, got ${typeof pageFunction}`)
}

function serializeArg(arg) {
  if (arg === undefined) return 'undefined'
  const value = JSON.stringify(arg)
  if (value === undefined) throw new TypeError('page.evaluate argument must be JSON-serializable')
  return value
}

export function matchUrl(actual, wanted, mode = 'exact') {
  if (!actual) return false
  if (mode === 'includes') return actual.includes(wanted)
  try {
    const a = new URL(actual)
    const w = new URL(wanted)
    if (mode === 'origin') return a.origin === w.origin
    if (mode === 'origin+path') return a.origin === w.origin && trimSlash(a.pathname) === trimSlash(w.pathname)
    return a.href === w.href
  } catch {
    return actual === wanted
  }
}

function urlExpectationMatches(href, expected) {
  if (typeof expected === 'function') return Boolean(expected(new URL(href)))
  if (expected instanceof RegExp) return expected.test(href)
  if (typeof expected === 'string') return href === expected || href.includes(expected)
  throw new TypeError('page.waitForURL expects a string, RegExp, or predicate function')
}

function isTransientNavigationError(error) {
  return /Cannot access|No tab|closed|navigation|context|Execution context was destroyed|Inspected target navigated/i.test(error?.message || '')
}

function trimSlash(pathname) {
  return pathname.replace(/\/+$/, '') || '/'
}

function isWebUrl(url) {
  return /^https?:/i.test(url)
}

function findTask(taskMap, nameOrId) {
  if (typeof nameOrId === 'string') return taskMap.get(nameOrId)
  return [...taskMap.values()].find((task) => task.id === nameOrId)
}
