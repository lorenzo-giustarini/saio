import { useEffect, useRef, useState } from 'react'
import { RefreshCcw } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import type { TaskStatus } from '@/lib/types'

interface LogDrawerProps {
  task: TaskStatus | null
  onClose: () => void
}

export function LogDrawer({ task, onClose }: LogDrawerProps) {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!task) return
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      setLoading(true)
      try {
        // Fetch log via server — placeholder: reading filesystem-backed endpoint
        const res = await fetch(`/api/logs/${encodeURIComponent(task.projectId)}/stream`, {
          headers: { Accept: 'text/plain' },
        })
        if (res.ok) {
          const text = await res.text()
          if (!cancelled) setContent(text || '(log vuoto — la sessione non ha ancora scritto nulla)')
        } else {
          if (!cancelled) setContent(`(log non disponibile — ${res.status})`)
        }
      } catch (err) {
        if (!cancelled) setContent(`(errore fetch log: ${err})`)
      }
      setLoading(false)
    }
    tick()
    const interval = setInterval(tick, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [task?.projectId])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [content])

  return (
    <Sheet open={!!task} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col">
        <SheetHeader>
          <SheetTitle>Log sessione — {task?.title}</SheetTitle>
          <SheetDescription className="text-xs font-mono truncate">
            {task?.logFile}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-hidden mt-4 rounded border border-border bg-black/40">
          <div
            ref={scrollRef}
            className="h-full overflow-auto scrollbar-thin p-3 text-[11px] font-mono leading-relaxed whitespace-pre-wrap text-emerald-300/90"
          >
            {content || (loading ? 'Loading...' : '(nessun contenuto)')}
          </div>
        </div>
        <div className="flex items-center gap-2 pt-2">
          <RefreshCcw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          <span className="text-[10px] text-muted-foreground">Auto-refresh ogni 3s</span>
        </div>
      </SheetContent>
    </Sheet>
  )
}
