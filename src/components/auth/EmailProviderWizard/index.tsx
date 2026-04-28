/**
 * V15.0 WS7 — Email Provider Setup Wizard.
 *
 * Pop-up guidato per setup primo email provider in browser, senza terminale.
 * Trigger: GET /api/auth/setup-status ritorna {configured: false}.
 * Salva via POST /api/auth/setup-email → backend scrive .env.local atomic.
 */
import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react'
import {
  Mail,
  ServerCog,
  Sparkles,
  Bug,
  ExternalLink,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Loader2,
  XCircle,
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
import { api } from '@/lib/api'
import { COPY, SMTP_PRESETS } from './copy-it'
import { useWizardState, type WizardStep } from './useWizardState'

// V15.0 WS8 — Validation state per onBlur SMTP credentials check
type ValidationState =
  | { status: 'idle' }
  | { status: 'validating' }
  | { status: 'valid' }
  | { status: 'invalid'; error: string }

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Chiamato dopo POST /setup-email 200 — frontend invalida useSetupStatus */
  onConfigured: () => void
  /** "Ho già configurato" — chiude wizard senza POST */
  onSkip: () => void
}

export function EmailProviderWizard({ open, onOpenChange, onConfigured, onSkip }: Props) {
  const { state, setStep, setProvider, patchDraft, reset } = useWizardState()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <StepRenderer
          step={state.step}
          state={state}
          setStep={setStep}
          setProvider={setProvider}
          patchDraft={patchDraft}
          onSkip={onSkip}
          onDone={() => {
            reset()
            onConfigured()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function StepRenderer({
  step,
  state,
  setStep,
  setProvider,
  patchDraft,
  onSkip,
  onDone,
}: {
  step: WizardStep
  state: ReturnType<typeof useWizardState>['state']
  setStep: (s: WizardStep) => void
  setProvider: (p: 'gmail' | 'custom' | 'resend' | 'debug' | null) => void
  patchDraft: (p: Parameters<ReturnType<typeof useWizardState>['patchDraft']>[0]) => void
  onSkip: () => void
  onDone: () => void
}) {
  switch (step) {
    case 'intro':
      return (
        <IntroStep
          onPickGmail={() => {
            setProvider('gmail')
            setStep('gmail-open')
          }}
          onPickCustom={() => {
            setProvider('custom')
            setStep('custom-provider-picker')
          }}
          onPickResend={() => {
            setProvider('resend')
            setStep('resend-form')
          }}
          onPickDebug={() => {
            setProvider('debug')
            setStep('debug-confirm')
          }}
          onSkip={onSkip}
        />
      )
    case 'gmail-open':
      return <GmailStep1 onNext={() => setStep('gmail-security')} onBack={() => setStep('intro')} />
    case 'gmail-security':
      return <GmailStep2 onNext={() => setStep('gmail-search')} onBack={() => setStep('gmail-open')} />
    case 'gmail-search':
      return <GmailStep3 onNext={() => setStep('gmail-create')} onBack={() => setStep('gmail-security')} />
    case 'gmail-create':
      return <GmailStep4 onNext={() => setStep('gmail-paste')} onBack={() => setStep('gmail-search')} />
    case 'gmail-paste':
      return (
        <GmailPasteStep
          initialEmail={state.draft.email}
          onBack={() => setStep('gmail-create')}
          onSubmit={async (email, pass) => {
            patchDraft({ email })
            await api.auth.setupEmail({
              provider: 'smtp',
              smtpHost: 'smtp.gmail.com',
              smtpPort: 587,
              smtpUser: email,
              smtpPass: pass,
              fromEmail: email,
            })
            setStep('done')
          }}
        />
      )
    case 'custom-provider-picker':
      return (
        <CustomProviderPicker
          onPickPreset={(preset) => {
            patchDraft({
              presetId: preset.id,
              smtpHost: preset.host,
              smtpPort: preset.port,
            })
            setStep('custom-smtp')
          }}
          onBack={() => setStep('intro')}
        />
      )
    case 'custom-smtp':
      return (
        <CustomSmtpStep
          draft={state.draft}
          onBack={() => setStep('custom-provider-picker')}
          onSubmit={async (payload) => {
            patchDraft({
              smtpHost: payload.smtpHost,
              smtpPort: payload.smtpPort,
              smtpUser: payload.smtpUser,
              fromEmail: payload.fromEmail,
            })
            await api.auth.setupEmail({ provider: 'smtp', ...payload })
            setStep('done')
          }}
        />
      )
    case 'resend-form':
      return (
        <ResendStep
          draft={state.draft}
          onBack={() => setStep('intro')}
          onSubmit={async (payload) => {
            patchDraft({ fromEmail: payload.fromEmail })
            await api.auth.setupEmail({ provider: 'resend', ...payload })
            setStep('done')
          }}
        />
      )
    case 'debug-confirm':
      return (
        <DebugStep
          onBack={() => setStep('intro')}
          onSubmit={async () => {
            await api.auth.setupEmail({ provider: 'debug' })
            setStep('done')
          }}
        />
      )
    case 'done':
      return <DoneStep onClose={onDone} />
    default:
      return null
  }
}

// ─────────────────── INTRO ───────────────────

function IntroStep({
  onPickGmail,
  onPickCustom,
  onPickResend,
  onPickDebug,
  onSkip,
}: {
  onPickGmail: () => void
  onPickCustom: () => void
  onPickResend: () => void
  onPickDebug: () => void
  onSkip: () => void
}) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  return (
    <>
      <DialogHeader>
        <DialogTitle>{COPY.intro.title}</DialogTitle>
        <DialogDescription className="whitespace-pre-line">{COPY.intro.body}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-3">
        <ProviderCard
          icon={<Mail className="w-5 h-5" />}
          title={COPY.intro.cardGmail.title}
          desc={COPY.intro.cardGmail.desc}
          highlight
          onClick={onPickGmail}
        />
        <ProviderCard
          icon={<ServerCog className="w-5 h-5" />}
          title={COPY.intro.cardCustom.title}
          desc={COPY.intro.cardCustom.desc}
          onClick={onPickCustom}
        />
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-xs text-muted-foreground underline w-full text-left pt-1"
        >
          {showAdvanced ? '− Nascondi altri provider' : '+ ' + COPY.intro.advanced.title}
        </button>
        {showAdvanced && (
          <div className="space-y-2 pl-3 border-l-2 border-border">
            <ProviderCard
              icon={<Sparkles className="w-4 h-4" />}
              title="Resend"
              desc={COPY.intro.advanced.resendDesc}
              compact
              onClick={onPickResend}
            />
            <ProviderCard
              icon={<Bug className="w-4 h-4" />}
              title="Dev mode"
              desc={COPY.intro.advanced.debugDesc}
              compact
              onClick={onPickDebug}
            />
          </div>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
          {COPY.intro.skipBtn}
        </Button>
      </DialogFooter>
    </>
  )
}

function ProviderCard({
  icon,
  title,
  desc,
  highlight = false,
  compact = false,
  onClick,
}: {
  icon: ReactNode
  title: string
  desc: string
  highlight?: boolean
  compact?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full text-left rounded-md border transition-all',
        compact ? 'p-2.5' : 'p-4',
        highlight
          ? 'border-primary/40 bg-primary/5 hover:bg-primary/10'
          : 'border-border bg-card hover:bg-accent',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <div className="text-foreground mt-0.5">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className={compact ? 'text-sm font-medium' : 'font-medium'}>{title}</div>
          <div className={compact ? 'text-xs text-muted-foreground' : 'text-sm text-muted-foreground'}>
            {desc}
          </div>
        </div>
      </div>
    </button>
  )
}

// ─────────────────── GMAIL STEPS 1-4 (info pages) ───────────────────

function GmailWalkthrough({
  title,
  body,
  note,
  warning,
  action,
  onBack,
  onNext,
  stepLabel,
}: {
  title: string
  body: string
  note?: string
  warning?: string
  action?: { label: string; url: string }
  onBack: () => void
  onNext: () => void
  stepLabel: string
}) {
  return (
    <>
      <DialogHeader>
        <div className="text-xs text-muted-foreground">{stepLabel}</div>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="whitespace-pre-line">{body}</DialogDescription>
      </DialogHeader>
      {action && (
        <div className="py-2">
          <Button asChild variant="default" className="w-full">
            <a href={action.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              {action.label}
            </a>
          </Button>
        </div>
      )}
      {note && (
        <div className="rounded-md bg-muted/50 border border-border p-3 text-xs text-muted-foreground">
          {note}
        </div>
      )}
      {warning && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-300 flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{warning}</span>
        </div>
      )}
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onBack}>
          {COPY.buttons.back}
        </Button>
        <Button type="button" onClick={onNext}>
          {COPY.buttons.next}
        </Button>
      </DialogFooter>
    </>
  )
}

function GmailStep1({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <GmailWalkthrough
      stepLabel="Step 1 di 5"
      title={COPY.gmail.step1.title}
      body={COPY.gmail.step1.body}
      action={{ label: COPY.gmail.step1.action, url: COPY.gmail.step1.url }}
      onBack={onBack}
      onNext={onNext}
    />
  )
}

function GmailStep2({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <GmailWalkthrough
      stepLabel="Step 2 di 5"
      title={COPY.gmail.step2.title}
      body={COPY.gmail.step2.body}
      note={COPY.gmail.step2.note}
      onBack={onBack}
      onNext={onNext}
    />
  )
}

function GmailStep3({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <GmailWalkthrough
      stepLabel="Step 3 di 5"
      title={COPY.gmail.step3.title}
      body={COPY.gmail.step3.body}
      onBack={onBack}
      onNext={onNext}
    />
  )
}

function GmailStep4({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <GmailWalkthrough
      stepLabel="Step 4 di 5"
      title={COPY.gmail.step4.title}
      body={COPY.gmail.step4.body}
      warning={COPY.gmail.step4.warning}
      onBack={onBack}
      onNext={onNext}
    />
  )
}

// ─────────────────── GMAIL STEP 5 — Paste form ───────────────────

function GmailPasteStep({
  initialEmail,
  onBack,
  onSubmit,
}: {
  initialEmail: string | undefined
  onBack: () => void
  onSubmit: (email: string, pass: string) => Promise<void>
}) {
  const [email, setEmail] = useState(initialEmail || '')
  const [pass, setPass] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // V15.0 WS8 — On-blur Gmail SMTP validation
  const [validation, setValidation] = useState<ValidationState>({ status: 'idle' })
  const validationReqRef = useRef(0)

  const cleanPass = pass.replace(/\s/g, '')
  const isValidPass = cleanPass.length === 16
  const allFilled = !!(email.trim() && isValidPass)

  useEffect(() => {
    setValidation({ status: 'idle' })
  }, [email, pass])

  async function runValidation() {
    if (!allFilled) return
    const reqId = ++validationReqRef.current
    setValidation({ status: 'validating' })
    try {
      const result = await api.auth.validateSmtp({
        smtpHost: 'smtp.gmail.com',
        smtpPort: 587,
        smtpUser: email.trim(),
        smtpPass: cleanPass,
      })
      if (reqId !== validationReqRef.current) return
      if (result.valid) setValidation({ status: 'valid' })
      else setValidation({ status: 'invalid', error: result.error || 'Errore sconosciuto' })
    } catch (err: unknown) {
      if (reqId !== validationReqRef.current) return
      const msg = err instanceof Error ? err.message : ''
      let errorText = 'Errore di rete. Riprova.'
      if (msg.includes('429')) errorText = 'Troppe verifiche in poco tempo. Aspetta qualche minuto.'
      else if (msg.includes('410')) errorText = 'Dashboard già claimato. Modifica config via SSH.'
      else if (msg.includes('500')) errorText = 'Errore server interno. Controlla i log backend.'
      else if (msg.includes('400')) errorText = 'Dati incompleti o non validi.'
      setValidation({ status: 'invalid', error: errorText })
    }
  }

  const canSubmit = validation.status === 'valid' && !submitting

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(email.trim(), cleanPass)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('429')) setError(COPY.errors.rate_limited)
      else if (msg.includes('410')) setError(COPY.errors.already_claimed)
      else if (msg.includes('400')) setError(COPY.errors.invalid_body)
      else setError(COPY.errors.setup_failed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <div className="text-xs text-muted-foreground">Step 5 di 5</div>
        <DialogTitle>{COPY.gmail.step5.title}</DialogTitle>
        <DialogDescription>{COPY.gmail.step5.body}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-3">
        <div className="space-y-1.5">
          <Label htmlFor="g-email">{COPY.gmail.step5.emailLabel}</Label>
          <Input
            id="g-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={COPY.gmail.step5.emailPlaceholder}
            required
            autoComplete="email"
            disabled={submitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-pass">{COPY.gmail.step5.passLabel}</Label>
          <div className="relative">
            <Input
              id="g-pass"
              type={showPass ? 'text' : 'password'}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder={COPY.gmail.step5.passPlaceholder}
              required
              autoComplete="off"
              disabled={submitting}
              className="pr-10"
              onBlur={() => {
                if (allFilled) void runValidation()
              }}
            />
            <button
              type="button"
              onClick={() => setShowPass((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {COPY.gmail.step5.passHint}{' '}
            <span className={isValidPass ? 'text-emerald-500' : pass ? 'text-amber-400' : ''}>
              {pass ? `${cleanPass.length}/16` : ''}
            </span>
          </p>
          <ValidationFeedback state={validation} />
        </div>
        {error && <div className="text-sm text-red-500">{error}</div>}
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
          {COPY.buttons.back}
        </Button>
        <Button
          type="submit"
          disabled={!canSubmit}
          title={!canSubmit ? COPY.validation.salvaDisabledTooltip : undefined}
        >
          {submitting ? 'Salvo…' : COPY.gmail.step5.submitBtn}
        </Button>
      </DialogFooter>
    </form>
  )
}

// ─────────────────── CUSTOM PROVIDER PICKER (WS8) ───────────────────

function CustomProviderPicker({
  onPickPreset,
  onBack,
}: {
  onPickPreset: (preset: (typeof SMTP_PRESETS)[number]) => void
  onBack: () => void
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{COPY.providerPicker.title}</DialogTitle>
        <DialogDescription>{COPY.providerPicker.body}</DialogDescription>
      </DialogHeader>
      <div className="space-y-2 py-3">
        {SMTP_PRESETS.map((preset) => (
          <ProviderCard
            key={preset.id}
            icon={preset.id === 'custom' ? <ServerCog className="w-5 h-5" /> : <Mail className="w-4 h-4" />}
            title={preset.label}
            desc={
              preset.id === 'custom'
                ? preset.hint
                : COPY.providerPicker.presetSubtitle(preset.host, preset.port)
            }
            highlight={preset.id !== 'custom'}
            compact={preset.id !== 'custom'}
            onClick={() => onPickPreset(preset)}
          />
        ))}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onBack}>
          {COPY.buttons.back}
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────────────────── VALIDATION FEEDBACK (WS8) ───────────────────

function ValidationFeedback({ state }: { state: ValidationState }) {
  if (state.status === 'idle') return null
  if (state.status === 'validating') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>{COPY.validation.validating}</span>
      </div>
    )
  }
  if (state.status === 'valid') {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-500">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>{COPY.validation.valid}</span>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 text-xs text-red-400">
      <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{state.error}</span>
    </div>
  )
}

// ─────────────────── CUSTOM SMTP ───────────────────

function CustomSmtpStep({
  draft,
  onBack,
  onSubmit,
}: {
  draft: {
    smtpHost?: string
    smtpPort?: number
    smtpUser?: string
    fromEmail?: string
    presetId?: string
  }
  onBack: () => void
  onSubmit: (payload: {
    smtpHost: string
    smtpPort: number
    smtpUser: string
    smtpPass: string
    fromEmail: string
  }) => Promise<void>
}) {
  // V15.0 WS8 — Preset support: host/port read-only se preset !== 'custom'
  const preset = SMTP_PRESETS.find((p) => p.id === draft.presetId)
  const isLockedHostPort = !!preset && preset.id !== 'custom'

  const [host, setHost] = useState(draft.smtpHost || preset?.host || '')
  const [port, setPort] = useState(draft.smtpPort || preset?.port || 587)
  const [user, setUser] = useState(draft.smtpUser || '')
  const [pass, setPass] = useState('')
  const [from, setFrom] = useState(draft.fromEmail || '')
  const [showPass, setShowPass] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // V15.0 WS8 — On-blur SMTP validation state
  const [validation, setValidation] = useState<ValidationState>({ status: 'idle' })
  const validationReqRef = useRef(0)

  // Reset validation se cambia un campo
  useEffect(() => {
    setValidation({ status: 'idle' })
  }, [host, port, user, pass])

  const allFilled = !!(host.trim() && port && user.trim() && pass)

  async function runValidation() {
    if (!allFilled) return
    const reqId = ++validationReqRef.current
    setValidation({ status: 'validating' })
    try {
      const result = await api.auth.validateSmtp({
        smtpHost: host.trim(),
        smtpPort: Number(port),
        smtpUser: user.trim(),
        smtpPass: pass,
      })
      // Ignora se nuova validation è partita nel frattempo
      if (reqId !== validationReqRef.current) return
      if (result.valid) setValidation({ status: 'valid' })
      else setValidation({ status: 'invalid', error: result.error || 'Errore sconosciuto' })
    } catch (err: unknown) {
      if (reqId !== validationReqRef.current) return
      const msg = err instanceof Error ? err.message : ''
      let errorText = 'Errore di rete. Riprova.'
      if (msg.includes('429')) errorText = 'Troppe verifiche in poco tempo. Aspetta qualche minuto.'
      else if (msg.includes('410')) errorText = 'Dashboard già claimato. Modifica config via SSH.'
      else if (msg.includes('500')) errorText = 'Errore server interno. Controlla i log backend.'
      else if (msg.includes('400')) errorText = 'Dati incompleti o non validi.'
      setValidation({ status: 'invalid', error: errorText })
    }
  }

  const canSubmit = validation.status === 'valid' && !submitting

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        smtpHost: host.trim(),
        smtpPort: Number(port),
        smtpUser: user.trim(),
        smtpPass: pass,
        fromEmail: (from || user).trim(),
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('429')) setError(COPY.errors.rate_limited)
      else if (msg.includes('410')) setError(COPY.errors.already_claimed)
      else setError(COPY.errors.setup_failed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>
          {preset && preset.id !== 'custom'
            ? COPY.customSmtp.titleWithPreset(preset.label)
            : COPY.customSmtp.title}
        </DialogTitle>
        <DialogDescription>
          {isLockedHostPort ? COPY.customSmtp.bodyWithPreset : COPY.customSmtp.body}
        </DialogDescription>
      </DialogHeader>

      {/* V15.0 WS8 — Hint provider-specifico */}
      {preset && preset.hint && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200 flex gap-2 my-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{preset.hint}</span>
        </div>
      )}

      <div className="space-y-3 py-1">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="c-host">{COPY.customSmtp.hostLabel}</Label>
            {isLockedHostPort && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {COPY.customSmtp.presetBadge}
              </span>
            )}
          </div>
          <Input
            id="c-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={COPY.customSmtp.hostPlaceholder}
            required
            disabled={submitting || isLockedHostPort}
            readOnly={isLockedHostPort}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-port">{COPY.customSmtp.portLabel}</Label>
          <Input
            id="c-port"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            disabled={submitting || isLockedHostPort}
            readOnly={isLockedHostPort}
          />
          {!isLockedHostPort && (
            <p className="text-xs text-muted-foreground">{COPY.customSmtp.portHint}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-user">{COPY.customSmtp.userLabel}</Label>
          <Input
            id="c-user"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder={COPY.customSmtp.userPlaceholder}
            required
            disabled={submitting}
            onBlur={() => {
              if (allFilled) void runValidation()
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-pass">{COPY.customSmtp.passLabel}</Label>
          <div className="relative">
            <Input
              id="c-pass"
              type={showPass ? 'text' : 'password'}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              required
              disabled={submitting}
              className="pr-10"
              onBlur={() => {
                if (allFilled) void runValidation()
              }}
            />
            <button
              type="button"
              onClick={() => setShowPass((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <ValidationFeedback state={validation} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-from">{COPY.customSmtp.fromLabel}</Label>
          <Input
            id="c-from"
            type="email"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder={user || 'auth@tuodominio.com'}
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">{COPY.customSmtp.fromHint}</p>
        </div>
        {error && <div className="text-sm text-red-500">{error}</div>}
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
          {COPY.buttons.back}
        </Button>
        <Button
          type="submit"
          disabled={!canSubmit}
          title={!canSubmit ? COPY.validation.salvaDisabledTooltip : undefined}
        >
          {submitting ? 'Salvo…' : COPY.customSmtp.submitBtn}
        </Button>
      </DialogFooter>
    </form>
  )
}

// ─────────────────── RESEND ───────────────────

function ResendStep({
  draft,
  onBack,
  onSubmit,
}: {
  draft: { fromEmail?: string }
  onBack: () => void
  onSubmit: (payload: { resendApiKey: string; fromEmail: string }) => Promise<void>
}) {
  const [apiKey, setApiKey] = useState('')
  const [from, setFrom] = useState(draft.fromEmail || '')
  const [showKey, setShowKey] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = apiKey.trim() && from.trim() && !submitting

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({ resendApiKey: apiKey.trim(), fromEmail: from.trim() })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('429')) setError(COPY.errors.rate_limited)
      else if (msg.includes('410')) setError(COPY.errors.already_claimed)
      else setError(COPY.errors.setup_failed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{COPY.resend.title}</DialogTitle>
        <DialogDescription>{COPY.resend.body}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-3">
        <div className="space-y-1.5">
          <Label htmlFor="r-key">{COPY.resend.apiKeyLabel}</Label>
          <div className="relative">
            <Input
              id="r-key"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={COPY.resend.apiKeyPlaceholder}
              required
              disabled={submitting}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-from">{COPY.resend.fromLabel}</Label>
          <Input
            id="r-from"
            type="email"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder={COPY.resend.fromPlaceholder}
            required
            disabled={submitting}
          />
        </div>
        {error && <div className="text-sm text-red-500">{error}</div>}
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
          {COPY.buttons.back}
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? 'Salvo…' : COPY.resend.submitBtn}
        </Button>
      </DialogFooter>
    </form>
  )
}

// ─────────────────── DEBUG ───────────────────

function DebugStep({ onBack, onSubmit }: { onBack: () => void; onSubmit: () => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('429')) setError(COPY.errors.rate_limited)
      else if (msg.includes('410')) setError(COPY.errors.already_claimed)
      else setError(COPY.errors.setup_failed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{COPY.debug.title}</DialogTitle>
        <DialogDescription>{COPY.debug.body}</DialogDescription>
      </DialogHeader>
      <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-300 flex gap-2 my-3">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>{COPY.debug.warning}</span>
      </div>
      {error && <div className="text-sm text-red-500 mb-3">{error}</div>}
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
          {COPY.buttons.back}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Salvo…' : COPY.debug.submitBtn}
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────────────────── DONE ───────────────────

function DoneStep({ onClose }: { onClose: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{COPY.done.title}</DialogTitle>
        <DialogDescription className="whitespace-pre-line">{COPY.done.body}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" onClick={onClose} className="w-full">
          {COPY.done.closeBtn}
        </Button>
      </DialogFooter>
    </>
  )
}

export default EmailProviderWizard
