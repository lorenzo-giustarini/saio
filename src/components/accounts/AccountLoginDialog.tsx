import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Loader2, CheckCircle2, XCircle, Terminal as TerminalIcon, Sparkles, Key, Send, ArrowDown } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Props {
  open: boolean
  onClose: () => void
  accountId: string
  accountLabel: string
  cliName: string
  mode: string
  /** V14: target su cui aprire la sessione di login. 'local' (default) o vpsId per SSH. */
  target?: string
  /** V14: label leggibile del target (es. "VPS prod v3.46") per i messaggi UX. */
  targetLabel?: string
}

/**
 * V13.2-T2: Login dialog for CLI-based accounts.
 * Opens a dedicated PTY session with the CLI running under a synthetic projectId
 * `login-<accountId>`. User completes interactive login (OAuth/device code/API key)
 * inside the embedded xterm. On close, polls health → if ready, user can activate.
 */
export function AccountLoginDialog({ open, onClose, accountId, accountLabel, cliName, mode, target = 'local', targetLabel }: Props) {
  const isRemote = target && target !== 'local'
  const targetDisplay = targetLabel || (isRemote ? target : 'Local')
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const inputBarRef = useRef<HTMLInputElement>(null)
  const resizeObsRef = useRef<ResizeObserver | null>(null)
  const [status, setStatus] = useState<'initializing' | 'connecting' | 'ready' | 'error' | 'closed'>('initializing')
  const [errMsg, setErrMsg] = useState('')
  const [checkHealthBusy, setCheckHealthBusy] = useState(false)
  const [healthResult, setHealthResult] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')

  // Unique session id so multiple login dialogs possible + kill on close
  const loginProjectId = `login-${accountId}`

  useEffect(() => {
    if (!open) return
    // V13.3-T5: reset state ad ogni apertura + delay init finché Dialog ha dimensioni stabili
    setStatus('initializing')
    setErrMsg('')
    setHealthResult(null)

    let term: Terminal | null = null
    let fit: FitAddon | null = null
    let ws: WebSocket | null = null
    let onR: (() => void) | null = null

    const initTimer = setTimeout(() => {
      if (!containerRef.current) {
        console.error('[AccountLoginDialog] container ref mancante dopo 300ms')
        setStatus('error')
        setErrMsg('Container terminale non disponibile — riapri il popup')
        return
      }
      console.log('[AccountLoginDialog] init terminal', { accountId, cliName, mode, loginProjectId })

      try {
        term = new Terminal({
          cursorBlink: true,
          fontSize: 13,
          fontFamily: 'JetBrains Mono, Consolas, monospace',
          theme: { background: '#0a0a0a', foreground: '#e4e4e7', cursor: '#a78bfa' },
          scrollback: 5000,
          convertEol: true,
          allowProposedApi: true,
          scrollOnUserInput: true,
          smoothScrollDuration: 80,
        })
        fit = new FitAddon()
        term.loadAddon(fit)
        term.open(containerRef.current)
        termRef.current = term
        fitRef.current = fit
        try { fit.fit() } catch (err) { console.warn('[AccountLoginDialog] fit.fit() fallito:', err) }
      } catch (err: any) {
        console.error('[AccountLoginDialog] xterm init failed:', err)
        setStatus('error')
        setErrMsg(`Init xterm fallito: ${err?.message || err}`)
        return
      }

      setStatus('connecting')

      const params = new URLSearchParams()
      params.set('forceNew', 'true')
      params.set('accountId', accountId)
      // V14: target remoto → ws-pty userà opts.remote per spawn SSH
      if (isRemote) {
        params.set('vpsId', target!)
        params.set('cliName', cliName)
      }
      const wsUrl = `ws://${window.location.hostname}:3031/api/pty/${encodeURIComponent(loginProjectId)}?${params.toString()}`
      console.log('[AccountLoginDialog] WS connect:', wsUrl, { target })

      try {
        ws = new WebSocket(wsUrl)
      } catch (err: any) {
        console.error('[AccountLoginDialog] WS construct failed:', err)
        setStatus('error')
        setErrMsg(`WebSocket init fallito: ${err?.message || err}`)
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        console.log('[AccountLoginDialog] WS open')
        if (!term || !ws) return
        const { cols, rows } = term
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'ready') {
            console.log('[AccountLoginDialog] PTY ready')
            setStatus('ready')
            // V13.4: re-fit + auto-focus input bar (più intuitivo del terminale)
            setTimeout(() => {
              try { fitRef.current?.fit() } catch { /* ignore */ }
              try { inputBarRef.current?.focus() } catch { /* ignore */ }
            }, 80)
          } else if (msg.type === 'data') {
            term?.write(msg.data)
          } else if (msg.type === 'error') {
            console.error('[AccountLoginDialog] PTY error:', msg.error)
            setStatus('error')
            setErrMsg(msg.error || 'Errore PTY sconosciuto')
          } else if (msg.type === 'exit') {
            console.log('[AccountLoginDialog] PTY exit code=', msg.code)
            setStatus('closed')
            term?.write(`\r\n\x1b[33m[sessione login chiusa, code=${msg.code}]\x1b[0m\r\n`)
          }
        } catch (err) {
          console.warn('[AccountLoginDialog] msg parse failed:', err)
        }
      }
      ws.onerror = (ev) => {
        console.error('[AccountLoginDialog] WS error event:', ev)
        setStatus('error')
        setErrMsg('Errore WebSocket — verifica che il backend Express sia attivo su :3031')
      }
      ws.onclose = (ev) => {
        console.log('[AccountLoginDialog] WS close', { code: ev.code, reason: ev.reason })
        setStatus((prev) => (prev === 'error' ? 'error' : 'closed'))
      }

      term.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'data', data }))
      })
      term.onResize(({ cols, rows }) => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      })

      onR = () => { try { fit?.fit() } catch { /* ignore */ } }
      window.addEventListener('resize', onR)

      // Responsive: re-fit on container size change (Dialog resize, viewport changes, etc)
      if (containerRef.current && 'ResizeObserver' in window) {
        const ro = new ResizeObserver(() => {
          try { fit?.fit() } catch { /* ignore */ }
        })
        ro.observe(containerRef.current)
        resizeObsRef.current = ro
      }
    }, 300)

    return () => {
      clearTimeout(initTimer)
      if (onR) window.removeEventListener('resize', onR)
      if (resizeObsRef.current) {
        try { resizeObsRef.current.disconnect() } catch { /* ignore */ }
        resizeObsRef.current = null
      }
      if (ws) ws.close()
      if (term) term.dispose()
      fetch(`/api/pty/${encodeURIComponent(loginProjectId)}`, { method: 'DELETE' }).catch(() => { /* ignore */ })
      termRef.current = null
      fitRef.current = null
      wsRef.current = null
    }
  }, [open, accountId, loginProjectId])

  const checkHealth = async () => {
    setCheckHealthBusy(true)
    try {
      const res: any = await api.accounts.health(accountId, true)
      setHealthResult(res.health)
      if (res.health === 'ready') {
        toast.success('Login completato — account pronto')
      } else {
        toast.warning(`Health: ${res.health}`, {
          description: res.message || 'Account non ancora ready. Completa il login nel terminale qui sopra.',
        })
      }
    } catch (err: any) {
      toast.error('Errore health check', { description: String(err.message || err) })
    } finally {
      setCheckHealthBusy(false)
    }
  }

  const handleClose = () => {
    if (status === 'ready') {
      // Kill PTY + close
      fetch(`/api/pty/${encodeURIComponent(loginProjectId)}`, { method: 'DELETE' }).catch(() => { /* ignore */ })
    }
    onClose()
  }

  const focusTerminal = () => {
    try { termRef.current?.focus() } catch { /* ignore */ }
  }

  const sendToPty = (data: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'data', data }))
    // Auto-scroll terminale sull'ultima riga
    try { termRef.current?.scrollToBottom() } catch { /* ignore */ }
  }

  const handleSubmitInput = () => {
    if (status !== 'ready') return
    // Invio sempre il newline anche se input vuoto (utile per "premi Invio per continuare")
    sendToPty(`${inputValue}\r`)
    setInputValue('')
    inputBarRef.current?.focus()
  }

  const sendCtrl = (key: 'c' | 'd' | 'l') => {
    // Ctrl+C = 0x03, Ctrl+D = 0x04, Ctrl+L = 0x0c (clear)
    const map = { c: '\x03', d: '\x04', l: '\x0c' }
    sendToPty(map[key])
    inputBarRef.current?.focus()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="w-[95vw] max-w-4xl h-[90vh] sm:h-[85vh] max-h-[90vh] sm:max-h-[85vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="shrink-0 px-4 sm:px-6 pt-5 pb-3 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Key className="w-5 h-5 text-amber-400 shrink-0" />
            <span className="truncate">Login {accountLabel}</span>
            <Badge variant="outline" className="text-[9px] h-4 border-violet-500/40 text-violet-300">
              {cliName}
            </Badge>
            <Badge variant="outline" className="text-[9px] h-4">{mode}</Badge>
            <Badge
              variant="outline"
              className={cn(
                'text-[9px] h-4',
                isRemote
                  ? 'border-violet-500/40 bg-violet-500/15 text-violet-200'
                  : 'border-blue-500/40 bg-blue-500/15 text-blue-200'
              )}
            >
              {isRemote ? `→ ${targetDisplay}` : '→ Local'}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {isRemote ? (
              <>Stai loggandoti <strong>su {targetDisplay}</strong> via SSH. Il login del CLI verrà salvato sul VPS, non sulla tua macchina locale. Usa la barra sotto per scrivere.</>
            ) : mode === 'plan'
              ? `Completa il login OAuth per ${cliName} su Local. Usa la barra in basso per scrivere o clicca dentro al terminale.`
              : `Il CLI ${cliName} sta partendo su Local. Usa la barra in basso per inviare comandi e rispondere ai prompt.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col gap-2 px-4 sm:px-6 py-3">
          <div className="flex items-center gap-2 text-xs px-2 py-1 bg-muted/30 rounded shrink-0">
            {status === 'initializing' && (<><Loader2 className="w-3 h-3 animate-spin text-violet-400" /><span>Inizializzazione terminale…</span></>)}
            {status === 'connecting' && (<><Loader2 className="w-3 h-3 animate-spin text-amber-400" /><span>Connessione WebSocket…</span></>)}
            {status === 'ready' && (<><Sparkles className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Terminale attivo — scrivi nella barra sotto o clicca nel terminale</span></>)}
            {status === 'error' && (<><XCircle className="w-3 h-3 text-red-400" /><span className="text-red-400 truncate">{errMsg || 'Errore'}</span></>)}
            {status === 'closed' && (<><TerminalIcon className="w-3 h-3 text-muted-foreground" /><span>Sessione terminata</span></>)}
          </div>

          {status === 'error' && errMsg && (
            <div className="border border-red-500/40 bg-red-500/10 p-3 rounded text-sm shrink-0">
              <div className="font-semibold text-red-400 mb-1 flex items-center gap-1.5">
                <XCircle className="w-3.5 h-3.5" /> Errore sessione login
              </div>
              <div className="text-red-300 text-xs mb-2 font-mono break-all">{errMsg}</div>
              <p className="text-xs text-muted-foreground">
                Se il CLI <strong>{cliName}</strong> non è installato, chiudi questo popup e clicca <strong>Installa</strong> sulla card dell'account.
                Se l'errore persiste, verifica che il backend Express sia attivo su <code>:3031</code>.
              </p>
            </div>
          )}

          {/* Terminal embedded — flex-1 con min-h ridotto, scroll xterm nativo abilitato (rotella mouse + scrollbar interna visibile via CSS) */}
          <div
            ref={containerRef}
            onClick={focusTerminal}
            title="Clicca per dare focus al terminale (puoi anche scrivere nella barra sotto)"
            className="login-xterm-container flex-1 min-h-[140px] sm:min-h-[200px] w-full bg-[#0a0a0a] rounded border border-border cursor-text focus-within:border-violet-500/60 transition-colors overflow-hidden"
          />
          <style>{`
            .login-xterm-container .xterm-viewport::-webkit-scrollbar { width: 8px; }
            .login-xterm-container .xterm-viewport::-webkit-scrollbar-track { background: #0a0a0a; }
            .login-xterm-container .xterm-viewport::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 4px; }
            .login-xterm-container .xterm-viewport::-webkit-scrollbar-thumb:hover { background: #52525b; }
            .login-xterm-container .xterm-viewport { scrollbar-width: thin; scrollbar-color: #3f3f46 #0a0a0a; }
          `}</style>

          {/* Input bar (stile chat) — più intuitivo che scrivere dentro xterm */}
          <div className="shrink-0 flex items-center gap-1.5 sm:gap-2 px-2 py-2 bg-muted/20 rounded border border-border/60 focus-within:border-violet-500/60 transition-colors">
            <span className="text-[10px] font-mono text-violet-400 shrink-0 select-none hidden sm:inline">{cliName}&gt;</span>
            <Input
              ref={inputBarRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSubmitInput()
                } else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
                  // Solo se NON c'è selezione attiva (lascia funzionare copy nativo)
                  if (window.getSelection()?.toString()) return
                  e.preventDefault()
                  sendCtrl('c')
                } else if (e.key === 'd' && e.ctrlKey) {
                  e.preventDefault()
                  sendCtrl('d')
                } else if (e.key === 'l' && e.ctrlKey) {
                  e.preventDefault()
                  sendCtrl('l')
                }
              }}
              placeholder={
                status === 'ready'
                  ? 'Scrivi qui e premi Invio (es. risposta a prompt, comando…)'
                  : status === 'connecting' || status === 'initializing'
                  ? 'Attendi che il terminale sia pronto…'
                  : status === 'error'
                  ? 'Terminale in errore'
                  : 'Sessione chiusa'
              }
              disabled={status !== 'ready'}
              className="h-8 text-xs font-mono bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-1"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                disabled={status !== 'ready'}
                onClick={() => sendCtrl('c')}
                title="Invia Ctrl+C (interrompi processo)"
                className="h-7 px-2 text-[10px] font-mono text-amber-300 hover:bg-amber-500/10"
              >
                ^C
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={status !== 'ready'}
                onClick={() => sendCtrl('d')}
                title="Invia Ctrl+D (EOF / chiudi stdin)"
                className="h-7 px-2 text-[10px] font-mono text-rose-300 hover:bg-rose-500/10 hidden sm:inline-flex"
              >
                ^D
              </Button>
              <Button
                size="sm"
                disabled={status !== 'ready'}
                onClick={handleSubmitInput}
                title="Invia (Invio)"
                className="h-7 gap-1 text-xs"
              >
                <Send className="w-3 h-3" />
                <span className="hidden sm:inline">Invia</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { try { termRef.current?.scrollToBottom() } catch { /* ignore */ } }}
                title="Scorri al fondo del terminale"
                className="h-7 w-7 p-0 hidden sm:inline-flex"
              >
                <ArrowDown className="w-3 h-3" />
              </Button>
            </div>
          </div>

          {healthResult && (
            <div className={`text-xs px-2 py-1 rounded shrink-0 ${healthResult === 'ready' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/10 text-amber-300 border border-amber-500/30'}`}>
              Health: <strong>{healthResult}</strong>
              {healthResult === 'ready' && ' — puoi chiudere e attivare'}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 px-4 sm:px-6 py-3 border-t border-border/50 bg-background/95 backdrop-blur-sm">
          <Button
            variant="outline"
            size="sm"
            onClick={checkHealth}
            disabled={checkHealthBusy || status !== 'ready'}
            title={
              status === 'ready'
                ? 'Verifica che il login sia andato a buon fine'
                : status === 'initializing' || status === 'connecting'
                ? 'Attendi che il terminale sia pronto prima di verificare'
                : status === 'error'
                ? 'Risolvi prima l’errore del terminale sopra'
                : 'Sessione chiusa — riapri il popup per rilanciare il CLI'
            }
            className="gap-1.5"
          >
            {checkHealthBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {status !== 'ready' ? 'Attendi terminale…' : 'Verifica login'}
          </Button>
          <Button size="sm" onClick={handleClose} className="gap-1.5">
            Chiudi sessione login
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
