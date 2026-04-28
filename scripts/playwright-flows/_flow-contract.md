# Playwright Flow Contract

Ogni file in questa cartella = un "adapter" per un provider web.

Deve esportare un oggetto con questa shape:

```js
module.exports = {
  url: 'https://provider.example.com',
  chatUrl: 'https://provider.example.com/chat', // opzionale
  async isAuthenticated(page) { return bool },
  async login(page) { /* no-op: user does it manually in headed browser */ },
  async sendPrompt(page, text) { /* type into textarea, click submit */ },
  async readResponse(page) { /* wait for response, scrape DOM, return string */ },
}
```

## Pattern suggeriti

**isAuthenticated**: cerca un selettore che esiste SOLO se loggato (es. avatar utente, logout button).

**sendPrompt**: 
1. Await selector del textarea (`page.waitForSelector('textarea', { timeout: 10000 })`)
2. `page.fill('textarea', text)` o `page.type('textarea', text)`
3. Click submit button o `page.keyboard.press('Enter')`

**readResponse**:
1. Attendi che la risposta sia completata (spesso indicator "stop generating" sparisce o appare "copy" button)
2. Scrape il contenuto del message container più recente
3. Return text plain (senza markdown formatting se preferisci)

## DOM fragility

I selettori DOM cambiano spesso. Usa:
- `data-testid` quando disponibili (più stabili)
- aria-label come fallback
- CSS class come ultima spiaggia (più instabile)

Quando un flow si rompe, aggiorna il SELECTOR per quel provider senza toccare gli altri.

## Storage persistence

L'adapter salva `context.storageState()` in `data/playwright-sessions/<accountId>/storageState.json`
dopo ogni sendPrompt successful. La prossima volta il browser parte già loggato.

## Headless vs headed

Al primo spawn: **sempre headed** (user deve fare login manuale).
Dopo il primo login: può andare **headless** se vuole.
