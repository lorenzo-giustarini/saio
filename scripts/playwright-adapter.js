#!/usr/bin/env node
/**
 * Playwright Adapter (V13-T7.1)
 *
 * Wraps a browser automation flow so it looks like a CLI:
 *  - stdin → receives prompt text from PTY (user typing in xterm)
 *  - stdout → emits scraped model response as terminal text
 *
 * Usage (invoked by pty-manager when account.mode === 'playwright'):
 *   node scripts/playwright-adapter.js <accountId> <providerId> [--headless]
 *
 * Browser session persistence: data/playwright-sessions/<accountId>/
 * Flow modules: scripts/playwright-flows/<providerId>.js
 *
 * Each flow module exports:
 *   {
 *     url: string,
 *     async login(page)          // called if not authenticated
 *     async sendPrompt(page, text)  // types into chat box, submits
 *     async readResponse(page)   // scrapes completed response
 *     async isAuthenticated(page) // true if logged in
 *   }
 */

const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const [, , accountId, providerId, ...flags] = process.argv
const HEADLESS = flags.includes('--headless')

if (!accountId || !providerId) {
  console.error('Usage: playwright-adapter.js <accountId> <providerId> [--headless]')
  process.exit(1)
}

const FLOWS_DIR = path.join(__dirname, 'playwright-flows')
const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'playwright-sessions')
const sessionDir = path.join(SESSIONS_DIR, accountId.replace(/[^a-zA-Z0-9_-]/g, ''))
const storageStatePath = path.join(sessionDir, 'storageState.json')

function log(msg) {
  process.stdout.write(`\x1b[36m[adapter]\x1b[0m ${msg}\n`)
}

async function main() {
  // Load flow module
  const flowPath = path.join(FLOWS_DIR, `${providerId}.js`)
  if (!fs.existsSync(flowPath)) {
    console.error(`Flow module not found: ${flowPath}`)
    process.exit(2)
  }
  const flow = require(flowPath)
  if (!flow.url || !flow.sendPrompt || !flow.readResponse) {
    console.error('Invalid flow module: missing required exports')
    process.exit(3)
  }

  fs.mkdirSync(sessionDir, { recursive: true })

  log(`Launching ${HEADLESS ? 'headless' : 'headed'} browser for ${providerId}...`)
  const browser = await chromium.launch({ headless: HEADLESS })
  const contextOptions = {}
  if (fs.existsSync(storageStatePath)) {
    contextOptions.storageState = storageStatePath
    log('Loaded saved session')
  }
  const context = await browser.newContext(contextOptions)
  const page = await context.newPage()

  try {
    log(`Navigating to ${flow.url}...`)
    await page.goto(flow.url, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Check authentication
    const authed = flow.isAuthenticated ? await flow.isAuthenticated(page) : true
    if (!authed) {
      if (flow.login) {
        log('Login flow starting — complete manually in the browser if headed, then press ENTER in terminal')
        if (HEADLESS) {
          console.error('Headless mode but login required — restart without --headless flag')
          await browser.close()
          process.exit(4)
        }
        await new Promise((resolve) => {
          const rl = readline.createInterface({ input: process.stdin })
          rl.question('', () => {
            rl.close()
            resolve()
          })
        })
        await flow.login(page)
        await context.storageState({ path: storageStatePath })
        log('Session saved')
      } else {
        log('Not authenticated and no login flow — please configure manually')
      }
    }

    log('Ready. Type a prompt and press Enter.')
    process.stdout.write('\n> ')

    // Interactive loop: read stdin, send to page, emit response
    const rl = readline.createInterface({ input: process.stdin, terminal: false })
    rl.on('line', async (line) => {
      const prompt = line.trim()
      if (!prompt) {
        process.stdout.write('> ')
        return
      }
      if (prompt === '/exit' || prompt === '/quit') {
        await browser.close()
        process.exit(0)
      }
      try {
        log(`Sending: ${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}`)
        await flow.sendPrompt(page, prompt)
        const response = await flow.readResponse(page)
        process.stdout.write('\n' + response + '\n\n> ')
        // Refresh session after successful interaction
        await context.storageState({ path: storageStatePath })
      } catch (err) {
        console.error(`\n\x1b[31m[error]\x1b[0m ${err.message}\n> `)
      }
    })

    // Keep process alive
    await new Promise(() => {})
  } catch (err) {
    console.error(`Fatal: ${err.message}`)
    await browser.close()
    process.exit(5)
  }
}

main().catch((err) => {
  console.error('main() crashed:', err)
  process.exit(99)
})
