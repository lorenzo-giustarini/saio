import { Terminal, Copy } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

const QUICK_CMDS = [
  { cmd: '/obsidian-daily', desc: 'Daily note con eventi e progetti' },
  { cmd: '/obsidian-health', desc: 'Vault health audit' },
  { cmd: '/obsidian-connect', desc: 'Trova connessioni tra note' },
  { cmd: '/session-save', desc: 'Salva sessione EOD' },
  { cmd: '/autoresearch', desc: 'Research autonomo su gap' },
  { cmd: '/save-wiki', desc: 'Salva insight come wiki entry' },
  { cmd: '/deep-research-vault', desc: 'Multi-source research' },
]

export function QuickCmds() {
  const copyCmd = (cmd: string) => {
    navigator.clipboard.writeText(cmd).then(
      () => toast.success('Comando copiato negli appunti', { description: cmd }),
      () => toast.error('Clipboard non disponibile')
    )
  }

  return (
    <Card className="neon-card-amber">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Quick Commands</h3>
        </div>
        <p className="text-[10px] text-muted-foreground">Click per copiare, poi incolla nella CLI AI</p>
      </CardHeader>
      <CardContent className="space-y-1">
        {QUICK_CMDS.map((q) => (
          <button
            key={q.cmd}
            onClick={() => copyCmd(q.cmd)}
            className="w-full flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-accent transition-colors group"
          >
            <code className="font-mono text-primary">{q.cmd}</code>
            <span className="text-[10px] text-muted-foreground truncate flex-1 text-left">{q.desc}</span>
            <Copy className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </CardContent>
    </Card>
  )
}
