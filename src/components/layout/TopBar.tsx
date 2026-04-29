import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Command as CommandIcon, Activity, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { NotificationPopover } from './NotificationPopover'
import { AccountSwitcher } from './AccountSwitcher'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { cn } from '@/lib/utils'

async function fetchHealth() {
  const res = await fetch('/api/health')
  return res.json() as Promise<{ status: string }>
}

const LOCALE_MAP: Record<string, string> = {
  it: 'it-IT',
  en: 'en-US',
  es: 'es-ES',
}

export function TopBar() {
  const { i18n, t } = useTranslation('common')
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const tm = setInterval(() => setNow(new Date()), 1000 * 30)
    return () => clearInterval(tm)
  }, [])

  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
    retry: 5,
    retryDelay: (attempt) => Math.min(2000, 500 + attempt * 200),
  })

  const localeTag = LOCALE_MAP[i18n.resolvedLanguage || 'en'] || 'en-US'
  // V15.9 WS43.1 — Mobile: keep just day+month so the topbar fits at 320px
  // even when LanguageSwitcher and AccountSwitcher sit alongside.
  const dateLabel = now.toLocaleDateString(localeTag, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
  const dateLabelMobile = now.toLocaleDateString(localeTag, {
    day: '2-digit',
    month: 'short',
  })
  const timeLabel = now.toLocaleTimeString(localeTag, {
    hour: '2-digit',
    minute: '2-digit',
  })

  const isHealthy = health.data?.status === 'ok'

  return (
    <header className="h-14 border-b border-border bg-card/40 backdrop-blur-sm flex items-center justify-between px-3 sm:px-4 md:px-6 gap-2">
      <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
        <div className="text-[11px] sm:text-xs md:text-sm min-w-0 truncate">
          <span className="font-medium capitalize sm:hidden">{dateLabelMobile}</span>
          <span className="font-medium capitalize hidden sm:inline">{dateLabel}</span>
          <span className="text-muted-foreground ml-1 sm:ml-2">{timeLabel}</span>
        </div>
      </div>

      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        <LanguageSwitcher compact />
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground hidden sm:flex"
                onClick={() => {
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
              <Button variant="ghost" size="icon" className="relative" aria-label={isHealthy ? t('status.online') : t('status.offline')}>
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
                    <><CheckCircle2 className="w-3 h-3 text-emerald-400" /><span>{t('status.online')}</span></>
                  ) : (
                    <><AlertCircle className="w-3 h-3 text-red-400" /><span>{t('status.offline')}</span></>
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
