#!/usr/bin/env tsx
/**
 * V15.0 WS11 — Genera docs/SAIO-cloudflare-setup-guide.pdf con pdfkit.
 *
 * Uso: `npm run docs:cloudflare`
 * Output: docs/SAIO-cloudflare-setup-guide.pdf (committed in repo)
 */
import PDFDocument from 'pdfkit'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const docsDir = path.join(projectRoot, 'docs')
const outFile = path.join(docsDir, 'SAIO-cloudflare-setup-guide.pdf')

if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true })

const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: 'SAIO — Cloudflare Tunnel Setup Guide', Author: 'SAIO Dashboard' } })
doc.pipe(fs.createWriteStream(outFile))

// ─── Color palette ───
const COLORS = {
  primary: '#10b981',
  text: '#1f2937',
  muted: '#6b7280',
  bg: '#f3f4f6',
  warning: '#f59e0b',
  code: '#111827',
  codeText: '#e5e7eb',
}

function h1(text: string): void {
  doc.fontSize(22).fillColor(COLORS.text).font('Helvetica-Bold').text(text, { align: 'left' })
  doc.moveDown(0.5)
}
function h2(text: string): void {
  doc.fontSize(16).fillColor(COLORS.primary).font('Helvetica-Bold').text(text)
  doc.moveDown(0.3)
}
function p(text: string): void {
  doc.fontSize(11).fillColor(COLORS.text).font('Helvetica').text(text, { lineGap: 2 })
  doc.moveDown(0.4)
}
function muted(text: string): void {
  doc.fontSize(9).fillColor(COLORS.muted).font('Helvetica').text(text, { lineGap: 1 })
  doc.moveDown(0.3)
}
function code(text: string): void {
  const startY = doc.y
  const lines = text.split('\n').length
  const height = 14 * lines + 16
  doc.rect(50, startY, 495, height).fill(COLORS.code)
  doc.fontSize(10).fillColor(COLORS.codeText).font('Courier').text(text, 60, startY + 8, { width: 475, lineGap: 2 })
  doc.y = startY + height + 6
  doc.fillColor(COLORS.text)
}
function warn(text: string): void {
  const startY = doc.y
  const height = doc.heightOfString(text, { width: 475 }) + 20
  doc.rect(50, startY, 495, height).lineWidth(1).strokeColor(COLORS.warning).stroke()
  doc.fontSize(10).fillColor(COLORS.warning).font('Helvetica-Bold').text('⚠ ', 60, startY + 8, { continued: true })
  doc.font('Helvetica').fillColor(COLORS.text).text(text, { width: 465 })
  doc.y = startY + height + 6
}

// ─── Cover ───
doc.fillColor(COLORS.primary).rect(0, 0, 595, 80).fill()
doc.fillColor('white').fontSize(28).font('Helvetica-Bold').text('SAIO Dashboard', 50, 25)
doc.fontSize(12).text('Cloudflare Tunnel — Setup Guide', 50, 58)
doc.moveDown(2)
doc.fillColor(COLORS.text).fontSize(10).text(`Generated: ${new Date().toISOString().slice(0, 10)} · V15.0`, 50, 100)
doc.moveDown(2)

// ─── Intro ───
h1('Cosa imparerai in questa guida')
p('Esporre la tua dashboard SAIO via HTTPS pubblico usando un Cloudflare Tunnel — gratis, senza aprire porte sul router. Auth claim + TOTP restano attivi e Cloudflare Access può aggiungere un secondo strato di sicurezza basato su email-allowlist.')
muted('Tempo stimato: 15-30 minuti. Prerequisiti: account Cloudflare gratuito, un dominio già su Cloudflare DNS, privilegi admin sul computer.')
doc.moveDown(0.5)

// ─── Step 1 ───
doc.addPage()
h1('Step 1 — Account e dominio Cloudflare')
p('Se non hai un account Cloudflare, vai su https://cloudflare.com/sign-up e creane uno gratuito. Aggiungi il tuo dominio:')
muted('Cloudflare dashboard → Add Site → inserisci dominio → Continue → seleziona Free plan → Cloudflare ti mostrerà 2 nameserver (NS) da impostare presso il tuo registrar (Aruba, Register, Namecheap, ecc.). Cambia i NS dal pannello del registrar e attendi propagazione (di solito 5 min - 24h).')
warn('Il dominio deve essere "Active" (status verde) nel pannello Cloudflare prima di poter creare tunnel. Verifica nella sezione DNS del tuo dominio.')

// ─── Step 2 ───
h1('Step 2 — Install cloudflared')
p('cloudflared è il client che gira sul tuo computer e crea il tunnel verso Cloudflare. È disponibile per Windows / macOS / Linux.')
h2('Windows (winget)')
code('winget install Cloudflare.cloudflared')
h2('macOS (Homebrew)')
code('brew install cloudflare/cloudflare/cloudflared')
h2('Linux Debian/Ubuntu')
code(`curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb`)
p('Verifica install:')
code('cloudflared --version')

// ─── Step 3 ───
doc.addPage()
h1('Step 3 — Login Cloudflare')
p('Esegui in terminale:')
code('cloudflared tunnel login')
p('Si aprirà il browser per autorizzare Cloudflare. Seleziona la "zone" del tuo dominio. Cloudflare salverà un certificato in ~/.cloudflared/cert.pem (o equivalente Windows %USERPROFILE%\\.cloudflared\\).')

// ─── Step 4 ───
h1('Step 4 — Crea tunnel + DNS route')
p('Crea il tunnel (sostituisci "saio-dashboard" col nome che preferisci):')
code('cloudflared tunnel create saio-dashboard')
p('Cloudflare ti mostrerà un UUID tipo abc123def-...-... e creerà un file di credenziali ~/.cloudflared/<UUID>.json. Salva l\'UUID, ti servirà nel config.')
p('Punta il DNS pubblico al tunnel:')
code('cloudflared tunnel route dns saio-dashboard saio.tuodominio.com')
muted('Sostituisci "saio.tuodominio.com" con l\'hostname che vuoi usare. Cloudflare creerà automaticamente un record CNAME nel DNS del tuo dominio.')

// ─── Step 5 ───
h1('Step 5 — config.yml')
p('Apri (o crea) ~/.cloudflared/config.yml e inserisci:')
code(`tunnel: <UUID-DAL-PASSO-4>
credentials-file: ~/.cloudflared/<UUID>.json
ingress:
  - hostname: saio.tuodominio.com
    service: http://127.0.0.1:3031
    originRequest:
      noTLSVerify: true
      connectTimeout: 30s
  - service: http_status:404`)
warn('Su Windows, sostituisci "~" con il path completo, es. "C:\\Users\\TuoNome\\.cloudflared\\<UUID>.json". Stessa cosa per credentials-file.')

// ─── Step 6 ───
doc.addPage()
h1('Step 6 — Avvia il tunnel')
p('Foreground (per testare):')
code('cloudflared tunnel run saio-dashboard')
p('Verifica nel browser che https://saio.tuodominio.com risponda con la pagina /claim di SAIO.')
h2('Servizio persistente (auto-start al boot)')
p('Windows / macOS / Linux:')
code('cloudflared service install')
muted('Su Windows il servizio si chiama "Cloudflared". Su Linux usa systemctl status cloudflared. Su macOS launchctl list | grep cloudflared.')

// ─── Step 7 ───
h1('Step 7 — Salva tunnel URL in SAIO')
p('In SAIO, modifica .env.local (o usa il wizard browser):')
code('DASHBOARD_AUTH_TUNNEL_URL=https://saio.tuodominio.com')
p('Restart backend SAIO (pm2 restart, systemctl, o npm run dev:server). Da quel momento i magic link verranno inviati con URL pubblico, e il CORS allowlist accetta richieste da quell\'origine.')

// ─── Step 8 (Access) ───
doc.addPage()
h1('Step 8 (raccomandato) — Cloudflare Access policy')
p('Aggiungi un secondo strato di sicurezza: solo email autorizzate raggiungono SAIO PRIMA che la request arrivi al backend. Pre-bootstrap, l\'unica difesa è il claim token TTL — Access lo chiude da fuori.')
muted('Vai su https://one.dash.cloudflare.com → Sidebar Access → Applications → Add an application → Self-hosted')
muted('Application name: SAIO · Application domain: saio.tuodominio.com')
muted('Add a policy → Action: Allow → Include rule → Selector: Emails → tu@tuodominio.com')
muted('Save. Da ora chi non è in allowlist riceve un Cloudflare login screen invece della dashboard.')

// ─── Troubleshooting ───
h1('Troubleshooting')
h2('Errore CORS nel browser')
p('Verifica che DASHBOARD_AUTH_TUNNEL_URL in .env.local matchi esattamente il tunnel URL (no trailing slash). Restart backend.')
h2('502 Bad Gateway')
p('Il backend Express SAIO non sta ascoltando su 127.0.0.1:3031. Verifica con `curl http://127.0.0.1:3031/api/health`.')
h2('1033 / 1034 Cloudflare')
p('Il tunnel è offline. Controlla `cloudflared tunnel info saio-dashboard`.')
h2('cloudflared non in PATH')
p('Su Windows, riavvia il terminale dopo install via winget. Se persiste, aggiungi manualmente "C:\\Program Files (x86)\\cloudflared" al PATH.')

doc.end()
console.log(`✓ PDF generato: ${outFile}`)
