import { useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  FolderPlus, Upload, X, FileText, Image as ImageIcon, Loader2,
  Sparkles, ArrowLeft, Play, Server, Monitor
} from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

const MAX_FILE_SIZE = 20 * 1024 * 1024
const MAX_FILES = 10
const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,text/plain,text/markdown'

interface PendingFile {
  file: File
  id: string
  error?: string
}

function formatSize(b: number): string {
  if (b < 1024) return `${b}B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)}KB`
  return `${(b / 1024 ** 2).toFixed(1)}MB`
}

function mimeIcon(mime: string) {
  if (mime.startsWith('image/')) return ImageIcon
  return FileText
}

export function NewProjectPage() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('client')
  const [tags, setTags] = useState('')
  const [brief, setBrief] = useState('')
  const [files, setFiles] = useState<PendingFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [spawnTarget, setSpawnTarget] = useState<string>('__inherit__') // __inherit__ = eredita da account attivo

  // V14: lista account + VPS per il selector spawnTarget
  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts.list(),
  })
  const vpsQ = useQuery({
    queryKey: ['vps/list'],
    queryFn: () => api.vps.listResolved(),
    staleTime: 60_000,
  })

  const activeAccount = useMemo(() => {
    const list = accountsQ.data?.accounts || []
    const activeId = accountsQ.data?.activeId
    return list.find((a) => a.id === activeId) || null
  }, [accountsQ.data])

  const inheritedTargetLabel = useMemo(() => {
    const t = activeAccount?.target
    if (!t) return 'Non configurato (account attivo senza target)'
    if (t === 'local') return 'Local (account attivo)'
    const v = vpsQ.data?.vps.find((x) => x.id === t)
    return v?.effectiveLabel ? `${v.effectiveLabel} (account attivo)` : `${t} (account attivo)`
  }, [activeAccount, vpsQ.data])

  const submitMut = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      fd.append('name', name)
      fd.append('category', category)
      fd.append('brief', brief)
      fd.append('tags', tags)
      // V14: spawnTarget — '__inherit__' significa "non override, usa target dell'account"
      if (spawnTarget && spawnTarget !== '__inherit__') {
        fd.append('spawnTarget', spawnTarget)
      }
      for (const pf of files) {
        if (!pf.error) fd.append('attachments', pf.file)
      }
      const res = await fetch('/api/new-project', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(err.error || 'Failed')
      }
      return res.json()
    },
    onSuccess: (d) => {
      const cli = activeAccount?.cliName || 'AI'
      toast.success(`Progetto "${d.name}" creato`, {
        description: `Apertura sessione embedded ${cli} con brief in caricamento…`,
      })
      setTimeout(() => navigate(`/projects/${d.id}`), 800)
    },
    onError: (e: any) => toast.error('Errore creazione', { description: String(e) }),
  })

  const addFiles = (list: FileList | File[]) => {
    const arr = Array.from(list)
    const slots = MAX_FILES - files.length
    const next: PendingFile[] = arr.slice(0, slots).map((f) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      let error: string | undefined
      if (f.size > MAX_FILE_SIZE) error = `>${MAX_FILE_SIZE / 1024 / 1024}MB`
      else if (!ACCEPT.split(',').includes(f.type)) error = 'mime non permesso'
      return { file: f, id, error }
    })
    setFiles((prev) => [...prev, ...next])
  }

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id))

  const valid = name.trim().length >= 2 && brief.trim().length >= 10 && !files.some((f) => f.error)

  return (
    <div className="space-y-4 md:space-y-6 max-w-3xl pb-12">
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5 -ml-2">
        <ArrowLeft className="w-3.5 h-3.5" /> Indietro
      </Button>

      <div className="flex items-center gap-3 flex-wrap">
        <FolderPlus className="w-6 h-6 text-primary" />
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Nuovo progetto</h1>
      </div>

      <Card className="neon-card-purple">
        <CardHeader className="pb-3">
          <h2 className="text-sm font-semibold">Dettagli progetto</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nome progetto *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Herbalife UK Bridge" maxLength={100} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Categoria</label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="client / internal / research" maxLength={40} />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Tags (separati da virgola)</label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="herbalife, uk, legal" />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Brief *</label>
            <Textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Descrivi il progetto, obiettivi, constraints, scadenze. Più dettagli dai, più la prima sessione AI parte focalizzata."
              className="min-h-[140px] resize-y"
              maxLength={5000}
            />
            <div className="text-[10px] text-muted-foreground mt-1">{brief.length}/5000 · min 10</div>
          </div>

          {/* V14: spawn target selector */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
              <Server className="w-3 h-3" />
              Dove avviare la sessione (spawn target)
            </label>
            <Select value={spawnTarget} onValueChange={setSpawnTarget}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Eredita da account attivo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__inherit__">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-violet-400" />
                    Eredita da account attivo — {inheritedTargetLabel}
                  </span>
                </SelectItem>
                <SelectItem value="local">
                  <span className="flex items-center gap-1.5">
                    <Monitor className="w-3 h-3 text-blue-400" />
                    Local (questa macchina)
                  </span>
                </SelectItem>
                {(vpsQ.data?.vps || []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    <span className="flex items-center gap-1.5">
                      <Server className="w-3 h-3 text-violet-400" />
                      {v.effectiveLabel || v.label} <span className="text-muted-foreground font-mono text-[10px]">{v.ip}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-[10px] text-muted-foreground mt-1">
              {spawnTarget === '__inherit__'
                ? `Default: il progetto userà il target dell'account attivo. ${activeAccount && !activeAccount.target ? '⚠ L\'account attivo non ha target — configuralo prima nelle Impostazioni Accounts.' : ''}`
                : spawnTarget === 'local'
                ? 'La sessione AI verrà aperta nell\'embedded del progetto (no terminale Windows esterno).'
                : `La sessione verrà spawnata via SSH su ${vpsQ.data?.vps.find((v) => v.id === spawnTarget)?.effectiveLabel || spawnTarget}.`}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="neon-card-blue">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold">Allegati (opzionali)</h2>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {files.length}/{MAX_FILES} · max 20MB/file · PDF, PNG, JPG, WebP, TXT, MD
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragOver(false)
              if (e.dataTransfer.files) addFiles(e.dataTransfer.files)
            }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
              isDragOver ? 'border-blue-500/60 bg-blue-500/5' : 'border-border/60 hover:border-blue-500/40 hover:bg-muted/30'
            )}
          >
            <Upload className={cn('w-8 h-8 mx-auto mb-2', isDragOver ? 'text-blue-400' : 'text-muted-foreground')} />
            <p className="text-sm font-medium">Drag&drop file qui o click per scegliere</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Briefing, screenshot, mockup, brand guidelines...
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>

          {files.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {files.map((pf) => {
                const Icon = mimeIcon(pf.file.type)
                return (
                  <div
                    key={pf.id}
                    className={cn(
                      'flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-2 py-1.5 text-xs',
                      pf.error && 'border-red-500/40 bg-red-500/5'
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate font-mono">{pf.file.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatSize(pf.file.size)}</span>
                    {pf.error && <span className="text-[10px] text-red-400 shrink-0">{pf.error}</span>}
                    <button onClick={() => removeFile(pf.id)} className="text-muted-foreground hover:text-red-400 shrink-0">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="neon-card-green">
        <CardContent className="py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            {valid
              ? `Pronto: creazione + sessione embedded ${activeAccount?.cliName || 'AI'} con brief auto-iniettato`
              : 'Nome (2+) e brief (10+) sono richiesti'}
          </div>
          <Button
            size="lg"
            onClick={() => submitMut.mutate()}
            disabled={!valid || submitMut.isPending}
            className="gap-1.5"
          >
            {submitMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Crea progetto
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
