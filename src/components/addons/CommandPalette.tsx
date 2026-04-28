import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Inbox, ListChecks, FolderKanban, Archive, BarChart3, Sparkles, Terminal, Heart, Key, Activity } from 'lucide-react'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { toast } from 'sonner'

// V14.19 — Quick commands con descrizione 1-riga (cosa fa quando incollato in CLI)
interface QuickCmd {
  icon: any
  label: string
  to?: string | null
  run?: string
  description?: string
}

const commands: Array<{ group: string; description?: string; items: QuickCmd[] }> = [
  { group: 'Navigazione', description: 'Salta a una pagina della dashboard', items: [
    { icon: Inbox, label: 'Inbox decisioni', to: '/inbox' },
    { icon: ListChecks, label: 'Task attivi', to: '/tasks' },
    { icon: FolderKanban, label: 'Progetti', to: '/projects' },
    { icon: Archive, label: 'Archivio', to: '/archive' },
    { icon: BarChart3, label: 'Metriche', to: '/metrics' },
    { icon: Sparkles, label: 'Extras (MCP, Creds, QuickCmds)', to: '/extras' },
    { icon: Inbox, label: 'Automazioni (Task Scheduler)', to: '/cron' },
  ]},
  { group: 'Quick Commands', description: 'Click → copia il comando, poi incollalo nella CLI', items: [
    { icon: Terminal, label: '/obsidian-daily', to: null, run: 'obsidian-daily', description: 'Genera il cockpit mattutino del vault (priorità + progetti + task + reminder)' },
    { icon: Terminal, label: '/obsidian-health', to: null, run: 'obsidian-health', description: 'Audit settimanale vault: broken link, note stale, orfani' },
    { icon: Terminal, label: '/session-save', to: null, run: 'session-save', description: 'Salva la sessione corrente come nota EOD nel vault' },
    { icon: Terminal, label: '/autoresearch', to: null, run: 'autoresearch', description: 'Routing deterministico per ricerca (vault → deep-research → agenti)' },
  ]},
  { group: 'Shortcut', description: 'Salti rapidi a sezioni specifiche', items: [
    { icon: Activity, label: 'Stato orchestrator', to: '/metrics', description: 'Heartbeat, lock attivi, task in coda' },
    { icon: Heart, label: 'Vault health check', to: '/metrics', description: 'Score vault, broken links, note stale, orfani' },
    { icon: Key, label: 'Credenziali configurate', to: '/extras', description: 'API keys, tokens, MCP credentials' },
  ]},
]

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleSelect = (item: QuickCmd) => {
    if (item.to) {
      navigate(item.to)
    } else if (item.run) {
      const cmd = `/${item.run}`
      navigator.clipboard?.writeText(cmd).then(
        () => toast.success(`Comando copiato: ${cmd}`, { description: 'Incolla nella CLI per eseguirlo', duration: 2500 }),
        () => toast.error('Copia fallita')
      )
    }
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 max-w-2xl overflow-hidden">
        {/* V14.19 — header esplicativo dello scopo della Command Palette */}
        <div className="px-4 pt-4 pb-2 border-b border-border/40 bg-muted/20">
          <div className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            Command Palette
            <span className="ml-auto text-[10px] text-muted-foreground font-normal">⌘K · Ctrl+K</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
            Naviga rapidamente, copia comandi <code className="bg-muted px-1 rounded">/skill</code> da incollare nella CLI, oppure salta a sezioni specifiche.
          </p>
        </div>
        <Command className="rounded-lg border-none">
          <CommandInput placeholder="Naviga + copia comando /skill + scorciatoie..." />
          <CommandList>
            <CommandEmpty>Nessun risultato.</CommandEmpty>
            {commands.map((group) => (
              <CommandGroup key={group.group} heading={group.group}>
                {group.items.map((item) => (
                  <CommandItem
                    key={item.label}
                    onSelect={() => handleSelect(item)}
                    className="gap-2 cursor-pointer flex-col items-start py-2"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <item.icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium">{item.label}</span>
                    </div>
                    {item.description && (
                      <p className="text-[10px] text-muted-foreground pl-6 leading-snug">
                        {item.description}
                      </p>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
