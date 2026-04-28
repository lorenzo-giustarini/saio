import { useState } from 'react'
import { Check, X, SkipForward, MessageSquare, ChevronDown, ChevronUp, Flag, Folder, Lightbulb, AlertTriangle as AlertIcon, HelpCircle } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { RiskIndicator } from './RiskIndicator'
import { VoiceButton } from './VoiceButton'
import { useDraftStore, type AnswerType } from '@/store/draftStore'
import { cn } from '@/lib/utils'
import type { Decision } from '@/lib/types'

interface DecisionCardProps {
  briefId: string
  decision: Decision
  index: number
}

const priorityColors: Record<string, string> = {
  urgent: 'bg-red-500/20 text-red-300 border-red-500/40',
  high: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  normal: 'bg-muted text-muted-foreground',
  low: 'bg-muted/50 text-muted-foreground',
}

export function DecisionCard({ briefId, decision, index }: DecisionCardProps) {
  const [riscExpanded, setRiscExpanded] = useState(false)
  const { setAnswer, setComment, getDraft } = useDraftStore()
  const draft = getDraft(briefId, decision.id)

  const answerButtons: {
    key: AnswerType
    label: string
    icon: typeof Check
    variant: 'default' | 'destructive' | 'outline' | 'secondary'
    activeClass: string
  }[] = [
    { key: 'yes', label: 'Sì', icon: Check, variant: 'default', activeClass: 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600' },
    { key: 'no', label: 'No', icon: X, variant: 'destructive', activeClass: 'bg-red-600 hover:bg-red-700 text-white border-red-600' },
    { key: 'skip', label: 'Skip', icon: SkipForward, variant: 'outline', activeClass: 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600' },
    { key: 'comment-only', label: 'Solo commento', icon: MessageSquare, variant: 'secondary', activeClass: 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600' },
  ]

  return (
    <Card className={cn(
      'overflow-hidden animate-slide-up relative',
      !draft.answer && 'neon-card',
      draft.answer === 'yes' && 'ring-1 ring-emerald-500/40 shadow-[0_0_30px_-5px_rgba(16,185,129,0.3)]',
      draft.answer === 'no' && 'ring-1 ring-red-500/40 shadow-[0_0_30px_-5px_rgba(239,68,68,0.3)]',
      draft.answer === 'skip' && 'ring-1 ring-amber-500/40 shadow-[0_0_30px_-5px_rgba(245,158,11,0.3)]',
      draft.answer === 'comment-only' && 'ring-1 ring-blue-500/40 shadow-[0_0_30px_-5px_rgba(59,130,246,0.3)]'
    )}
      style={{ animationDelay: `${index * 60}ms` }}>
      <CardHeader className="pb-3">
        {/* Top row: big project badge + priority */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {decision.projectTarget && (
            <Badge variant="secondary" className="text-xs gap-1.5 h-6 px-2 font-semibold">
              <Folder className="w-3 h-3" />
              {decision.projectTarget}
            </Badge>
          )}
          {decision.priority && decision.priority !== 'normal' && (
            <Badge variant="outline" className={cn('text-xs gap-1 h-6 px-2', priorityColors[decision.priority])}>
              <Flag className="w-3 h-3" />
              {decision.priority === 'urgent' ? 'Urgente' : decision.priority === 'high' ? 'Alta priorità' : decision.priority}
            </Badge>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">#{index + 1}</span>
        </div>

        {/* Title grande, leggibile */}
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-8 h-8 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-sm font-bold text-primary">
            {index + 1}
          </div>
          <div className="flex-1 space-y-1.5">
            <h3 className="text-lg font-semibold leading-snug">{decision.title}</h3>
            {decision.tags && decision.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {decision.tags.map((t) => (
                  <span key={t} className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pb-5">
        {/* Perché serve decidere (ex Causa) — icona + titolo chiaro */}
        <div className="rounded-md bg-muted/30 p-3 border border-border/50">
          <div className="flex items-center gap-2 mb-1.5">
            <HelpCircle className="w-4 h-4 text-blue-400" />
            <div className="text-xs font-semibold text-blue-400">Perché serve decidere</div>
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed">{decision.causa}</p>
        </div>

        {/* Effetto Sì vs No — due box side by side, più leggibili */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">
            Cosa succede con la tua risposta
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-md border-2 border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <Check className="w-3 h-3 text-emerald-400" />
                </div>
                <div className="text-xs font-semibold text-emerald-400">Se rispondi SÌ</div>
              </div>
              <p className="text-sm text-foreground/90 leading-relaxed">{decision.effetto.si}</p>
            </div>
            <div className="rounded-md border-2 border-red-500/30 bg-red-500/5 p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                  <X className="w-3 h-3 text-red-400" />
                </div>
                <div className="text-xs font-semibold text-red-400">Se rispondi NO</div>
              </div>
              <p className="text-sm text-foreground/90 leading-relaxed">{decision.effetto.no}</p>
            </div>
          </div>
        </div>

        {/* Piano Claude (ex Soluzione proposta) — protagonista visivo */}
        <div className="rounded-md border-2 border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Lightbulb className="w-4 h-4 text-primary" />
            <div className="text-xs font-semibold text-primary">Cosa farò se dici Sì</div>
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed">{decision.soluzioneProposta}</p>
        </div>

        {/* Rischi — collapsable ma più informativa */}
        {decision.rischi.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setRiscExpanded((v) => !v)}
              className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              <AlertIcon className="w-3.5 h-3.5 text-amber-400" />
              Possibili rischi ({decision.rischi.length})
              {riscExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {riscExpanded && (
              <div className="mt-2 space-y-1.5">
                {decision.rischi.map((r, i) => (
                  <RiskIndicator key={i} risk={r} />
                ))}
              </div>
            )}
          </div>
        )}

        <Separator />

        {/* Controls — più grandi, con "La tua risposta" label */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            La tua risposta:
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="w-3 h-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <div className="text-xs space-y-1">
                    <div><strong>Sì</strong> = procedi con il piano proposto</div>
                    <div><strong>No</strong> = non procedere</div>
                    <div><strong>Skip</strong> = rimanda (non decido ora)</div>
                    <div><strong>Solo commento</strong> = invio solo nota senza Sì/No</div>
                    <div className="text-[10px] text-muted-foreground mt-1">Il commento (se scritto) viene inviato insieme a qualunque risposta</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="flex flex-wrap gap-2">
            {answerButtons.map(({ key, label, icon: Icon, activeClass }) => {
              const isActive = draft.answer === key
              return (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAnswer(briefId, decision.id, key)}
                  className={cn('gap-1.5 transition-all', isActive && activeClass)}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </Button>
              )
            })}
          </div>

          <div className="relative">
            <Textarea
              value={draft.comment}
              onChange={(e) => setComment(briefId, decision.id, e.target.value, false)}
              placeholder="Commento opzionale — verrà inviato insieme alla tua risposta"
              className="min-h-[72px] pr-12 text-sm resize-none"
            />
            <div className="absolute top-2 right-2">
              <VoiceButton
                initial={draft.comment}
                onTranscript={(t) => setComment(briefId, decision.id, t, true)}
              />
            </div>
          </div>

          {draft.voiceUsed && (
            <div className="text-[10px] text-muted-foreground italic">
              ✓ Commento dettato vocalmente
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
