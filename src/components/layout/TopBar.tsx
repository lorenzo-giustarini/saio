import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Command as CommandIcon, Activity, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { NotificationPopover } from './NotificationPopover'
import { AccountSwitcher } from './AccountSwitcher'
import { cn } from '@/lib/utils'

async function fetchHealth() {
  const res = await fetch('/api/health')
  return res.json() as Promise<{ status: string }>
}

export function TopBar() {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 30)
    return () => clearInterval(t)
  }, [])

  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  })

  const dateLabel = now.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  })
  const timeLabel = now.toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  })

  const isHealthy = health.data?.status === 'ok'

  return (
    <header className="h-14 border-b border-border bg-card/40 backdrop-blur-sm flex items-center justify-between px-4 md:px-6">
      <div className="flex items-center gap-4 min-w-0">
        <div className="text-xs md:text-sm min-w-0">
          <span className="font-medium capitalize truncate">{dateLabel}</span>
          <span className="text-muted-foreground ml-2">{timeLabel}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground hidden sm:flex"
                onClick={() => {
                  // Trigger command palette via keyboard event
                  const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })
                  window.dispatchEvent(event)
                }}
              >
                <CommandIcon className="w-3.5 h-3.5" />
                <kbd className="text-[10px] bg-muted px-1.5 py-0.5 rounded">⌘K</kbd>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span className="text-xs">Command Palette (Ctrl+K)</span>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Activity className={cn('w-4 h-4', isHealthy ? 'text-emerald-400' : 'text-red-400')} />
                <span className={cn(
                  'absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full',
                  isHealthy ? 'bg-emerald-400' : 'bg-red-400',
                  isHealthy && 'animate-pulse'
                )} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <div className="text-xs space-y-0.5">
                <div className="flex items-center gap-1">
                  {isHealthy ? (
                    <><CheckCircle2 className="w-3 h-3 text-emerald-400" /><span>Backend online</span></>
                  ) : (
                    <><AlertCircle className="w-3 h-3 text-red-400" /><span>Backend offline</span></>
                  )}
                </div>
                <div className="text-muted-foreground">Express 127.0.0.1:3031</div>
              </div>
            </TooltipContent>
          </Tooltip>

        </TooltipProvider>
        <AccountSwitcher />
        <NotificationPopover />
      </div>
    </header>
  )
}
