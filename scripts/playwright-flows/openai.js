/**
 * ChatGPT / Codex web (chatgpt.com) flow — V13-T7.4
 */

module.exports = {
  url: 'https://chatgpt.com',

  async isAuthenticated(page) {
    try {
      // Prompt textarea visible = logged in
      const ta = await page.locator('#prompt-textarea, [data-testid="prompt-textarea"]').count()
      if (ta > 0) return true
      const loginBtn = await page.locator('button:has-text("Log in"), [data-testid="login-button"]').count()
      return loginBtn === 0
    } catch {
      return false
    }
  },

  async login(page) {
    await page.waitForSelector('#prompt-textarea, [data-testid="prompt-textarea"]', { timeout: 180_000 })
  },

  async sendPrompt(page, text) {
    const input = page.locator('#prompt-textarea, [data-testid="prompt-textarea"]').first()
    await input.click()
    await input.fill('')
    await input.type(text, { delay: 10 })
    await page.keyboard.press('Enter')
  },

  async readResponse(page) {
    const responseSelector = '[data-message-author-role="assistant"] .markdown, .agent-turn'
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
