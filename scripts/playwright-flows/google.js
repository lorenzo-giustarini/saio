/**
 * Gemini web (gemini.google.com) flow — V13-T7.5
 *
 * Copre Gemini chat + NanaBanana Pro image generation.
 * DOM cambia spesso, mantieni selettori aggiornati.
 */

module.exports = {
  url: 'https://gemini.google.com/app',
  chatUrl: 'https://gemini.google.com/app',

  async isAuthenticated(page) {
    try {
      // Gemini shows a user avatar button when logged in
      const avatar = await page.locator('a[aria-label*="Google Account"]').count()
      if (avatar > 0) return true
      // Fallback: sign-in button visible = not authenticated
      const signIn = await page.locator('a:has-text("Sign in"), a:has-text("Accedi")').count()
      return signIn === 0
    } catch {
      return false
    }
  },

  async login(page) {
    // User completes OAuth login manually in headed browser.
    // Wait for authenticated state (user lands on chat after login).
    await page.waitForSelector('a[aria-label*="Google Account"]', { timeout: 180_000 })
  },

  async sendPrompt(page, text) {
    // Gemini textarea selector (as of 2026)
    const selectors = [
      'rich-textarea [contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea',
    ]
    let input = null
    for (const sel of selectors) {
      const count = await page.locator(sel).first().count()
      if (count > 0) {
        input = page.locator(sel).first()
        break
      }
    }
    if (!input) throw new Error('Gemini input field not found')
    await input.click()
    await input.fill('')
    await input.type(text, { delay: 10 })
    // Submit via Enter (Gemini treats plain Enter as submit)
    await page.keyboard.press('Enter')
  },

  async readResponse(page) {
    // Wait for response to appear and finish
    const responseSelector = 'message-content, .model-response-text, [data-message-type="model"]'
    await page.waitForSelector(responseSelector, { timeout: 60_000 })

    // Wait for generation to finish — detect when "stop generating" disappears
    // or when response container stabilizes
    let lastLength = 0
    let stableFor = 0
    const maxWait = 90_000
    const start = Date.now()
    while (Date.now() - start < maxWait) {
      await page.waitForTimeout(1000)
      const text = await page.locator(responseSelector).last().innerText().catch(() => '')
      if (text.length === lastLength) {
        stableFor += 1
        if (stableFor >= 3) break // stable 3s = done
      } else {
        stableFor = 0
        lastLength = text.length
      }
    }

    const text = await page.locator(responseSelector).last().innerText().catch(() => '(empty)')
    return text.trim()
  },
}
