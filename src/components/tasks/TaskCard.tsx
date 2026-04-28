import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Play, Pause, X, FileText, Clock, Cpu, Zap,
  Loader2, CheckCircle2, AlertTriangle, PauseCircle, ExternalLink
} from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useTaskCommand } from '@/hooks/useTasks'
import { cn, formatTokens, formatDuration, formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'
import type { TaskStatus } from '@/lib/types'

interface TaskCardProps {
  task: TaskStatus
  onOpenLog?: (task: TaskStatus) => void
}

const statusConfig: Record<string, { icon: any; color: string; bg: string; label: string; spin?: boolean }> = {
  idle: { icon: Clock, color: 'text-slate-500', bg: 'bg-slate-600/10', label: 'Nessuna sessione' },
  pending: { icon: Clock, color: 'text-slate-400', bg: 'bg-slate-500/10', label: 'In attesa' },
  running: { icon: Loader2, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'In corso', spin: true },
  waiting_user: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', label: 'Attende utente' },
  paused: { icon: PauseCircle, color: 'text-purple-400', bg: 'bg-purple-500/10', label: 'In pausa' },
  done: { icon: CheckCircle2, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Completato' },
  failed: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10', label: 'Fallito' },
}

export function TaskCard({ task, onOpenLog }: TaskCardProps) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState<'kill' | null>(null)
  const cmd = useTaskCommand()
  const cfg = statusConfig[task.status] || statusConfig.pending
  const Icon = cfg.icon
  const isActive = task.status === 'running' || task.status === 'paused' || task.status === 'waiting_user'

  const handleCommand = async (type: 'pause' | 'resume' | 'kill') => {
    try {
      await cmd.mutateAsync({ id: task.projectId, type })
      toast.success(`Comando "${type}" inviato`, { description: task.title })
    } catch (err) {
      toast.error('Errore invio comando', { description: String(err) })
    }
  }

  return (
    <Card
      onClick={(e) => {
        // Don't navigate if user clicked on an action button inside the card
        const target = e.target as HTMLElement
        if (target.closest('button')) return
        navigate(`/projects/${task.projectId}`)
      }}
      className={cn(
        'cursor-pointer group',
        task.status === 'running' ? 'neon-card-green' :
        task.status === 'waiting_user' ? 'neon-card-amber' :
        task.status === 'paused' ? 'neon-card-purple' :
        task.status === 'failed' ? 'neon-card-red' :
        task.status === 'done' ? 'neon-card-blue' : 'neon-card',
        !isActive && 'opacity-75'
      )}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={cn('shrink-0 w-9 h-9 rounded-lg flex items-center justify-center', cfg.bg)}>
              <Icon className={cn('w-4 h-4', cfg.color, 'spin' in cfg && cfg.spin && 'animate-spin')} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-semibold leading-tight truncate">{task.title}</h3>
                <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <code className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {task.projectId}
                </code>
                <Badge variant="outline" className={cn('text-[10px] h-4 px-1.5', cfg.color)}>
                  {cfg.label}
                </Badge>
                {task.pid && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <Cpu className="w-2.5 h-2.5" />
                    PID {task.pid}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pb-4">
        {task.currentStep && (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="opacity-60">Step:</span>
            <span className="text-foreground/80">{task.currentStep}</span>
          </div>
        )}

        {task.status === 'running' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Progresso</span>
              <span>{Math.round(task.progress * 100)}%</span>
            </div>
            <Progress value={task.progress * 100} className="h-1.5" />
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Zap className="w-2.5 h-2.5" />
              Token
            </div>
            <div className="font-mono">{formatTokens(task.tokensUsed)}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              ETA
            </div>
            <div className="font-mono">{task.etaSeconds ? formatDuration(task.etaSeconds) : '—'}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Aggiornato</div>
            <div className="font-mono">{formatRelativeTime(task.updatedAt)}</div>
          </div>
        </div>

        {task.errorMessage && (
          <div className="text-xs rounded border border-red-500/30 bg-red-500/5 p-2 text-red-300">
            {task.errorMessage}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={() => onOpenLog?.(task)}
            disabled={!task.logFile}
          >
            <FileText className="w-3 h-3" />
            Log
          </Button>

          {task.status === 'running' && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 text-xs"
              onClick={() => handleCommand('pause')}
              disabled={cmd.isPending}
            >
              <Pause className="w-3 h-3" />
              Pausa
            </Button>
          )}

          {task.status === 'paused' && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 text-xs"
              onClick={() => handleCommand('resume')}
              disabled={cmd.isPending}
            >
              <Play className="w-3 h-3" />
              Riprendi
            </Button>
          )}

          {isActive && (
            <Button
              variant="outline"
              size="sm"
              className={cn(
                'gap-1.5 h-7 text-xs ml-auto',
                confirming === 'kill' && 'bg-red-600 hover:bg-red-700 text-white border-red-600'
              )}
              onClick={() => {
                if (confirming === 'kill') {
                  handleCommand('kill')
                  setConfirming(null)
                } else {
                  setConfirming('kill')
                  setTimeout(() => setConfirming(null), 3000)
                }
              }}
              disabled={cmd.isPending}
            >
              <X className="w-3 h-3" />
              {confirming === 'kill' ? 'Conferma?' : 'Kill'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
