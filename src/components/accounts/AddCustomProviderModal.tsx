import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, CheckCircle2, Plus, Trash2, Globe, Key, Terminal, Star } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  open: boolean
  onClose: () => void
}

const MODES = ['plan', 'api', 'cli', 'playwright'] as const
const CATEGORIES = ['text', 'image', 'video', 'audio', 'multimodal'] as const
const MODE_ICONS: Record<string, any> = { plan: Star, api: Key, cli: Terminal, playwright: Globe }

async function createCustomProvider(payload: any) {
  const res = await fetch('/api/accounts/providers/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'create failed')
  }
  return res.json()
}

export function AddCustomProviderModal({ open, onClose }: Props) {
  const queryClient = useQueryClient()
  const [id, setId] = useState('')
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState<string>('text')
  const [description, setDescription] = useState('')
  const [availableModels, setAvailableModels] = useState('')
  const [supportedModes, setSupportedModes] = useState<string[]>(['api'])

  // Per-mode config
  const [planCliName, setPlanCliName] = useState('')
  const [planLoginCmd, setPlanLoginCmd] = useState('')
  const [apiEnvVars, setApiEnvVars] = useState('') // comma-separated
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [apiCliWrapper, setApiCliWrapper] = useState('')
  const [cliName, setCliName] = useState('')
  const [cliInstallCmd, setCliInstallCmd] = useState('')
  const [playwrightUrl, setPlaywrightUrl] = useState('')

  const mut = useMutation({
    mutationFn: (payload: any) => createCustomProvider(payload),
    onSuccess: () => {
      toast.success('Provider custom creato', {
        description: 'Ora puoi creare account per questo provider dal wizard',
      })
      queryClient.invalidateQueries({ queryKey: ['providers'] })
      reset()
      onClose()
    },
    onError: (err) => toast.error('Errore', { description: String(err) }),
  })

  const reset = () => {
    setId('')
    setLabel('')
    setCategory('text')
    setDescription('')
    setAvailableModels('')
    setSupportedModes(['api'])
    setPlanCliName('')
    setPlanLoginCmd('')
    setApiEnvVars('')
    setApiBaseUrl('')
    setApiCliWrapper('')
    setCliName('')
    setCliInstallCmd('')
    setPlaywrightUrl('')
  }

  const toggleMode = (m: string) => {
    setSupportedModes((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    )
  }

  const canSubmit = !!id && !!label && supportedModes.length > 0 && !mut.isPending

  const handleSubmit = () => {
    if (!canSubmit) return

    const modeDefaults: any = {}
    if (supportedModes.includes('plan') && planCliName) {
      modeDefaults.plan = {
        cliName: planCliName.trim(),
        loginCmd: planLoginCmd.trim() || undefined,
      }
    }
    if (supportedModes.includes('api') && apiEnvVars) {
      modeDefaults.api = {
        envVars: apiEnvVars.split(',').map((e) => e.trim()).filter(Boolean),
        baseUrl: apiBaseUrl.trim() || undefined,
        cliWrapper: apiCliWrapper.trim() || undefined,
      }
    }
    if (supportedModes.includes('cli') && cliName) {
      modeDefaults.cli = {
        cliName: cliName.trim(),
        installCmd: cliInstallCmd.trim() || undefined,
      }
    }
    if (supportedModes.includes('playwright') && playwrightUrl) {
      modeDefaults.playwright = {
        url: playwrightUrl.trim(),
      }
    }

    const payload = {
      id: id.trim().toLowerCase(),
      label: label.trim(),
      category,
      description: description.trim() || undefined,
      availableModels: availableModels
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
      supportedModes,
      modeDefaults,
    }
    mut.mutate(payload)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-violet-400" />
            Aggiungi provider personalizzato
          </DialogTitle>
          <DialogDescription>
            Definisci un provider AI non presente nel catalogo. Appare subito nel wizard "Aggiungi
            account".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">ID (slug)</Label>
              <Input
                value={id}
                onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                placeholder="es. replicate"
                maxLength={64}
              />
              <p className="text-[10px] text-muted-foreground mt-1">lowercase, a-z 0-9 - _</p>
            </div>
            <div>
              <Label className="text-xs">Label</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="es. Replicate (image/video)"
                maxLength={200}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Modelli disponibili (virgola-separati)</Label>
              <Input
                value={availableModels}
                onChange={(e) => setAvailableModels(e.target.value)}
                placeholder="flux-pro, sdxl, ..."
                maxLength={500}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Descrizione (opzionale)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Cosa fa questo provider?"
              maxLength={1000}
              rows={2}
            />
          </div>

          <div>
            <Label className="text-xs mb-2 block">Modi supportati</Label>
            <div className="grid grid-cols-2 gap-2">
              {MODES.map((m) => {
                const Icon = MODE_ICONS[m]
                const checked = supportedModes.includes(m)
                return (
                  <label
                    key={m}
                    className="flex items-center gap-2 p-2 border border-border rounded cursor-pointer hover:bg-accent/50"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleMode(m)}
                    />
                    <Icon className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-sm capitalize">{m}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Mode-specific config */}
          {supportedModes.includes('plan') && (
            <div className="space-y-2 border-l-2 border-violet-500/30 pl-3">
              <div className="text-xs font-semibold flex items-center gap-1">
                <Star className="w-3 h-3 text-violet-400" /> Config Plan
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px]">CLI name</Label>
                  <Input
                    value={planCliName}
                    onChange={(e) => setPlanCliName(e.target.value)}
                    placeholder="es. mycli"
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Login command</Label>
                  <Input
                    value={planLoginCmd}
                    onChange={(e) => setPlanLoginCmd(e.target.value)}
                    placeholder="mycli login"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {supportedModes.includes('api') && (
            <div className="space-y-2 border-l-2 border-blue-500/30 pl-3">
              <div className="text-xs font-semibold flex items-center gap-1">
                <Key className="w-3 h-3 text-blue-400" /> Config API
              </div>
              <div>
                <Label className="text-[10px]">Env var name(s) — virgola-separati</Label>
                <Input
                  value={apiEnvVars}
                  onChange={(e) => setApiEnvVars(e.target.value)}
                  placeholder="REPLICATE_API_KEY"
                  className="h-8 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px]">Base URL (opz.)</Label>
                  <Input
                    value={apiBaseUrl}
                    onChange={(e) => setApiBaseUrl(e.target.value)}
                    placeholder="https://api.replicate.com"
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px]">CLI wrapper (opz.)</Label>
                  <Input
                    value={apiCliWrapper}
                    onChange={(e) => setApiCliWrapper(e.target.value)}
                    placeholder="replicate"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {supportedModes.includes('cli') && (
            <div className="space-y-2 border-l-2 border-emerald-500/30 pl-3">
              <div className="text-xs font-semibold flex items-center gap-1">
                <Terminal className="w-3 h-3 text-emerald-400" /> Config CLI
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px]">CLI name</Label>
                  <Input
                    value={cliName}
                    onChange={(e) => setCliName(e.target.value)}
                    placeholder="mycli"
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Install command</Label>
                  <Input
                    value={cliInstallCmd}
                    onChange={(e) => setCliInstallCmd(e.target.value)}
                    placeholder="npm install -g mycli"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {supportedModes.includes('playwright') && (
            <div className="space-y-2 border-l-2 border-amber-500/30 pl-3">
              <div className="text-xs font-semibold flex items-center gap-1">
                <Globe className="w-3 h-3 text-amber-400" /> Config Playwright (web)
              </div>
              <div>
                <Label className="text-[10px]">URL chat web</Label>
                <Input
                  value={playwrightUrl}
                  onChange={(e) => setPlaywrightUrl(e.target.value)}
                  placeholder="https://provider.example.com/chat"
                  className="h-8 text-xs"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Serve un flow module in <code className="bg-muted px-1 rounded">scripts/playwright-flows/{id || 'id'}.js</code>
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={mut.isPending}>
            Annulla
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit} className="gap-1.5">
            {mut.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Creo...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" /> Crea provider
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
