import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Inbox as InboxIcon, Loader2, MailX, Cpu, Mail, Clock, Trash2 } from 'lucide-react'
import { DecisionInbox } from '@/components/decision/DecisionInbox'
import { useBriefs } from '@/hooks/useDecisions'
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus'
import { WelcomeWizard } from '@/components/onboarding/WelcomeWizard'
import { AutoScanWizard } from '@/components/onboarding/AutoScanWizard'
import { CloudflareSetupWizard } from '@/components/onboarding/CloudflareSetupWizard'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { toast } from 'sonner'

export function InboxPage() {
  const { data, isLoading, error } = useBriefs()
  const queryClient = useQueryClient()
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleanupDays, setCleanupDays] = useState(7)

  // V15.0 WS12 — First-login WelcomeWizard auto-trigger
  const { data: onboarding } = useOnboardingStatus()
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const [autoscanOpen, setAutoscanOpen] = useState(false)
  const [cloudflareOpen, setCloudflareOpen] = useState(false)
  useEffect(() => {
    if (onboarding && !onboarding.firstLoginCompletedAt) {
      setWelcomeOpen(true)
    }
  }, [onboarding])

  const cleanupMut = useMutation({
    mutationFn: (days: number) => api.briefs.cleanupZombies(days),
    onSuccess: (res) => {
      toast.success(`Puliti ${res.archived} brief zombi`, {
        description:
          res.archived > 0
            ? `Archiviati: ${res.briefIds.slice(0, 3).join(', ')}${res.briefIds.length > 3 ? '...' : ''}`
            : 'Nessun brief in-session più vecchio di N giorni',
      })
      queryClient.invalidateQueries({ queryKey: ['briefs'] })
      setCleanupOpen(false)
    },
    onError: (err) => toast.error('Errore cleanup', { description: String(err) }),
  })

  const counts = useMemo(() => {
    const briefs = data?.briefs || []
    const bySource = {
      brief: briefs.filter((b: any) => (b.source || 'brief') === 'brief').length,
      'in-session': briefs.filter((b: any) => b.source === 'in-session').length,
      cron: briefs.filter((b: any) => b.source === 'cron').length,
    }
    return bySource
  }, [data])

  // Sort: in-session decisions first (more urgent to respond), then regular briefs
  const sortedBriefs = useMemo(() => {
    if (!data?.briefs) return []
    const inSession = data.briefs.filter((b: any) => b.source === 'in-session')
    const cron = data.briefs.filter((b: any) => b.source === 'cron')
    const briefs = data.briefs.filter((b: any) => (b.source || 'brief') === 'brief')
    return [...inSession, ...briefs, ...cron]
  }, [data])

  return (
    <div className="space-y-4 md:space-y-6 pb-12">
      {/* V15.0 WS12 + WS15 — First-login welcome wizard + sub-wizards */}
      <WelcomeWizard
        open={welcomeOpen}
        onClose={() => setWelcomeOpen(false)}
        onTriggerAutoScan={() => setAutoscanOpen(true)}
        onTriggerCloudflare={() => setCloudflareOpen(true)}
      />
      <AutoScanWizard open={autoscanOpen} onClose={() => setAutoscanOpen(false)} />
      <CloudflareSetupWizard open={cloudflareOpen} onClose={() => setCloudflareOpen(false)} />

      <div className="flex items-center gap-3 flex-wrap">
        <InboxIcon className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Inbox decisioni</h1>
        {counts['in-session'] > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 h-7 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 ml-2"
            onClick={() => setCleanupOpen(true)}
            title="Archivia brief in-session vecchi (zombi)"
          >
            <Trash2 className="w-3 h-3" />
            Pulisci zombi
          </Button>
        )}
        {data && (
          <div className="ml-auto flex items-center gap-3 text-xs md:text-sm text-muted-foreground">
            {counts['in-session'] > 0 && (
              <span className="flex items-center gap-1 text-violet-300">
                <Cpu className="w-3.5 h-3.5" />
                {counts['in-session']} da sessione
              </span>
            )}
            <span className="flex items-center gap-1">
              <Mail className="w-3.5 h-3.5" />
              {counts.brief} brief
            </span>
            {counts.cron > 0 && (
              <span className="flex items-center gap-1 text-amber-300">
                <Clock className="w-3.5 h-3.5" />
                {counts.cron} cron
              </span>
            )}
          </div>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Caricamento brief…
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Errore: {String(error)}
        </div>
      )}

      {data && data.briefs.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <MailX className="w-12 h-12 opacity-40" />
          <p>Nessun brief attivo. Tutto sotto controllo 👌</p>
        </div>
      )}

      {sortedBriefs.map((brief) => (
        <DecisionInbox key={brief.id} brief={brief} />
      ))}

      {/* V13.1 T9: Cleanup zombi dialog */}
      <AlertDialog open={cleanupOpen} onOpenChange={setCleanupOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pulisci brief zombi</AlertDialogTitle>
            <AlertDialogDescription>
              Archivia tutti i brief in-session più vecchi di N giorni che non sono stati risposti.
              I brief vanno in <code className="bg-muted px-1 rounded">data/archive/briefs/</code> con resolution <code className="bg-muted px-1 rounded">expired</code>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-3">
            <label className="text-xs font-medium block mb-2">Archivia brief in-session più vecchi di:</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={365}
                value={cleanupDays}
                onChange={(e) => setCleanupDays(Number(e.target.value) || 0)}
                className="w-24 h-9"
              />
              <span className="text-sm text-muted-foreground">giorni</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Metti <code className="bg-muted px-1 rounded">0</code> per archiviare <strong>tutti</strong> gli in-session aperti (utile se smoke test V11-01 è rimasto).
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cleanupMut.isPending}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 hover:bg-amber-600 text-white"
              onClick={(e) => {
                e.preventDefault()
                cleanupMut.mutate(cleanupDays)
              }}
              disabled={cleanupMut.isPending}
            >
              {cleanupMut.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Pulisco...</>
              ) : (
                'Archivia zombi'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
