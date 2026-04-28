/**
 * V15.0 WS12 + WS15 + WS17 — First-login Welcome Wizard.
 * Order ridisegnato: Welcome → Anthropic → GitHub → Cloudflare → AutoScan
 *                    → Obsidian autoconfig → Done
 */
import { useState, type FormEvent, type ReactNode } from 'react'
import {
  Sparkles,
  BookOpen,
  KeyRound,
  Globe,
  CheckCircle2,
  ExternalLink,
  AlertCircle,
  Github,
  ScanLine,
  Wand2,
  Loader2,
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
import {
  useCompleteOnboarding,
  usePatchChoices,
  useSetAnthropicKey,
  useSetVaultPath,
} from '@/hooks/useOnboardingStatus'

type Step =
  | 'welcome'
  | 'anthropic'
  | 'github'
  | 'cloudflare'
  | 'autoscan-prompt'
  | 'obsidian-detect'
  | 'obsidian-install'
  | 'obsidian-autoconfig'
  | 'done'

interface Props {
  open: boolean
  onClose: () => void
  /** Callback per aprire AutoScanWizard fuori da questo wizard */
  onTriggerAutoScan?: () => void
  /** Callback per aprire CloudflareWizard fuori da questo wizard */
  onTriggerCloudflare?: () => void
}

export function WelcomeWizard({ open, onClose, onTriggerAutoScan, onTriggerCloudflare }: Props) {
  const [step, setStep] = useState<Step>('welcome')
  const patch = usePatchChoices()
  const complete = useCompleteOnboarding()

  async function finalize() {
    await complete.mutateAsync()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && void finalize()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        {step === 'welcome' && (
          <WelcomeStep
            onStart={() => setStep('anthropic')}
            onSkipAll={async () => {
              await patch.mutateAsync({
                obsidian: 'skip',
                anthropicApi: 'skip',
                cloudflare: 'skip',
              })
              await finalize()
            }}
          />
        )}
        {step === 'anthropic' && <AnthropicStep onNext={() => setStep('github')} />}
        {step === 'github' && <GithubStep onNext={() => setStep('cloudflare')} />}
        {step === 'cloudflare' && (
          <CloudflareStep
            onNext={() => setStep('autoscan-prompt')}
            onTriggerCloudflare={() => {
              if (onTriggerCloudflare) onTriggerCloudflare()
              setStep('autoscan-prompt')
            }}
          />
        )}
        {step === 'autoscan-prompt' && (
          <AutoScanPromptStep
            onNext={() => setStep('obsidian-detect')}
            onTriggerAutoScan={() => {
              if (onTriggerAutoScan) onTriggerAutoScan()
              setStep('obsidian-detect')
            }}
          />
        )}
        {step === 'obsidian-detect' && (
          <ObsidianDetectStep
            onNext={(action) => {
              if (action === 'install') setStep('obsidian-install')
              else if (action === 'autoconfig') setStep('obsidian-autoconfig')
              else setStep('done')
            }}
          />
        )}
        {step === 'obsidian-install' && (
          <ObsidianInstallStep onNext={() => setStep('obsidian-autoconfig')} />
        )}
        {step === 'obsidian-autoconfig' && (
          <ObsidianAutoconfigStep onNext={() => setStep('done')} />
        )}
        {step === 'done' && <DoneStep onClose={finalize} />}
      </DialogContent>
    </Dialog>
  )
}

// ─────── WELCOME ───────

function WelcomeStep({ onStart, onSkipAll }: { onStart: () => void; onSkipAll: () => Promise<void> }) {
  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-center mb-3">
          <div className="rounded-full bg-primary/10 p-4">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
        </div>
        <DialogTitle className="text-center text-xl">Benvenuto in SAIO</DialogTitle>
        <DialogDescription className="text-center">
          Vediamo come configurarlo per il tuo workflow. ~5 minuti per i primi 4 step,
          poi opzionale autoscan + autoconfig Obsidian (anche ore se hai molti progetti).
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 py-4">
        <FeatureRow icon={<KeyRound className="w-4 h-4" />} text="API Anthropic (per orchestrator Claude)" />
        <FeatureRow icon={<Github className="w-4 h-4" />} text="Token GitHub (per scan repo personali)" />
        <FeatureRow icon={<Globe className="w-4 h-4" />} text="Cloudflare Tunnel (opzionale, accesso pubblico)" />
        <FeatureRow icon={<ScanLine className="w-4 h-4" />} text="Autoscan progetti su disco + GitHub" />
        <FeatureRow icon={<BookOpen className="w-4 h-4" />} text="Obsidian: install + autoconfig con orchestrator" />
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onSkipAll}>
          Salta tutto, sono esperto
        </Button>
        <Button type="button" onClick={onStart}>
          Inizia setup guidato
        </Button>
      </DialogFooter>
    </>
  )
}

function FeatureRow({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="text-foreground">{icon}</span>
      <span>{text}</span>
    </div>
  )
}

// ─────── ANTHROPIC API ───────

function AnthropicStep({ onNext }: { onNext: () => void }) {
  const [mode, setMode] = useState<'choose' | 'configure'>('choose')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setKey = useSetAnthropicKey()
  const patch = usePatchChoices()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!apiKey.trim()) return
    setError(null)
    try {
      await setKey.mutateAsync(apiKey.trim())
      onNext()
    } catch {
      setError('Errore salvataggio API key.')
    }
  }

  if (mode === 'configure') {
    return (
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>Anthropic API key</DialogTitle>
          <DialogDescription>
            Trova la tua key su{' '}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              console.anthropic.com → API Keys
            </a>
            . Salvata in <code className="bg-muted px-1 rounded">.env.local</code> (gitignored).
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200 flex gap-2 my-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Ogni chiamata API genera un costo. Imposta spending limits su Plans & Billing.
          </span>
        </div>
        <div className="py-2 space-y-2">
          <Label htmlFor="anthropic-key">API Key</Label>
          <div className="relative">
            <Input
              id="anthropic-key"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-api03-..."
              required
              autoComplete="off"
              className="pr-16 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
            >
              {showKey ? 'Nascondi' : 'Mostra'}
            </button>
          </div>
          {error && <div className="text-sm text-red-500">{error}</div>}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => setMode('choose')}>
            ← Indietro
          </Button>
          <Button type="submit" disabled={setKey.isPending}>
            {setKey.isPending ? 'Salvo…' : 'Salva e procedi'}
          </Button>
        </DialogFooter>
      </form>
    )
  }

  return (
    <>
      <DialogHeader>
        <div className="text-xs text-muted-foreground">Step 1 di 6</div>
        <DialogTitle>Provider AI</DialogTitle>
        <DialogDescription>
          L'orchestrator di SAIO usa Claude CLI. Funziona con Claude Plan abbonamento, Codex Plan,
          o ANTHROPIC_API_KEY. Indica quale hai configurato.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 py-3">
        <ChoiceCard
          icon={<KeyRound className="w-5 h-5" />}
          title="Sono già autenticato (Claude CLI / Codex Plan)"
          desc="Sono loggato in Claude CLI o ho un piano già attivo. Procedo."
          onClick={async () => {
            await patch.mutateAsync({ anthropicApi: 'configured' })
            onNext()
          }}
        />
        <ChoiceCard
          icon={<KeyRound className="w-5 h-5" />}
          title="Configuro ANTHROPIC_API_KEY ora"
          desc="Inserisco la key in form. Sarà scritta in .env.local gitignored."
          onClick={() => setMode('configure')}
        />
        <ChoiceCard
          icon={<CheckCircle2 className="w-5 h-5" />}
          title="Configuro dopo"
          desc="Esploro prima la dashboard, configuro provider quando servirà."
          onClick={async () => {
            await patch.mutateAsync({ anthropicApi: 'will-configure' })
            onNext()
          }}
        />
      </div>
    </>
  )
}

// ─────── GITHUB (NEW WS15) ───────

function GithubStep({ onNext }: { onNext: () => void }) {
  const [mode, setMode] = useState<'choose' | 'configure'>('choose')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<{ login: string; name: string | null } | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!token.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/scan/github/set-token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      if (!res.ok) {
        const txt = await res.text()
        if (res.status === 401) setError('Token non valido. Controlla scope: deve avere "repo" e "read:user".')
        else setError(`Errore ${res.status}: ${txt}`)
        return
      }
      const data = (await res.json()) as { user: { login: string; name: string | null } }
      setUser(data.user)
      // Auto-advance dopo 1.5s
      setTimeout(onNext, 1500)
    } catch {
      setError('Errore di rete')
    } finally {
      setSubmitting(false)
    }
  }

  if (mode === 'configure') {
    return (
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>GitHub Personal Access Token</DialogTitle>
          <DialogDescription>
            Genera un token su{' '}
            <a
              href="https://github.com/settings/tokens/new?scopes=repo,read:user&description=SAIO%20Dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              github.com/settings/tokens/new
            </a>{' '}
            (scope già preselezionato: repo + read:user).
          </DialogDescription>
        </DialogHeader>
        {user ? (
          <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 p-3 my-3 text-sm">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 inline mr-2" />
            Token valido per <strong>{user.login}</strong>
            {user.name && <span className="text-muted-foreground"> ({user.name})</span>}
          </div>
        ) : (
          <div className="py-2 space-y-2">
            <Label htmlFor="gh-token">Token (ghp_... o github_pat_...)</Label>
            <div className="relative">
              <Input
                id="gh-token"
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                required
                autoComplete="off"
                className="pr-16 font-mono text-sm"
                disabled={submitting}
              />
              <button
                type="button"
                onClick={() => setShowToken((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                {showToken ? 'Nascondi' : 'Mostra'}
              </button>
            </div>
            {error && <div className="text-sm text-red-500">{error}</div>}
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          {!user && (
            <>
              <Button type="button" variant="ghost" onClick={() => setMode('choose')} disabled={submitting}>
                ← Indietro
              </Button>
              <Button type="submit" disabled={submitting || !token.trim()}>
                {submitting ? 'Verifico…' : 'Verifica e salva'}
              </Button>
            </>
          )}
        </DialogFooter>
      </form>
    )
  }

  return (
    <>
      <DialogHeader>
        <div className="text-xs text-muted-foreground">Step 2 di 6</div>
        <DialogTitle>GitHub</DialogTitle>
        <DialogDescription>
          Connetti GitHub per permettere a SAIO di scansionare i tuoi repo (own + collaborator) e
          integrarli nell'autoscan progetti. Token salvato come GITHUB_TOKEN in .env.local.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 py-3">
        <ChoiceCard
          icon={<Github className="w-5 h-5" />}
          title="Connetti GitHub"
          desc="Inserisco un Personal Access Token (scope: repo + read:user)."
          onClick={() => setMode('configure')}
        />
        <ChoiceCard
          icon={<CheckCircle2 className="w-5 h-5" />}
          title="Salta — solo scan disco locale"
          desc="L'autoscan cercherà progetti solo sul disco, non su GitHub."
          onClick={onNext}
        />
      </div>
    </>
  )
}

// ─────── CLOUDFLARE ───────

function CloudflareStep({
  onNext,
  onTriggerCloudflare,
}: {
  onNext: () => void
  onTriggerCloudflare: () => void
}) {
  const patch = usePatchChoices()
  return (
    <>
      <DialogHeader>
        <div className="text-xs text-muted-foreground">Step 3 di 6</div>
        <DialogTitle>Esposizione pubblica via Cloudflare</DialogTitle>
        <DialogDescription>
          Vuoi accedere a SAIO da fuori casa? Configura un Cloudflare Tunnel (gratis) per esporre
          la dashboard via HTTPS senza aprire porte sul router.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 py-3">
        <ChoiceCard
          icon={<Globe className="w-5 h-5" />}
          title="Configura Cloudflare ora"
          desc="Apre il wizard guidato Cloudflare (richiede account su cloudflare.com + dominio)."
          onClick={async () => {
            await patch.mutateAsync({ cloudflare: 'now' })
            onTriggerCloudflare()
          }}
        />
        <ChoiceCard
          icon={<CheckCircle2 className="w-5 h-5" />}
          title="No, mi basta localhost"
          desc="Userò SAIO solo da questo computer."
          onClick={async () => {
            await patch.mutateAsync({ cloudflare: 'skip' })
            onNext()
          }}
        />
        <ChoiceCard
          icon={<ExternalLink className="w-5 h-5" />}
          title="Più tardi"
          desc="Configurerò Cloudflare quando avrò chiarezza dell'uso."
          onClick={async () => {
            await patch.mutateAsync({ cloudflare: 'later' })
            onNext()
          }}
        />
      </div>
    </>
  )
}

// ─────── AUTOSCAN PROMPT (NEW WS15) ───────

function AutoScanPromptStep({
  onNext,
  onTriggerAutoScan,
}: {
  onNext: () => void
  onTriggerAutoScan: () => void
}) {
  return (
    <>
      <DialogHeader>
        <div className="text-xs text-muted-foreground">Step 4 di 6</div>
        <DialogTitle>Autoscan progetti</DialogTitle>
        <DialogDescription>
          SAIO può scansionare il disco (e GitHub se hai configurato il token) per trovare repo,
          vault Obsidian, agenti Claude e progetti che vuoi gestire dalla dashboard. Puoi farlo
          ora o dopo dalla sidebar.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 py-3">
        <ChoiceCard
          icon={<ScanLine className="w-5 h-5" />}
          title="Avvia autoscan ora"
          desc="Apre il wizard scan con 3 modalità: Quick (~30-60s), Deep (5-15min), Targeted (per nome)."
          onClick={onTriggerAutoScan}
        />
        <ChoiceCard
          icon={<CheckCircle2 className="w-5 h-5" />}
          title="Salta — lo faccio dopo"
          desc="Lo trovi dalla sidebar, voce 'Autoscan progetti'."
          onClick={onNext}
        />
      </div>
    </>
  )
}

// ─────── OBSIDIAN DETECT (rifatto WS17) ───────

function ObsidianDetectStep({ onNext }: { onNext: (action: 'install' | 'autoconfig' | 'skip') => void }) {
  const [mode, setMode] = useState<'choose' | 'have-it'>('choose')
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const setVaultPath = useSetVaultPath()
  const patch = usePatchChoices()

  async function handleHaveIt(e: FormEvent) {
    e.preventDefault()
    if (!path.trim()) return
    setError(null)
    try {
      await setVaultPath.mutateAsync(path.trim())
      onNext('autoconfig')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('400')) setError('Path non valido o non esistente.')
      else setError('Errore: riprova.')
    }
  }

  if (mode === 'have-it') {
    return (
      <form onSubmit={handleHaveIt}>
        <DialogHeader>
          <DialogTitle>Path del tuo vault Obsidian</DialogTitle>
          <DialogDescription>
            Path assoluto della cartella vault. Es: <code className="bg-muted px-1 rounded">C:\Users\me\vault</code>
          </DialogDescription>
        </DialogHeader>
        <div className="py-3 space-y-2">
          <Label htmlFor="vault-path">Path vault</Label>
          <Input
            id="vault-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/Users/me/Documents/vault"
            required
            autoFocus
          />
          {error && <div className="text-sm text-red-500">{error}</div>}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => setMode('choose')}>
            ← Indietro
          </Button>
          <Button type="submit" disabled={setVaultPath.isPending}>
            {setVaultPath.isPending ? 'Salvo…' : 'Salva e procedi'}
          </Button>
        </DialogFooter>
      </form>
    )
  }

  return (
    <>
      <DialogHeader>
        <div className="text-xs text-muted-foreground">Step 5 di 6</div>
        <DialogTitle>Vault Obsidian (opzionale)</DialogTitle>
        <DialogDescription>
          Obsidian è una app di knowledge management. SAIO può integrarla per organizzare automaticamente
          i progetti rilevati nel vault.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 py-3">
        <ChoiceCard
          icon={<BookOpen className="w-5 h-5" />}
          title="Ho già un vault Obsidian"
          desc="Inserisco il path."
          onClick={() => setMode('have-it')}
        />
        <ChoiceCard
          icon={<ExternalLink className="w-5 h-5" />}
          title="Non ho Obsidian, voglio installarlo"
          desc="SAIO può installarlo via winget/brew (poi creerai un vault tu)."
          onClick={async () => {
            await patch.mutateAsync({ obsidian: 'install-later' })
            onNext('install')
          }}
        />
        <ChoiceCard
          icon={<CheckCircle2 className="w-5 h-5" />}
          title="Salta — non mi serve"
          desc="Obsidian è opzionale, posso aggiungerlo dopo."
          onClick={async () => {
            await patch.mutateAsync({ obsidian: 'skip' })
            onNext('skip')
          }}
        />
      </div>
    </>
  )
}

// ─────── OBSIDIAN INSTALL (NEW WS17) ───────

function ObsidianInstallStep({ onNext }: { onNext: () => void }) {
  const [installing, setInstalling] = useState(false)
  const [output, setOutput] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const platform = navigator.platform.toLowerCase()
  const isWin = platform.includes('win')
  const isMac = platform.includes('mac')

  async function install() {
    setInstalling(true)
    setError(null)
    try {
      const res = await fetch('/api/system/install-obsidian', {
        method: 'POST',
        credentials: 'include',
      })
      const txt = await res.text()
      setOutput(txt)
      if (!res.ok) {
        setError('Install fallito. Vedi output sotto.')
      } else {
        setDone(true)
      }
    } catch (err) {
      setError('Errore di rete: ' + (err instanceof Error ? err.message : ''))
    } finally {
      setInstalling(false)
    }
  }

  const cmd = isWin
    ? 'winget install Obsidian.Obsidian'
    : isMac
    ? 'brew install --cask obsidian'
    : '# Linux: scarica il .AppImage o .deb da obsidian.md'

  return (
    <>
      <DialogHeader>
        <DialogTitle>Installa Obsidian</DialogTitle>
        <DialogDescription>
          {isWin && 'Useremo winget per installare Obsidian. '}
          {isMac && 'Useremo Homebrew per installare Obsidian. '}
          {!isWin && !isMac && 'Su Linux scarica manualmente da obsidian.md. '}
          Dopo install, crea un vault e torna qui per autoconfigurarlo.
        </DialogDescription>
      </DialogHeader>
      <div className="rounded-md bg-black/30 p-3 my-3 font-mono text-xs">{cmd}</div>
      {!done && !installing && isWin && (
        <Button type="button" onClick={install} className="w-full">
          Installa automaticamente con winget
        </Button>
      )}
      {!done && !installing && isMac && (
        <Button type="button" onClick={install} className="w-full">
          Installa automaticamente con brew
        </Button>
      )}
      {!isWin && !isMac && (
        <Button asChild className="w-full">
          <a href="https://obsidian.md/download" target="_blank" rel="noopener noreferrer">
            Apri obsidian.md/download
          </a>
        </Button>
      )}
      {installing && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Installazione in corso (può richiedere 1-3 minuti)…</span>
        </div>
      )}
      {output && (
        <pre className="bg-black/30 p-3 rounded text-xs max-h-32 overflow-y-auto whitespace-pre-wrap mt-2">
          {output}
        </pre>
      )}
      {done && (
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 p-3 my-3 text-sm flex gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <span className="text-emerald-200">Obsidian installato. Crea un vault e clicca avanti.</span>
        </div>
      )}
      {error && <div className="text-sm text-red-500 my-2">{error}</div>}
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onNext}>
          Salta autoconfig
        </Button>
        <Button type="button" onClick={onNext} disabled={installing}>
          {done ? 'Ho creato il vault, avanti →' : 'Procedi senza install →'}
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────── OBSIDIAN AUTOCONFIG (NEW WS17) ───────

interface AutoconfigActions {
  moc: boolean
  taxonomy: boolean
  plugins: boolean
  index: boolean
  folderStructure: boolean
}

function ObsidianAutoconfigStep({ onNext }: { onNext: () => void }) {
  const [actions, setActions] = useState<AutoconfigActions>({
    moc: true,
    taxonomy: true,
    plugins: true,
    index: true,
    folderStructure: true,
  })
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; briefId?: string; message?: string } | null>(null)

  function toggle(k: keyof AutoconfigActions) {
    setActions((a) => ({ ...a, [k]: !a[k] }))
  }
  function selectAll() {
    setActions({ moc: true, taxonomy: true, plugins: true, index: true, folderStructure: true })
  }
  function clearAll() {
    setActions({ moc: false, taxonomy: false, plugins: false, index: false, folderStructure: false })
  }

  async function start() {
    setSubmitting(true)
    try {
      const res = await fetch('/api/onboarding/start-obsidian-autoconfig', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions }),
      })
      const data = (await res.json()) as { ok: boolean; briefId?: string; message?: string }
      setResult(data)
    } catch (err) {
      setResult({ ok: false, message: 'Errore di rete: ' + (err instanceof Error ? err.message : '') })
    } finally {
      setSubmitting(false)
    }
  }

  const totalSelected = Object.values(actions).filter(Boolean).length

  if (result?.ok) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Autoconfig Obsidian avviato</DialogTitle>
          <DialogDescription>
            Una sessione Claude orchestrator sta lavorando in background. Vedi i progressi nella sezione "Task" della dashboard.
            Brief id: <code className="bg-muted px-1 rounded">{result.briefId}</code>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={onNext} className="w-full">
            Vai alla dashboard
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <div className="text-xs text-muted-foreground">Step 6 di 6</div>
        <DialogTitle>
          <Wand2 className="w-5 h-5 inline mr-1" /> Autoconfig Obsidian con Claude
        </DialogTitle>
        <DialogDescription>
          SAIO genera un brief automatico e spawna una sessione Claude (con il provider che hai
          configurato) che ottimizza il tuo vault Obsidian integrando i progetti rilevati. Scegli
          quali ottimizzazioni vuoi.
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 my-3 text-xs text-amber-200 flex gap-2">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Tempi realistici: <strong>pochi minuti</strong> con 5-10 progetti, fino a <strong>diverse ore</strong> con 50+
          progetti grandi. La sessione Claude userà il tuo provider (Plan o API): tieni conto del
          consumo token / minuti del piano.
        </span>
      </div>

      <div className="space-y-2 py-3 border-y border-border">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ottimizzazioni ({totalSelected}/5 selezionate)
          </span>
          <div className="flex gap-2 text-xs">
            <button type="button" onClick={selectAll} className="text-primary underline">
              Seleziona tutto
            </button>
            <span className="text-muted-foreground">·</span>
            <button type="button" onClick={clearAll} className="text-muted-foreground underline">
              Nessuno
            </button>
          </div>
        </div>
        <ActionRow
          checked={actions.moc}
          onToggle={() => toggle('moc')}
          label="MOC (Map of Content) per ogni progetto"
          desc="File Markdown indice per ogni progetto rilevato, con link a sotto-note."
        />
        <ActionRow
          checked={actions.taxonomy}
          onToggle={() => toggle('taxonomy')}
          label="Tag taxonomy ragionata"
          desc="Crea hierarchical tag (#cliente/X, #dominio/Y, #stato/active) per filtri."
        />
        <ActionRow
          checked={actions.plugins}
          onToggle={() => toggle('plugins')}
          label="Plugins community raccomandati"
          desc="Suggerisce + auto-abilita Dataview, Calendar, Templater, Tag Wrangler, Excalidraw."
        />
        <ActionRow
          checked={actions.index}
          onToggle={() => toggle('index')}
          label="_INDEX.md root del vault"
          desc="File homepage con link a tutti i progetti + dashboard live (Dataview)."
        />
        <ActionRow
          checked={actions.folderStructure}
          onToggle={() => toggle('folderStructure')}
          label="Folder structure per dominio"
          desc="Riordina cartelle vault per dominio/cliente, mantiene .md esistenti."
        />
      </div>

      {result && !result.ok && (
        <div className="text-sm text-red-500 my-2">{result.message || 'Errore'}</div>
      )}

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onNext} disabled={submitting}>
          Salta — finisce qui
        </Button>
        <Button type="button" onClick={start} disabled={submitting || totalSelected === 0}>
          {submitting ? 'Avvio sessione…' : `Avvia autoconfig (${totalSelected})`}
        </Button>
      </DialogFooter>
    </>
  )
}

function ActionRow({
  checked,
  onToggle,
  label,
  desc,
}: {
  checked: boolean
  onToggle: () => void
  label: string
  desc: string
}) {
  return (
    <label className="flex items-start gap-2 py-1.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
    </label>
  )
}

// ─────── DONE ───────

function DoneStep({ onClose }: { onClose: () => Promise<void> }) {
  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-center mb-3">
          <div className="rounded-full bg-emerald-500/10 p-4">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          </div>
        </div>
        <DialogTitle className="text-center">Setup completato</DialogTitle>
        <DialogDescription className="text-center">
          Sei pronto per usare SAIO. Le tue scelte sono state salvate. Puoi sempre rivisitarle dalle
          impostazioni della dashboard.
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

// ─────── ChoiceCard helper ───────

function ChoiceCard({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: ReactNode
  title: string
  desc: string
  onClick: () => void | Promise<void>
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-md border border-border bg-card hover:bg-accent transition-all p-4"
    >
      <div className="flex items-start gap-3">
        <div className="text-foreground mt-0.5">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
        </div>
      </div>
    </button>
  )
}
