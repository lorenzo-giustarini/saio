/**
 * V15.0 WS11 — Cloudflare Tunnel onboarding wizard (browser).
 *
 * Step:
 *   0  Intro — hai dominio + Cloudflare account?
 *   1  Hostname pubblico
 *   2  Install cloudflared (winget/brew/apt) con copy-cmd
 *   3  Login OAuth (cloudflared tunnel login)
 *   4  Tunnel create + DNS route
 *   5  Verify tunnel running
 *   6  Optional Access policy email-allowlist
 *   7  Done
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Globe,
  ExternalLink,
  Copy,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Shield,
  Download,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

interface TunnelStatus {
  installed: boolean
  version?: string
  loggedIn: boolean
  tunnels: Array<{ id: string; name: string }>
  configuredUrl: string | null
  error?: string
}

async function fetchTunnelStatus(): Promise<TunnelStatus> {
  const res = await fetch('/api/system/tunnel-status', { credentials: 'include' })
  if (!res.ok) throw new Error(`tunnel-status ${res.status}`)
  return res.json()
}

interface Props {
  open: boolean
  onClose: () => void
}

export function CloudflareSetupWizard({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>(0)
  const [hostname, setHostname] = useState('')
  const [tunnelName, setTunnelName] = useState('saio-dashboard')
  const [error, setError] = useState<string | null>(null)
  const [savedUrl, setSavedUrl] = useState(false)

  const { data: status, refetch } = useQuery({
    queryKey: ['system', 'tunnel-status'],
    queryFn: fetchTunnelStatus,
    enabled: open && step >= 2,
    refetchInterval: step === 5 ? 3000 : false,
    retry: false,
  })

  useEffect(() => {
    if (!open) setStep(0)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        {step === 0 && <IntroStep onNext={() => setStep(1)} onSkip={onClose} />}

        {step === 1 && (
          <HostnameStep
            hostname={hostname}
            tunnelName={tunnelName}
            setHostname={setHostname}
            setTunnelName={setTunnelName}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <InstallStep
            installed={status?.installed || false}
            version={status?.version}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            onRefresh={() => refetch()}
          />
        )}

        {step === 3 && (
          <LoginStep
            loggedIn={status?.loggedIn || false}
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
            onRefresh={() => refetch()}
          />
        )}

        {step === 4 && (
          <CreateTunnelStep
            tunnelName={tunnelName}
            hostname={hostname}
            existingTunnels={status?.tunnels || []}
            onBack={() => setStep(3)}
            onNext={() => setStep(5)}
            onRefresh={() => refetch()}
          />
        )}

        {step === 5 && (
          <VerifyStep
            hostname={hostname}
            error={error}
            setError={setError}
            saved={savedUrl}
            setSaved={setSavedUrl}
            onBack={() => setStep(4)}
            onNext={() => setStep(6)}
          />
        )}

        {step === 6 && (
          <AccessPolicyStep
            hostname={hostname}
            onBack={() => setStep(5)}
            onNext={() => setStep(7)}
          />
        )}

        {step === 7 && <DoneStep hostname={hostname} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

// ─────── INTRO ───────

function IntroStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-center mb-3">
          <div className="rounded-full bg-primary/10 p-4">
            <Globe className="w-8 h-8 text-primary" />
          </div>
        </div>
        <DialogTitle className="text-center">Setup Cloudflare Tunnel</DialogTitle>
        <DialogDescription className="text-center">
          Esponi SAIO via HTTPS pubblico con un Cloudflare Tunnel — gratis, senza aprire porte sul
          router. Auth claim + TOTP restano attivi e Cloudflare Access può aggiungere un secondo
          strato.
        </DialogDescription>
      </DialogHeader>
      <div className="rounded-md bg-muted/50 border border-border p-4 my-3 text-sm space-y-2">
        <div className="font-medium">Prerequisiti</div>
        <ul className="text-xs text-muted-foreground space-y-1 pl-4 list-disc">
          <li>Account su <a href="https://cloudflare.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">cloudflare.com</a> (gratis)</li>
          <li>Un dominio già su Cloudflare DNS</li>
          <li>Privilegi admin sul tuo computer (per install cloudflared via winget/brew/apt)</li>
        </ul>
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onSkip}>
          Per ora salto
        </Button>
        <Button type="button" onClick={onNext}>
          Inizia setup
        </Button>
      </DialogFooter>
      <div className="pt-3 text-xs text-center text-muted-foreground border-t border-border">
        Preferisci leggere offline?{' '}
        <a
          href="/docs/SAIO-cloudflare-setup-guide.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline inline-flex items-center gap-1"
        >
          <Download className="w-3 h-3" />
          Scarica guida PDF
        </a>
      </div>
    </>
  )
}

// ─────── HOSTNAME ───────

function HostnameStep({
  hostname,
  tunnelName,
  setHostname,
  setTunnelName,
  onBack,
  onNext,
}: {
  hostname: string
  tunnelName: string
  setHostname: (v: string) => void
  setTunnelName: (v: string) => void
  onBack: () => void
  onNext: () => void
}) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!hostname.trim() || !tunnelName.trim()) return
    onNext()
  }
  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <div className="text-xs text-muted-foreground">Step 1 di 7</div>
        <DialogTitle>Hostname pubblico</DialogTitle>
        <DialogDescription>
          Inserisci il nome host che userai per accedere alla dashboard. Deve essere un sottodominio
          del tuo dominio già configurato in Cloudflare.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-3">
        <div className="space-y-1.5">
          <Label htmlFor="cf-hostname">Hostname (es. saio.tuodominio.com)</Label>
          <Input
            id="cf-hostname"
            type="text"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="saio.tuodominio.com"
            required
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cf-tunnel-name">Nome tunnel (interno)</Label>
          <Input
            id="cf-tunnel-name"
            type="text"
            value={tunnelName}
            onChange={(e) => setTunnelName(e.target.value)}
            placeholder="saio-dashboard"
          />
          <p className="text-xs text-muted-foreground">
            Solo identificatore Cloudflare interno, l'utente non lo vede.
          </p>
        </div>
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onBack}>
          ← Indietro
        </Button>
        <Button type="submit" disabled={!hostname.trim()}>
          Avanti →
        </Button>
      </DialogFooter>
    </form>
  )
}

// ─────── INSTALL ───────

function InstallStep({
  installed,
  version,
  onBack,
  onNext,
  onRefresh,
}: {
  installed: boolean
  version?: string
  onBack: () => void
  onNext: () => void
  onRefresh: () => void
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const platform = navigator.platform.toLowerCase()
  const isWin = platform.includes('win')
  const isMac = platform.includes('mac')

  const cmds = isWin
    ? ['winget install Cloudflare.cloudflared']
    : isMac
    ? ['brew install cloudflare/cloudflare/cloudflared']
    : [
        '# Debian/Ubuntu:',
        'curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb',
        'sudo dpkg -i cloudflared.deb',
      ]

  async function copy(cmd: string) {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(cmd)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <DialogHeader>
        <div className="text-xs text-muted-foreground">Step 2 di 7</div>
        <DialogTitle>Install cloudflared</DialogTitle>
        <DialogDescription>
          cloudflared è il client che gira sul tuo computer e crea il tunnel verso Cloudflare.
        </DialogDescription>
      </DialogHeader>
      {installed ? (
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 p-3 my-3 text-sm flex gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <div>
            <div className="font-medium text-emerald-200">cloudflared installato</div>
            {version && <div className="text-xs text-emerald-300/70 font-mono mt-0.5">{version}</div>}
          </div>
        </div>
      ) : (
        <div className="space-y-3 py-3">
          <div className="text-xs text-muted-foreground">
            Apri terminale e copia uno di questi comandi:
          </div>
          {cmds.map((cmd, i) => (
            <div key={i} className="flex items-center gap-2 bg-black/30 rounded p-2.5 font-mono text-xs">
              <code className="flex-1 break-all">{cmd}</code>
              {!cmd.startsWith('#') && (
                <button
                  type="button"
                  onClick={() => copy(cmd)}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  title="Copia"
                >
                  {copied === cmd ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} className="w-full">
            <Loader2 className="w-3.5 h-3.5 mr-1.5" />
            Ho installato, verifica
          </Button>
        </div>
      )}
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onBack}>
          ← Indietro
        </Button>
        <Button type="button" onClick={onNext} disabled={!installed}>
          Avanti →
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────── LOGIN ───────

function LoginStep({
  loggedIn,
  onBack,
  onNext,
  onRefresh,
}: {
  loggedIn: boolean
  onBack: () => void
  onNext: () => void
  onRefresh: () => void
}) {
  const [copied, setCopied] = useState(false)
  const cmd = 'cloudflared tunnel login'
  async function copy() {
    await navigator.clipboard.writeText(cmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <>
      <DialogHeader>
        <div className="text-xs text-muted-foreground">Step 3 di 7</div>
        <DialogTitle>Login Cloudflare</DialogTitle>
        <DialogDescription>
          Esegui in terminale il comando qui sotto. Si aprirà il browser per autorizzare il tunnel
          sul tuo account Cloudflare. Seleziona il dominio (zone) corretto.
        </DialogDescription>
      </DialogHeader>
      {loggedIn ? (
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 p-3 my-3 text-sm flex gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <span className="text-emerald-200">Autenticato su Cloudflare ✓</span>
        </div>
      ) : (
        <div className="space-y-3 py-3">
          <div className="flex items-center gap-2 bg-black/30 rounded p-2.5 font-mono text-xs">
            <code className="flex-1">{cmd}</code>
            <button type="button" onClick={copy} title="Copia">
              {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} className="w-full">
            <Loader2 className="w-3.5 h-3.5 mr-1.5" />
            Ho fatto login, verifica
          </Button>
        </div>
      )}
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onBack}>
          ← Indietro
        </Button>
        <Button type="button" onClick={onNext} disabled={!loggedIn}>
          Avanti →
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────── CREATE TUNNEL ───────

function CreateTunnelStep({
  tunnelName,
  hostname,
  existingTunnels,
  onBack,
  onNext,
  onRefresh,
}: {
  tunnelName: string
  hostname: string
  existingTunnels: Array<{ id: string; name: string }>
  onBack: () => void
  onNext: () => void
  onRefresh: () => void
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const exists = existingTunnels.find((t) => t.name === tunnelName)
  const cmds = [
    `cloudflared tunnel create ${tunnelName}`,
    `cloudflared tunnel route dns ${tunnelName} ${hostname}`,
  ]
  async function copy(cmd: string) {
    await navigator.clipboard.writeText(cmd)
    setCopied(cmd)
    setTimeout(() => setCopied(null), 2000)
  }
  return (
    <>
      <DialogHeader>
        <div className="text-xs text-muted-foreground">Step 4 di 7</div>
        <DialogTitle>Crea tunnel + DNS route</DialogTitle>
        <DialogDescription>
          Esegui questi due comandi in terminale. Il primo crea il tunnel, il secondo punta il
          DNS pubblico al tunnel.
        </DialogDescription>
      </DialogHeader>
      {exists && (
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 p-3 my-3 text-xs text-emerald-200 flex gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>
            Tunnel <code className="bg-black/20 px-1 rounded">{tunnelName}</code> già esistente (id: {exists.id.slice(0, 8)}…). Salta il primo comando se non lo hai fatto.
          </span>
        </div>
      )}
      <div className="space-y-2 py-3">
        {cmds.map((cmd, i) => (
          <div key={i} className="flex items-center gap-2 bg-black/30 rounded p-2.5 font-mono text-xs">
            <code className="flex-1 break-all">{cmd}</code>
            <button type="button" onClick={() => copy(cmd)} title="Copia">
              {copied === cmd ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        ))}
      </div>
      <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 my-3 text-xs text-amber-200 flex gap-2">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Dopo, scrivi/aggiorna il file <code className="bg-black/20 px-1 rounded">~/.cloudflared/config.yml</code> con il tunnel UUID e <code className="bg-black/20 px-1 rounded">service: http://127.0.0.1:3031</code>. Vedi la guida PDF per il template completo.
        </span>
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onBack}>
          ← Indietro
        </Button>
        <Button type="button" variant="outline" onClick={onRefresh}>
          Refresh
        </Button>
        <Button type="button" onClick={onNext}>
          Avanti →
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────── VERIFY ───────

function VerifyStep({
  hostname,
  error,
  setError,
  saved,
  setSaved,
  onBack,
  onNext,
}: {
  hostname: string
  error: string | null
  setError: (e: string | null) => void
  saved: boolean
  setSaved: (s: boolean) => void
  onBack: () => void
  onNext: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const cmd = `cloudflared tunnel run`

  async function copy() {
    await navigator.clipboard.writeText(cmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function saveTunnelUrl() {
    setSaving(true)
    setError(null)
    try {
      const url = `https://${hostname}`
      const res = await fetch('/api/system/tunnel-url', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setSaved(true)
    } catch (err) {
      setError('Errore salvataggio URL: ' + (err instanceof Error ? err.message : ''))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <div className="text-xs text-muted-foreground">Step 5 di 7</div>
        <DialogTitle>Avvia tunnel + verifica</DialogTitle>
        <DialogDescription>
          Lancia cloudflared run e verifica che <code className="bg-muted px-1 rounded">https://{hostname}</code> risponda.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-3">
        <div className="flex items-center gap-2 bg-black/30 rounded p-2.5 font-mono text-xs">
          <code className="flex-1">{cmd}</code>
          <button type="button" onClick={copy} title="Copia">
            {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
        <div className="text-xs text-muted-foreground">
          Tieni il terminale aperto (o installa come servizio: <code className="bg-muted px-1 rounded">cloudflared service install</code>). Apri{' '}
          <a
            href={`https://${hostname}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            https://{hostname}
          </a>{' '}
          in un browser per testare.
        </div>
        {!saved ? (
          <Button type="button" onClick={saveTunnelUrl} disabled={saving} className="w-full">
            {saving ? 'Salvo…' : `Salva ${hostname} come tunnel URL`}
          </Button>
        ) : (
          <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm flex gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            <span className="text-emerald-200">URL tunnel salvato in .env.local</span>
          </div>
        )}
        {error && <div className="text-sm text-red-500">{error}</div>}
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onBack}>
          ← Indietro
        </Button>
        <Button type="button" onClick={onNext} disabled={!saved}>
          Avanti →
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────── ACCESS POLICY ───────

function AccessPolicyStep({
  hostname,
  onBack,
  onNext,
}: {
  hostname: string
  onBack: () => void
  onNext: () => void
}) {
  return (
    <>
      <DialogHeader>
        <div className="text-xs text-muted-foreground">Step 6 di 7 (opzionale)</div>
        <DialogTitle>Cloudflare Access (raccomandato)</DialogTitle>
        <DialogDescription>
          Aggiungi un secondo strato di sicurezza: solo email autorizzate raggiungono SAIO PRIMA
          di vedere il claim/login. Pre-bootstrap, l'unica difesa è il claim token TTL 24h —
          Access lo chiude da fuori.
        </DialogDescription>
      </DialogHeader>
      <Highlight icon={<Shield className="w-5 h-5 text-primary" />} title="Setup veloce su Cloudflare dashboard">
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal pl-4">
          <li>
            Apri{' '}
            <a
              href="https://one.dash.cloudflare.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline inline-flex items-center gap-1"
            >
              one.dash.cloudflare.com <ExternalLink className="w-3 h-3" />
            </a>
          </li>
          <li>Sidebar → Access → Applications → Add an application</li>
          <li>Self-hosted → Application name "SAIO" → Application domain: <code className="bg-muted px-1 rounded">{hostname}</code></li>
          <li>Add a policy → Action: Allow → Include → Emails: tu@tuodominio.com</li>
          <li>Save → Cloudflare bloccherà chi non è in allowlist PRIMA che la request arrivi a SAIO</li>
        </ol>
      </Highlight>
      <div className="text-xs text-muted-foreground py-2">
        Puoi farlo dopo: SAIO funziona già con il tunnel + auth claim. Access è solo strato extra.
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onBack}>
          ← Indietro
        </Button>
        <Button type="button" onClick={onNext}>
          Avanti →
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────── DONE ───────

function DoneStep({ hostname, onClose }: { hostname: string; onClose: () => void }) {
  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-center mb-3">
          <div className="rounded-full bg-emerald-500/10 p-4">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          </div>
        </div>
        <DialogTitle className="text-center">Tunnel configurato</DialogTitle>
        <DialogDescription className="text-center">
          SAIO è ora accessibile pubblicamente da{' '}
          <a
            href={`https://${hostname}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            https://{hostname}
          </a>
          . Tieni cloudflared in esecuzione (o installalo come servizio per partire automatico al
          boot del computer).
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" onClick={onClose} className="w-full">
          Vai alla dashboard
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────── helper ───────

function Highlight({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-md bg-muted/50 border border-border p-3 my-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  )
}
