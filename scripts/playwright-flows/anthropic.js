/**
 * Claude web (claude.ai) flow — V13-T7.3
 * Login via email/Google OAuth. Textarea con aria-label.
 */

module.exports = {
  url: 'https://claude.ai/new',

  async isAuthenticated(page) {
    try {
      // Logged-in users see the textarea for messaging
      const ta = await page.locator('[aria-label*="Message Claude"], [aria-label*="chat"]').count()
      if (ta > 0) return true
      // "Continue with..." buttons = login page
      const loginButtons = await page.locator('button:has-text("Continue with")').count()
      return loginButtons === 0
    } catch {
      return false
    }
  },

  async login(page) {
    await page.waitForSelector('[aria-label*="Message Claude"]', { timeout: 180_000 })
  },

  async sendPrompt(page, text) {
    const input = page.locator('[aria-label*="Message Claude"], [contenteditable="true"]').first()
    await input.click()
    await input.fill('')
    await input.type(text, { delay: 10 })
    await page.keyboard.press('Enter')
  },

  async readResponse(page) {
    // Wait for response, then wait for stop/copy button (generation done)
    const responseSelector = '[data-is-streaming="false"] .prose, .message-content'
    try {
      await page.waitForSelector(responseSelector, { timeout: 60_000 })
    } catch { /* fall through */ }

    // Stable-length poll
    let lastLength = 0
    let stableFor = 0
    const start = Date.now()
    while (Date.now() - start < 120_000) {
      await page.waitForTimeout(1000)
      const text = await page.locator(responseSelector).last().innerText().catch(() => '')
      if (text.length === lastLength) {
        stableFor++
        if (stableFor >= 3) break
      } else {
        stableFor = 0
        lastLength = text.length
      }
    }

    return (await page.locator(responseSelector).last().innerText().catch(() => '(empty)')).trim()
  },
}
