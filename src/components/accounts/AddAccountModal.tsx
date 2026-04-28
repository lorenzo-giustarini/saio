import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronLeft, ChevronRight, Loader2, CheckCircle2, Sparkles, Key, Terminal, Globe, Star, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const MODE_ICONS: Record<string, any> = {
  plan: Star,
  api: Key,
  cli: Terminal,
  playwright: Globe,
}

const MODE_DESCRIPTIONS: Record<string, string> = {
  plan: 'Usa subscription (Pro/Plus) tramite login CLI salvato',
  api: 'Usa API key via env var (pay-per-use)',
  cli: 'CLI diretta senza subscription',
  playwright: 'Automazione browser web (fragile, richiede login manuale)',
}

const MODE_LABELS_SHORT: Record<string, string> = {
  plan: 'Plan',
  api: 'API',
  cli: 'CLI',
  playwright: 'Web',
}

const MODE_BADGE_COLORS: Record<string, string> = {
  plan: 'bg-violet-500/15 border-violet-500/40 text-violet-200',
  api: 'bg-blue-500/15 border-blue-500/40 text-blue-200',
  cli: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200',
  playwright: 'bg-amber-500/15 border-amber-500/40 text-amber-200',
}

interface Props {
  open: boolean
  onClose: () => void
}

export function AddAccountModal({ open, onClose }: Props) {
  const [step, setStep] = useState(1)
  const [providerId, setProviderId] = useState('')
  const [mode, setMode] = useState('')
  const [label, setLabel] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [envVarRef, setEnvVarRef] = useState('')
  const [cliName, setCliName] = useState('')
  const [search, setSearch] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saveApiKey, setSaveApiKey] = useState(true)

  // V13.2-T3: check esistenti account per provider+mode (multi-account support)
  const existingAccounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts.list(),
    enabled: open,
  })

  const duplicatesForSelection = useMemo(() => {
    if (!providerId || !mode) return []
    return (existingAccounts.data?.accounts || []).filter(
      (a) => a.providerId === providerId && a.mode === mode
    )
  }, [existingAccounts.data, providerId, mode])

  // Conta account per provider e provider+mode (per badge UX step 1/2)
  const accountsByProvider = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of existingAccounts.data?.accounts || []) {
      map.set(a.providerId, (map.get(a.providerId) || 0) + 1)
    }
    return map
  }, [existingAccounts.data])

  const accountsByProviderMode = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of existingAccounts.data?.accounts || []) {
      const key = `${a.providerId}|${a.mode}`
      map.set(key, (map.get(key) || 0) + 1)
    }
    return map
  }, [existingAccounts.data])

  const totalExistingAccounts = (existingAccounts.data?.accounts || []).length

  const queryClient = useQueryClient()

  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.providers.list(),
    enabled: open,
  })

  const selectedProvider = useMemo(
    () => providers.data?.providers.find((p: any) => p.id === providerId),
    [providers.data, providerId]
  )

  const createMut = useMutation({
    mutationFn: async (payload: any) => {
      const created = await api.accounts.create(payload)
      // V13.1: se mode=api + chiave inserita + saveApiKey → salva in settings.json
      if (payload.mode === 'api' && apiKey.trim() && saveApiKey) {
        try {
          await api.accounts.setSecret(created.id, apiKey.trim())
        } catch (err: any) {
          toast.warning('Account creato ma salvataggio chiave fallito', {
            description: String(err.message || err),
          })
        }
      }
      return created
    },
    onSuccess: () => {
      toast.success('Account creato', {
        description: apiKey.trim() && saveApiKey ? 'Chiave API salvata in settings.json' : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['accounts-health'] })
      reset()
      onClose()
    },
    onError: (err) => toast.error('Errore creazione', { description: String(err) }),
  })

  const reset = () => {
    setStep(1)
    setProviderId('')
    setMode('')
    setLabel('')
    setDefaultModel('')
    setEnvVarRef('')
    setCliName('')
    setSearch('')
    setApiKey('')
    setSaveApiKey(true)
  }

  // V13.1 T1.1: filtered provider list
  const filteredProviders = useMemo(() => {
    const all = providers.data?.providers || []
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter((p: any) => {
      const haystack = [p.label, p.id, p.description, p.category, ...(p.supportedModes || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [providers.data, search])

  const handleClose = () => {
    if (!createMut.isPending) {
      reset()
      onClose()
    }
  }

  const canNext1 = !!providerId
  const canNext2 = !!mode
  const canCreate = !!label && !!providerId && !!mode

  // Auto-populate from selected provider on step change
  const handleProviderSelect = (id: string) => {
    setProviderId(id)
    const prov = providers.data?.providers.find((p: any) => p.id === id)
    if (prov?.availableModels?.[0]) setDefaultModel(prov.availableModels[0])
  }

  const handleModeSelect = (m: string) => {
    setMode(m)
    const prov = providers.data?.providers.find((p: any) => p.id === providerId)
    if (!prov) return
    // Auto-populate label and config based on mode (con suffix #N+1 se esistono già duplicati)
    const providerBase = prov.label.replace(/\s*\(.*\)$/, '')
    const modeLabels: Record<string, string> = { plan: 'Plan', api: 'API', cli: 'CLI', playwright: 'Web' }
    const baseLabel = `${providerBase} ${modeLabels[m]}`
    const existingCount = accountsByProviderMode.get(`${providerId}|${m}`) || 0
    setLabel(existingCount > 0 ? `${baseLabel} #${existingCount + 1}` : baseLabel)

    if (m === 'plan' && prov.modeDefaults.plan?.cliName) {
      setCliName(prov.modeDefaults.plan.cliName)
    } else if (m === 'api' && prov.modeDefaults.api?.envVars?.[0]) {
      setEnvVarRef(prov.modeDefaults.api.envVars[0])
      setCliName(prov.modeDefaults.api.cliWrapper || prov.modeDefaults.cli?.cliName || '')
    } else if (m === 'cli' && prov.modeDefaults.cli?.cliName) {
      setCliName(prov.modeDefaults.cli.cliName)
    }
  }

  const handleCreate = () => {
    const id = `${providerId}-${mode}-${Date.now().toString(36).slice(-4)}`
    createMut.mutate({
      id,
      providerId,
      mode,
      label,
      defaultModel: defaultModel || undefined,
      envVarRef: envVarRef || undefined,
      cliName: cliName || undefined,
      createdBy: 'user',
      createdAt: new Date().toISOString(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-400" />
            Aggiungi account AI (step {step}/3)
          </DialogTitle>
          <DialogDescription>
            {step === 1 && 'Scegli il provider AI'}
            {step === 2 && 'Scegli il mode (come ti colleghi)'}
            {step === 3 && 'Conferma nome e parametri'}
          </DialogDescription>
        </DialogHeader>

        {/* STEP 1 — Provider */}
        {step === 1 && (
          <div className="space-y-2">
            {/* V13.5: hint — chiarisce che provider già configurati restano cliccabili */}
            {totalExistingAccounts > 0 && (
              <div className="rounded-md border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-[11px] text-violet-200/90">
                💡 Puoi creare <strong>più account dello stesso provider</strong> — basta usare una label distintiva
                (es. "Personal" vs "Cliente Herbalife"). I provider già configurati hanno il badge{' '}
                <code className="bg-muted/40 px-1 rounded">+N</code>: cliccaci sopra per aggiungerne un altro.
              </div>
            )}
            {/* V13.1 T1.1: search bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca provider per nome, categoria, modo..."
                className="pl-9"
                autoFocus
              />
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto scrollbar-thin">
              {providers.isLoading && (
                <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Caricamento...
                </div>
              )}
              {filteredProviders.length === 0 && !providers.isLoading && (
                <div className="text-xs text-muted-foreground italic text-center py-6">
                  Nessun provider per "{search}"
                </div>
              )}
              {filteredProviders.map((p: any) => {
                const existingCount = accountsByProvider.get(p.id) || 0
                return (
                  <button
                    key={p.id}
                    onClick={() => handleProviderSelect(p.id)}
                    className={cn(
                      'w-full text-left p-3 rounded-md border transition-all hover:border-primary/50',
                      providerId === p.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border'
                    )}
                  >
                    {/* Riga 1: nome provider in primo piano + meta a destra */}
                    <div className="flex items-center gap-2">
                      {providerId === p.id && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
                      <span className="font-semibold text-sm truncate">{p.label}</span>
                      {p.custom && (
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-violet-500/40 text-violet-300">
                          custom
                        </Badge>
                      )}
                      {existingCount > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[9px] h-4 px-1.5 border-violet-500/40 bg-violet-500/10 text-violet-300"
                          title={`Hai già ${existingCount} account per ${p.label} · clicca per aggiungerne un altro`}
                        >
                          +{existingCount}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5 ml-auto capitalize">
                        {p.category}
                      </Badge>
                    </div>

                    {/* Riga 2: chips colorate "Come ti colleghi" — ben visibili */}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <span className="text-[10px] text-muted-foreground/70 mr-0.5">Disponibile via:</span>
                      {p.supportedModes.map((m: string) => {
                        const Icon = MODE_ICONS[m] || Sparkles
                        return (
                          <span
                            key={m}
                            className={cn(
                              'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border',
                              MODE_BADGE_COLORS[m] || 'bg-muted/30 border-border text-muted-foreground'
                            )}
                            title={MODE_DESCRIPTIONS[m] || m}
                          >
                            <Icon className="w-2.5 h-2.5" />
                            {MODE_LABELS_SHORT[m] || m}
                          </span>
                        )
                      })}
                    </div>

                    {/* Riga 3 (opzionale): descrizione provider */}
                    {p.description && (
                      <div className="text-[10px] text-muted-foreground mt-1 line-clamp-1">
                        {p.description}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* STEP 2 — Mode */}
        {step === 2 && selectedProvider && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground mb-2">
              Provider: <Badge variant="outline">{selectedProvider.label}</Badge>
            </div>
            {selectedProvider.supportedModes.map((m: string) => {
              const Icon = MODE_ICONS[m] || Sparkles
              return (
                <button
                  key={m}
                  onClick={() => handleModeSelect(m)}
                  className={cn(
                    'w-full text-left p-3 rounded-md border transition-all hover:border-primary/50',
                    mode === m ? 'border-primary bg-primary/5' : 'border-border'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-violet-400" />
                    <span className="font-medium text-sm capitalize">{m}</span>
                    {(() => {
                      const count = accountsByProviderMode.get(`${providerId}|${m}`) || 0
                      if (count === 0) return null
                      return (
                        <Badge
                          variant="outline"
                          className="text-[9px] h-4 px-1.5 ml-auto border-violet-500/40 bg-violet-500/10 text-violet-300"
                          title={`Hai già ${count} account in ${m} per questo provider · clicca per aggiungerne un altro`}
                        >
                          Già {count}
                        </Badge>
                      )
                    })()}
                    {mode === m && <CheckCircle2 className={cn('w-4 h-4 text-primary', !accountsByProviderMode.get(`${providerId}|${m}`) && 'ml-auto')} />}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {MODE_DESCRIPTIONS[m]}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* STEP 3 — Config */}
        {step === 3 && selectedProvider && (
          <div className="space-y-4">
            {/* V13.5: positive duplicate hint (era warning amber, ora info violet) */}
            {duplicatesForSelection.length > 0 && (
              <div className="rounded-md border border-violet-500/30 bg-violet-500/5 p-2.5 text-xs">
                <div className="font-medium text-violet-200 mb-1">
                  💡 Stai aggiungendo il {duplicatesForSelection.length + 1}° account per {selectedProvider.label} / {mode}
                </div>
                <ul className="text-[11px] text-muted-foreground ml-4 list-disc">
                  {duplicatesForSelection.map((a) => (
                    <li key={a.id}>
                      <code className="bg-muted/40 px-1 rounded">{a.label}</code>
                    </li>
                  ))}
                </ul>
                <div className="text-[10px] text-muted-foreground mt-1.5 italic">
                  Per distinguerlo, modifica la label sotto (es. aggiungi "Personal" / "Cliente X" / "#{duplicatesForSelection.length + 1}").
                </div>
              </div>
            )}

            <div>
              <Label className="text-xs">
                Nome account <span className="text-muted-foreground">(distintivo, es. "Mio" vs "Cliente Herbalife")</span>
              </Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
            </div>

            {selectedProvider.availableModels?.length > 0 && (
              <div>
                <Label className="text-xs">Modello default</Label>
                <Select value={defaultModel} onValueChange={setDefaultModel}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="(nessuno)" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedProvider.availableModels.map((m: string) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {mode === 'api' && (
              <>
                <div>
                  <Label className="text-xs">Env var (nome, non valore)</Label>
                  <Input
                    value={envVarRef}
                    onChange={(e) => setEnvVarRef(e.target.value)}
                    placeholder="es. ANTHROPIC_API_KEY"
                    maxLength={100}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Il valore verrà letto da <code className="bg-muted px-1 rounded">process.env</code> o da
                    <code className="bg-muted px-1 rounded ml-1">~/.claude/settings.json</code>
                  </p>
                </div>

                {/* V13.1 T3.1: API key input inline */}
                <div className="border-l-2 border-blue-500/40 pl-3 space-y-2 bg-blue-500/5 rounded p-3">
                  <Label className="text-xs flex items-center gap-1.5">
                    <Key className="w-3 h-3 text-blue-400" />
                    Chiave API (opzionale — incollala per usarla subito)
                  </Label>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-... (NON verrà loggata, salvata solo in settings.json)"
                    maxLength={10000}
                    autoComplete="off"
                  />
                  <label className="flex items-center gap-2 text-[10px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saveApiKey}
                      onChange={(e) => setSaveApiKey(e.target.checked)}
                      className="rounded"
                    />
                    Salva in <code className="bg-muted px-1 rounded">~/.claude/settings.json</code> (default)
                  </label>
                  <p className="text-[10px] text-muted-foreground">
                    Se lasci vuoto, dovrai impostare la variabile{' '}
                    <code className="bg-muted px-1 rounded">{envVarRef || 'ENV_VAR'}</code> manualmente.
                  </p>
                </div>
              </>
            )}

            {(mode === 'plan' || mode === 'cli' || mode === 'api') && (
              <div>
                <Label className="text-xs">CLI binary (opzionale)</Label>
                <Input
                  value={cliName}
                  onChange={(e) => setCliName(e.target.value)}
                  placeholder="es. claude / codex / gemini / aichat"
                  maxLength={64}
                />
              </div>
            )}

            <div className="pt-3 border-t border-border">
              <div className="text-[10px] text-muted-foreground">Riepilogo:</div>
              <div className="flex flex-wrap gap-1 mt-1">
                <Badge variant="outline">{selectedProvider.label}</Badge>
                <Badge variant="outline">{mode}</Badge>
                {defaultModel && <Badge variant="outline">{defaultModel}</Badge>}
                {envVarRef && <Badge variant="outline">env: {envVarRef}</Badge>}
                {cliName && <Badge variant="outline">cli: {cliName}</Badge>}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="flex justify-between gap-2">
          <div>
            {step > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(step - 1)}
                disabled={createMut.isPending}
                className="gap-1.5"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Indietro
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleClose}>
              Annulla
            </Button>
            {step === 1 && (
              <Button size="sm" disabled={!canNext1} onClick={() => setStep(2)} className="gap-1.5">
                Avanti
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            )}
            {step === 2 && (
              <Button size="sm" disabled={!canNext2} onClick={() => setStep(3)} className="gap-1.5">
                Avanti
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            )}
            {step === 3 && (
              <Button
                size="sm"
                disabled={!canCreate || createMut.isPending}
                onClick={handleCreate}
                className="gap-1.5"
              >
                {createMut.isPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Creo...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Crea account
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
