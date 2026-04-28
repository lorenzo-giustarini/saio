/**
 * V15.0 WS13 — Autoscan filesystem + import progetti.
 *
 * Step:
 *   0 Intro / scelta root paths
 *   1 Scanning (progress)
 *   2 Risultati (checkbox per import)
 *   3 Done
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ScanLine,
  Folder,
  Github,
  BookOpen,
  Package,
  Bot,
  Plug,
  CheckCircle2,
  Loader2,
  AlertCircle,
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

type Step = 'mode' | 'paths' | 'scanning' | 'results' | 'done'

type ScanMode = 'quick' | 'deep' | 'targeted'

interface DetectedItem {
  kind:
    | 'git'
    | 'obsidian-vault'
    | 'node-project'
    | 'python-project'
    | 'claude-agents'
    | 'mcp-config'
    | 'github-repo'
  path: string
  name: string
  meta: Record<string, unknown>
}

interface ScanResult {
  found: DetectedItem[]
  scannedDirs: number
  abortedReason?: 'timeout' | 'max_dirs'
  mode: ScanMode
}

const KIND_ICONS: Record<DetectedItem['kind'], ReactElement> = {
  git: <Github className="w-4 h-4" />,
  'obsidian-vault': <BookOpen className="w-4 h-4 text-purple-400" />,
  'node-project': <Package className="w-4 h-4 text-emerald-400" />,
  'python-project': <Package className="w-4 h-4 text-blue-400" />,
  'claude-agents': <Bot className="w-4 h-4 text-amber-400" />,
  'mcp-config': <Plug className="w-4 h-4 text-pink-400" />,
  'github-repo': <Github className="w-4 h-4 text-cyan-400" />,
}

const KIND_LABELS: Record<DetectedItem['kind'], string> = {
  git: 'Git repository (locale)',
  'obsidian-vault': 'Vault Obsidian',
  'node-project': 'Progetto Node.js',
  'python-project': 'Progetto Python',
  'claude-agents': 'Claude agents',
  'mcp-config': 'MCP config',
  'github-repo': 'GitHub repo (remote)',
}

interface Props {
  open: boolean
  onClose: () => void
}

export function AutoScanWizard({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>('mode')
  const [mode, setMode] = useState<ScanMode>('quick')
  const [targetNames, setTargetNames] = useState('')
  const [rootPaths, setRootPaths] = useState<string[]>([])
  const [customPath, setCustomPath] = useState('')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  // Fetch default roots all'apertura
  const { data: defaults } = useQuery({
    queryKey: ['scan', 'default-roots'],
    queryFn: async () => {
      const res = await fetch('/api/scan/default-roots', { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      return (await res.json()) as { roots: string[]; home: string }
    },
    enabled: open && (step === 'mode' || step === 'paths'),
    retry: false,
  })

  useEffect(() => {
    if (defaults && rootPaths.length === 0) {
      setRootPaths([...defaults.roots.slice(0, 3)])
    }
  }, [defaults, rootPaths.length])

  const startScan = useMutation({
    mutationFn: async (payload: { rootPaths: string[]; mode: ScanMode; targetNames?: string[] }) => {
      // Trigger fs scan
      const fsRes = await fetch('/api/scan/start', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!fsRes.ok) throw new Error(String(fsRes.status))
      const fsResult = (await fsRes.json()) as ScanResult

      // Trigger GitHub scan in parallelo (non-bloccante: 409 se no token)
      try {
        const ghRes = await fetch('/api/scan/github', { credentials: 'include' })
        if (ghRes.ok) {
          const ghData = (await ghRes.json()) as { repos: DetectedItem[] }
          fsResult.found = [...fsResult.found, ...ghData.repos]
        }
      } catch {
        /* GitHub optional */
      }
      return fsResult
    },
    onSuccess: (r) => {
      setResult(r)
      setStep('results')
    },
    onError: (err: unknown) => {
      setError('Scan fallito: ' + (err instanceof Error ? err.message : 'unknown'))
      setStep('mode')
    },
  })

  const importItems = useMutation({
    mutationFn: async (items: DetectedItem[]) => {
      const payload = {
        items: items.map((i) => ({ path: i.path, kind: i.kind, name: i.name })),
      }
      const res = await fetch('/api/scan/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(String(res.status))
      return (await res.json()) as { ok: boolean; added: number; total: number }
    },
    onSuccess: () => setStep('done'),
    onError: (err: unknown) => setError('Import fallito: ' + (err instanceof Error ? err.message : '')),
  })

  function toggleSel(path: string): void {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function toggleAllOfKind(kind: DetectedItem['kind']): void {
    if (!result) return
    const ofKind = result.found.filter((f) => f.kind === kind)
    setSelected((cur) => {
      const next = new Set(cur)
      const allChecked = ofKind.every((f) => next.has(f.path))
      if (allChecked) ofKind.forEach((f) => next.delete(f.path))
      else ofKind.forEach((f) => next.add(f.path))
      return next
    })
  }

  function reset(): void {
    setStep('mode')
    setMode('quick')
    setTargetNames('')
    setRootPaths([])
    setResult(null)
    setSelected(new Set())
    setError(null)
  }

  const groupedResults = useMemo(() => {
    if (!result) return new Map<DetectedItem['kind'], DetectedItem[]>()
    const m = new Map<DetectedItem['kind'], DetectedItem[]>()
    for (const item of result.found) {
      if (!m.has(item.kind)) m.set(item.kind, [])
      m.get(item.kind)!.push(item)
    }
    return m
  }, [result])

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset()
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
        {step === 'mode' && (
          <ModeStep
            mode={mode}
            setMode={setMode}
            targetNames={targetNames}
            setTargetNames={setTargetNames}
            onNext={() => setStep('paths')}
          />
        )}
        {step === 'paths' && (
          <PathsStep
            mode={mode}
            defaults={defaults?.roots || []}
            home={defaults?.home || ''}
            rootPaths={rootPaths}
            customPath={customPath}
            setCustomPath={setCustomPath}
            setRootPaths={setRootPaths}
            error={error}
            onBack={() => setStep('mode')}
            onStart={() => {
              setError(null)
              setStep('scanning')
              const targetNamesArr = mode === 'targeted'
                ? targetNames.split('\n').map((s) => s.trim()).filter(Boolean)
                : undefined
              startScan.mutate({ rootPaths, mode, targetNames: targetNamesArr })
            }}
          />
        )}
        {step === 'scanning' && <ScanningStep mode={mode} />}
        {step === 'results' && result && (
          <ResultsStep
            result={result}
            grouped={groupedResults}
            selected={selected}
            onToggle={toggleSel}
            onToggleKind={toggleAllOfKind}
            error={error}
            importing={importItems.isPending}
            onBack={() => setStep('mode')}
            onImport={() => {
              const items = result.found.filter((f) => selected.has(f.path))
              if (items.length > 0) importItems.mutate(items)
            }}
          />
        )}
        {step === 'done' && (
          <DoneStep
            count={importItems.data?.added || 0}
            onClose={() => {
              reset()
              onClose()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─────── MODE STEP (NEW WS16) ───────

function ModeStep({
  mode,
  setMode,
  targetNames,
  setTargetNames,
  onNext,
}: {
  mode: ScanMode
  setMode: (m: ScanMode) => void
  targetNames: string
  setTargetNames: (v: string) => void
  onNext: () => void
}) {
  const targetCount = targetNames.split('\n').filter((s) => s.trim()).length
  const canProceed = mode !== 'targeted' || targetCount > 0
  return (
    <>
      <DialogHeader>
        <DialogTitle>Modalità scan</DialogTitle>
        <DialogDescription>
          Scegli quanto e dove scansionare. Ogni modalità ha tradeoff diversi tra velocità e
          completezza.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 py-3">
        <ModeCard
          selected={mode === 'quick'}
          onClick={() => setMode('quick')}
          title="Quick"
          stats="~30-60 sec · max 5000 cartelle · depth 4"
          desc="Default raccomandato. Scan rapido di Desktop/Documents/etc. Adatto al 95% dei casi."
        />
        <ModeCard
          selected={mode === 'deep'}
          onClick={() => setMode('deep')}
          title="Deep"
          stats="~5-15 min · max 10000 cartelle · depth 8"
          warning
          desc="Scan completo di tutto il disco home. Lungo ma esaustivo. Su HDD può richiedere più tempo."
        />
        <ModeCard
          selected={mode === 'targeted'}
          onClick={() => setMode('targeted')}
          title="Targeted (per nome)"
          stats="~10-30 sec per nome · scan selettivo"
          desc="Cerca SOLO cartelle che matchano i nomi che indichi. Velocissimo se sai cosa cerchi."
        />
        {mode === 'targeted' && (
          <div className="pl-6 pt-2 space-y-1 border-l-2 border-primary/30">
            <Label htmlFor="target-names">Nomi cartelle/progetti (uno per riga)</Label>
            <textarea
              id="target-names"
              value={targetNames}
              onChange={(e) => setTargetNames(e.target.value)}
              placeholder="obsidian-vault&#10;marketing-tools&#10;claude-agents"
              className="w-full bg-muted px-3 py-2 rounded text-sm font-mono border border-border min-h-[80px]"
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              {targetCount} {targetCount === 1 ? 'nome' : 'nomi'}. Match case-insensitive con
              substring (es. "claude" matcha "claude-agents", "ai-claude").
            </p>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button type="button" onClick={onNext} disabled={!canProceed} className="w-full">
          Avanti — scegli paths →
        </Button>
      </DialogFooter>
    </>
  )
}

function ModeCard({
  selected,
  onClick,
  title,
  stats,
  desc,
  warning,
}: {
  selected: boolean
  onClick: () => void
  title: string
  stats: string
  desc: string
  warning?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full text-left rounded-md border p-3 transition-all',
        selected
          ? 'border-primary bg-primary/10'
          : warning
          ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
          : 'border-border bg-card hover:bg-accent',
      ].join(' ')}
    >
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-medium text-sm">{title}</span>
        <span className="text-[11px] text-muted-foreground">{stats}</span>
      </div>
      <div className="text-xs text-muted-foreground">{desc}</div>
      {warning && (
        <div className="text-xs text-amber-300 mt-1 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          Tempi lunghi
        </div>
      )}
    </button>
  )
}

// ─────── PATHS STEP (was IntroStep) ───────

function PathsStep({
  mode,
  defaults,
  home,
  rootPaths,
  customPath,
  setCustomPath,
  setRootPaths,
  error,
  onBack,
  onStart,
}: {
  mode: ScanMode
  defaults: string[]
  home: string
  rootPaths: string[]
  customPath: string
  setCustomPath: (v: string) => void
  setRootPaths: (paths: string[]) => void
  error: string | null
  onBack: () => void
  onStart: () => void
}) {
  function toggle(p: string): void {
    if (rootPaths.includes(p)) setRootPaths(rootPaths.filter((x) => x !== p))
    else setRootPaths([...rootPaths, p])
  }
  function addCustom(): void {
    if (!customPath.trim()) return
    if (!customPath.startsWith(home)) return // safety: path deve essere dentro home
    if (!rootPaths.includes(customPath)) setRootPaths([...rootPaths, customPath])
    setCustomPath('')
  }
  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-center mb-3">
          <div className="rounded-full bg-primary/10 p-4">
            <ScanLine className="w-8 h-8 text-primary" />
          </div>
        </div>
        <DialogTitle className="text-center">Autoscan filesystem</DialogTitle>
        <DialogDescription className="text-center">
          Scansiona le tue cartelle alla ricerca di repo git, vault Obsidian, progetti Node/Python,
          agenti Claude e config MCP. Potrai poi importarli in SAIO con un click.
        </DialogDescription>
      </DialogHeader>
      <div className="rounded-md bg-muted/50 border border-border p-3 my-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Sicurezza</strong>: scan solo dentro la tua home (
        <code className="bg-black/30 px-1 rounded">{home}</code>). Profondità max 4 livelli, skip
        node_modules/.git/.venv/dist/build, timeout 60s, max 5000 cartelle visitate.
      </div>
      <div className="space-y-2 py-2">
        <div className="text-xs text-muted-foreground">Cartelle da scansionare:</div>
        {defaults.map((p) => (
          <label
            key={p}
            className="flex items-center gap-2 text-sm p-2 rounded hover:bg-accent cursor-pointer"
          >
            <input
              type="checkbox"
              checked={rootPaths.includes(p)}
              onChange={() => toggle(p)}
            />
            <Folder className="w-4 h-4 text-muted-foreground" />
            <code className="text-xs">{p}</code>
          </label>
        ))}
        {/* Custom path */}
        <div className="flex gap-2 items-center pt-2 border-t border-border">
          <Input
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            placeholder={`Path custom (deve iniziare con ${home})`}
            className="text-xs"
          />
          <Button type="button" size="sm" variant="outline" onClick={addCustom}>
            Aggiungi
          </Button>
        </div>
        {rootPaths.filter((p) => !defaults.includes(p)).map((p) => (
          <div key={p} className="text-xs text-muted-foreground flex items-center gap-2 pl-4">
            <span>+</span>
            <code>{p}</code>
            <button type="button" onClick={() => toggle(p)} className="text-red-400 hover:text-red-300">
              ×
            </button>
          </div>
        ))}
      </div>
      {error && <div className="text-sm text-red-500">{error}</div>}
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onBack}>
          ← Modalità
        </Button>
        <Button type="button" onClick={onStart} disabled={rootPaths.length === 0}>
          Avvia scan {mode} ({rootPaths.length} {rootPaths.length === 1 ? 'cartella' : 'cartelle'})
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────── SCANNING ───────

function ScanningStep({ mode }: { mode: ScanMode }): ReactElement {
  const eta = mode === 'quick' ? '30-60 secondi' : mode === 'deep' ? '5-15 minuti' : '10-30 secondi'
  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-center mb-3">
          <Loader2 className="w-12 h-12 text-primary animate-spin" />
        </div>
        <DialogTitle className="text-center">Scansione {mode} in corso…</DialogTitle>
        <DialogDescription className="text-center">
          Stiamo cercando repo git, vault, progetti, agenti Claude {mode === 'targeted' ? 'che matchano i nomi' : ''} (+ GitHub se token configurato). Tempo stimato: <strong>{eta}</strong>.
        </DialogDescription>
      </DialogHeader>
    </>
  )
}

// ─────── RESULTS ───────

function ResultsStep({
  result,
  grouped,
  selected,
  onToggle,
  onToggleKind,
  error,
  importing,
  onBack,
  onImport,
}: {
  result: ScanResult
  grouped: Map<DetectedItem['kind'], DetectedItem[]>
  selected: Set<string>
  onToggle: (path: string) => void
  onToggleKind: (kind: DetectedItem['kind']) => void
  error: string | null
  importing: boolean
  onBack: () => void
  onImport: () => void
}): ReactElement {
  if (result.found.length === 0) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Nessun risultato</DialogTitle>
          <DialogDescription>
            Lo scan ha visitato {result.scannedDirs} cartelle ma non ha trovato risorse importabili.
            Prova ad aggiungere path custom dove sai di avere progetti.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={onBack} className="w-full">
            ← Indietro
          </Button>
        </DialogFooter>
      </>
    )
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Risultati scan</DialogTitle>
        <DialogDescription>
          {result.found.length} risorse trovate in {result.scannedDirs} cartelle visitate. Seleziona
          quelle da importare.
          {result.abortedReason === 'timeout' && (
            <span className="block text-amber-400 text-xs mt-1">
              ⚠ Scan interrotto per timeout (60s). Risultati parziali.
            </span>
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-3 max-h-[50vh] overflow-y-auto">
        {Array.from(grouped.entries()).map(([kind, items]) => (
          <div key={kind} className="space-y-1">
            <button
              type="button"
              onClick={() => onToggleKind(kind)}
              className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            >
              {KIND_ICONS[kind]}
              <span>
                {KIND_LABELS[kind]} ({items.length})
              </span>
              <span className="text-[10px] underline">toggle tutti</span>
            </button>
            <div className="space-y-1 pl-4">
              {items.map((item) => (
                <label
                  key={item.path}
                  className="flex items-center gap-2 text-sm py-1.5 px-2 rounded hover:bg-accent cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(item.path)}
                    onChange={() => onToggle(item.path)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{item.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">
                      {item.path}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {error && <div className="text-sm text-red-500">{error}</div>}
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onBack}>
          ← Indietro
        </Button>
        <Button
          type="button"
          onClick={onImport}
          disabled={selected.size === 0 || importing}
        >
          {importing ? 'Importo…' : `Importa ${selected.size} selezionati`}
        </Button>
      </DialogFooter>
    </>
  )
}

// ─────── DONE ───────

function DoneStep({ count, onClose }: { count: number; onClose: () => void }): ReactElement {
  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-center mb-3">
          <div className="rounded-full bg-emerald-500/10 p-4">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          </div>
        </div>
        <DialogTitle className="text-center">Importati {count} progetti</DialogTitle>
        <DialogDescription className="text-center">
          Trovi i progetti importati nella sezione "Progetti" della dashboard. Da lì puoi spawnare
          una sessione Claude su ognuno con un click.
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

// Eslint: avoid unused imports
void AlertCircle
