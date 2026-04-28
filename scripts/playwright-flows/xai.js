/**
 * Grok web (grok.com) flow — V13-T7.6
 */

module.exports = {
  url: 'https://grok.com',

  async isAuthenticated(page) {
    try {
      const ta = await page.locator('textarea[placeholder*="Grok"], [data-testid="grok-textarea"]').count()
      return ta > 0
    } catch {
      return false
    }
  },

  async login(page) {
    await page.waitForSelector('textarea[placeholder*="Grok"], [data-testid="grok-textarea"]', { timeout: 180_000 })
  },

  async sendPrompt(page, text) {
    const input = page.locator('textarea').first()
    await input.click()
    await input.fill('')
    await input.type(text, { delay: 10 })
    await page.keyboard.press('Enter')
  },

  async readResponse(page) {
    const responseSelector = '[data-message-author-role="assistant"], .grok-response, .response-content'
    try {
      await page.waitForSelector(responseSelector, { timeout: 60_000 })
    } catch { /* continue */ }

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
