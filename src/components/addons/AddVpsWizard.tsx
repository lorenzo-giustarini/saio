import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Key, Upload, Copy, CheckCircle2, XCircle, Loader2, ArrowRight, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type WizardStep = 'scenario' | 'gen-key' | 'paste-key' | 'connect'
type Scenario = 'new-key' | 'existing-key' | null

interface KeyResult {
  publicKey: string
  publicKeyPath: string
  privateKeyPath: string
  comment: string
}

interface TestResult {
  ok: boolean
  latencyMs?: number
  hostname?: string
  error?: string
}

export function AddVpsWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [step, setStep] = useState<WizardStep>('scenario')
  const [scenario, setScenario] = useState<Scenario>(null)
  const [vpsId, setVpsId] = useState('')
  const [label, setLabel] = useState('')
  const [keyName, setKeyName] = useState('')
  const [pubKeyPaste, setPubKeyPaste] = useState('')
  const [generatedKey, setGeneratedKey] = useState<KeyResult | null>(null)
  const [ip, setIp] = useState('')
  const [user, setUser] = useState('root')
  const [category, setCategory] = useState<'production' | 'staging' | 'experimental' | 'unknown'>('unknown')
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  const reset = () => {
    setStep('scenario')
    setScenario(null)
    setVpsId('')
    setLabel('')
    setKeyName('')
    setPubKeyPaste('')
    setGeneratedKey(null)
    setIp('')
    setUser('root')
    setCategory('unknown')
    setTestResult(null)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const keygenMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/vps/ssh-keygen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyName, vpsId }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'keygen failed')
      return (await res.json()) as KeyResult
    },
    onSuccess: (result) => {
      setGeneratedKey(result)
      toast.success('Chiave SSH generata')
    },
    onError: (err: any) => toast.error(err.message),
  })

  const testMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/vps/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, user, keyName }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'test failed')
      return (await res.json()) as TestResult
    },
    onSuccess: (result) => {
      setTestResult(result)
      if (result.ok) toast.success(`Connesso (${result.latencyMs}ms)`)
      else toast.error(`Connessione fallita: ${result.error}`)
    },
    onError: (err: any) => toast.error(err.message),
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/vps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: vpsId,
          ip,
          label,
          keyName,
          category,
          hostname: testResult?.hostname,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'save failed')
      return res.json()
    },
    onSuccess: () => {
      toast.success(`VPS "${label}" aggiunta`)
      qc.invalidateQueries({ queryKey: ['vps'] })
      handleClose()
    },
    onError: (err: any) => toast.error(err.message),
  })

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copiato negli appunti')
  }

  const canTest = ip && /^[a-zA-Z0-9.-]+$/.test(ip) && user && keyName
  const canSave = testResult?.ok && vpsId && label && /^[a-z0-9-]{3,32}$/.test(vpsId)

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-amber-400" />
            Aggiungi nuova VPS
          </DialogTitle>
          <DialogDescription>
            Wizard 3-step: scegli scenario, configura chiave SSH, testa e salva.
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        <div className="flex items-center gap-2 text-xs">
          {(['scenario', 'gen-key', 'connect'] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold',
                step === s ? 'bg-amber-500/30 text-amber-200 border border-amber-400'
                : (step === 'connect' || (step === 'gen-key' && i === 0) || (step === 'paste-key' && i === 0))
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-muted text-muted-foreground'
              )}>
                {i + 1}
              </div>
              <span className="text-muted-foreground">
                {s === 'scenario' ? 'Scenario' : s === 'gen-key' ? 'Chiave SSH' : 'Connetti'}
              </span>
              {i < 2 && <ArrowRight className="w-3 h-3 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {/* === STEP 1: scenario === */}
        {step === 'scenario' && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Hai già una chiave SSH per questa VPS?</p>
            <button
              type="button"
              onClick={() => { setScenario('new-key'); setStep('gen-key') }}
              className="w-full text-left p-3 border border-border hover:border-amber-400 rounded-md transition-colors"
            >
              <div className="flex items-center gap-2 font-semibold text-sm">
                <Key className="w-4 h-4 text-amber-400" />
                🆕 Crea chiave SSH per me <span className="text-emerald-400 text-[10px]">(consigliato)</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Genero una chiave ed25519 e ti mostro la pubblica da incollare sul provider VPS (Hetzner, DigitalOcean, ecc).
              </p>
            </button>
            <button
              type="button"
              onClick={() => { setScenario('existing-key'); setStep('paste-key') }}
              className="w-full text-left p-3 border border-border hover:border-amber-400 rounded-md transition-colors"
            >
              <div className="flex items-center gap-2 font-semibold text-sm">
                <Upload className="w-4 h-4 text-blue-400" />
                🔑 Ho già una chiave SSH
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Indica il nome del file in <code>~/.ssh/</code> (es. <code>id_ed25519</code>) e procedi al test.
              </p>
            </button>
          </div>
        )}

        {/* === STEP 2A: gen-key === */}
        {step === 'gen-key' && (
          <div className="space-y-3 py-2">
            {!generatedKey ? (
              <>
                <div>
                  <label className="text-xs text-muted-foreground">ID VPS (lowercase, 3-32 char)</label>
                  <Input
                    value={vpsId}
                    onChange={(e) => {
                      const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
                      setVpsId(v)
                      if (!keyName) setKeyName(`${v}_key`)
                    }}
                    placeholder="onweb24-staging"
                    maxLength={32}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Label friendly</label>
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="OnWeb24 staging Hetzner"
                    maxLength={100}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Nome file chiave (~/.ssh/&lt;nome&gt;)</label>
                  <Input
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="onweb24-staging_key"
                    maxLength={64}
                  />
                </div>
                <Button
                  onClick={() => keygenMut.mutate()}
                  disabled={!vpsId || !label || !keyName || keygenMut.isPending}
                  className="w-full"
                >
                  {keygenMut.isPending ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" /> Generando...</> : <><Key className="w-3 h-3 mr-2" /> Genera coppia chiave SSH</>}
                </Button>
              </>
            ) : (
              <>
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded text-xs">
                  <div className="font-semibold text-emerald-300 mb-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Chiave generata
                  </div>
                  <div className="text-muted-foreground">
                    Privata: <code className="text-[10px]">{generatedKey.privateKeyPath}</code>
                    <br />Pubblica: <code className="text-[10px]">{generatedKey.publicKeyPath}</code>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Chiave pubblica (incolla questa sul tuo provider VPS)</label>
                  <Textarea
                    readOnly
                    value={generatedKey.publicKey}
                    className="text-[10px] font-mono min-h-[80px]"
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1 gap-1 text-xs"
                    onClick={() => copyToClipboard(generatedKey.publicKey)}
                  >
                    <Copy className="w-3 h-3" /> Copia chiave pubblica
                  </Button>
                </div>
                <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded text-[11px] text-amber-200">
                  <strong>Prossimo step</strong>: incolla questa chiave nel tuo provider VPS (Hetzner Console → Server → SSH Keys, oppure quando crei un nuovo server). Poi torna qui e clicca Avanti.
                </div>
                <Button onClick={() => setStep('connect')} className="w-full gap-2">
                  Ho incollato la chiave sul provider <ArrowRight className="w-3 h-3" />
                </Button>
              </>
            )}
          </div>
        )}

        {/* === STEP 2B: paste-key (existing) === */}
        {step === 'paste-key' && (
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-muted-foreground">ID VPS (lowercase, 3-32 char)</label>
              <Input
                value={vpsId}
                onChange={(e) => setVpsId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="onweb24-staging"
                maxLength={32}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Label friendly</label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="OnWeb24 staging"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Nome file chiave esistente in ~/.ssh/</label>
              <Input
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="id_ed25519 (o claude_vps, ecc.)"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Esempi: <code>id_ed25519</code>, <code>claude_vps</code>. NON includere <code>.pub</code>.
              </p>
            </div>
            <Button
              onClick={() => setStep('connect')}
              disabled={!vpsId || !label || !keyName}
              className="w-full gap-2"
            >
              Avanti <ArrowRight className="w-3 h-3" />
            </Button>
          </div>
        )}

        {/* === STEP 3: connect === */}
        {step === 'connect' && (
          <div className="space-y-3 py-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">IP / hostname</label>
                <Input
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  placeholder="46.224.60.230"
                />
              </div>
              <div className="w-32">
                <label className="text-xs text-muted-foreground">User SSH</label>
                <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="root" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Categoria</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full text-sm bg-background border border-border rounded px-2 py-1.5 h-9"
              >
                <option value="production">Production</option>
                <option value="staging">Staging</option>
                <option value="experimental">Experimental</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <Button
              onClick={() => testMut.mutate()}
              disabled={!canTest || testMut.isPending}
              variant="outline"
              className="w-full gap-2"
            >
              {testMut.isPending ? <><Loader2 className="w-3 h-3 animate-spin" /> Connessione...</> : 'Test connessione SSH'}
            </Button>
            {testResult && (
              <div className={cn(
                'p-3 rounded text-xs flex items-start gap-2',
                testResult.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-200' : 'bg-red-500/10 border border-red-500/30 text-red-200'
              )}>
                {testResult.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <XCircle className="w-4 h-4 mt-0.5" />}
                <div className="flex-1">
                  {testResult.ok ? (
                    <>
                      <div className="font-semibold">Connesso ({testResult.latencyMs}ms)</div>
                      {testResult.hostname && <div className="text-[10px]">Hostname remoto: {testResult.hostname}</div>}
                    </>
                  ) : (
                    <>
                      <div className="font-semibold">Connessione fallita</div>
                      <div className="text-[10px] font-mono break-all">{testResult.error}</div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step !== 'scenario' && (
            <Button variant="ghost" onClick={() => setStep('scenario')} disabled={saveMut.isPending}>
              <ArrowLeft className="w-3 h-3 mr-1" /> Indietro
            </Button>
          )}
          <Button variant="outline" onClick={handleClose} disabled={saveMut.isPending}>
            Annulla
          </Button>
          {step === 'connect' && (
            <Button
              onClick={() => saveMut.mutate()}
              disabled={!canSave || saveMut.isPending}
              className="gap-2"
            >
              {saveMut.isPending ? <><Loader2 className="w-3 h-3 animate-spin" /> Salvando...</> : <><CheckCircle2 className="w-3 h-3" /> Salva VPS</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
