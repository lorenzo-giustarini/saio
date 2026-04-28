import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { formatRelativeTime } from '@/lib/utils'

interface LogEntry {
  ts: string
  type: string
  message: string
}

export function AuditLog() {
  const [entries, setEntries] = useState<LogEntry[]>([])

  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        if (data.type && data.filename) {
          setEntries((prev) => [
            { ts: data.timestamp || new Date().toISOString(), type: data.type, message: `${data.kind || 'file'}: ${data.filename}` },
            ...prev,
          ].slice(0, 50))
        }
      } catch {
        /* ignore */
      }
    }
    return () => es.close()
  }, [])

  return (
    <Card className="neon-card">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Audit Log (live)</h3>
        </div>
        <p className="text-[10px] text-muted-foreground">Eventi file system via SSE</p>
      </CardHeader>
      <CardContent>
        <div className="max-h-60 overflow-auto scrollbar-thin space-y-1">
          {entries.length === 0 && (
            <p className="text-xs text-muted-foreground">In attesa di eventi...</p>
          )}
          {entries.map((e, i) => (
            <div key={i} className="text-[10px] flex items-start gap-2 font-mono py-1 border-b border-border/40 last:border-0">
              <span className="text-muted-foreground shrink-0">{formatRelativeTime(e.ts)}</span>
              <span
                className={
                  e.type === 'created'
                    ? 'text-emerald-400'
                    : e.type === 'deleted'
                    ? 'text-red-400'
                    : 'text-amber-400'
                }
              >
                [{e.type}]
              </span>
              <span className="truncate">{e.message}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
