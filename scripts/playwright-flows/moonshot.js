/**
 * Kimi web (kimi.moonshot.cn) flow — V13-T7.6
 */

module.exports = {
  url: 'https://kimi.moonshot.cn',

  async isAuthenticated(page) {
    try {
      const ta = await page.locator('textarea[placeholder*="Kimi"], .chat-input').count()
      if (ta > 0) return true
      const loginLink = await page.locator('a:has-text("Log in"), a:has-text("登录")').count()
      return loginLink === 0
    } catch {
      return false
    }
  },

  async login(page) {
    await page.waitForSelector('textarea, .chat-input', { timeout: 180_000 })
  },

  async sendPrompt(page, text) {
    const input = page.locator('textarea').first()
    await input.click()
    await input.fill('')
    await input.type(text, { delay: 10 })
    await page.keyboard.press('Enter')
  },

  async readResponse(page) {
    const responseSelector = '.message-content-model, .chat-message[data-role="assistant"]'
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
