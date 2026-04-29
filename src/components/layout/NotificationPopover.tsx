import { useNavigate } from 'react-router-dom'
import { Bell, BellRing, CheckCheck, Trash2, AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useNotifications } from '@/store/notificationStore'
import { formatRelativeTime, cn } from '@/lib/utils'

const typeConfig = {
  waiting_user: { icon: AlertTriangle, color: 'text-amber-400' },
  task_done: { icon: CheckCircle2, color: 'text-emerald-400' },
  task_failed: { icon: AlertTriangle, color: 'text-red-400' },
  info: { icon: Info, color: 'text-blue-400' },
}

export function NotificationPopover() {
  const navigate = useNavigate()
  const items = useNotifications((s) => s.items)
  const unread = items.filter((i) => !i.read).length
  const markRead = useNotifications((s) => s.markRead)
  const markAllRead = useNotifications((s) => s.markAllRead)
  const clear = useNotifications((s) => s.clear)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          {unread > 0 ? <BellRing className="w-4 h-4 text-amber-400" /> : <Bell className="w-4 h-4" />}
          {unread > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center animate-pulse">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1.5rem)] p-0">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Notifiche</h3>
            {items.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {unread}/{items.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={markAllRead} title="Segna tutte come lette">
                <CheckCheck className="w-3.5 h-3.5" />
              </Button>
            )}
            {items.length > 0 && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-400" onClick={clear} title="Cancella tutte">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
        <ScrollArea className="max-h-[60vh]">
          {items.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
              Nessuna notifica
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.slice(0, 30).map((n) => {
                const cfg = typeConfig[n.type] || typeConfig.info
                const Icon = cfg.icon
                return (
                  <button
                    key={n.id}
                    onClick={() => {
                      markRead(n.id)
                      if (n.projectId) navigate(`/projects/${n.projectId}`)
                    }}
                    className={cn(
                      'w-full text-left p-3 hover:bg-accent transition-colors',
                      !n.read && 'bg-primary/5'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <Icon className={cn('w-4 h-4 shrink-0 mt-0.5', cfg.color)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={cn('text-xs font-semibold truncate', !n.read && 'text-foreground', n.read && 'text-muted-foreground')}>
                            {n.title}
                          </span>
                          {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                        <div className="text-[10px] text-muted-foreground/60 mt-1">{formatRelativeTime(n.ts)}</div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
