import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Loader2, XCircle, RefreshCw, RotateCcw, Sparkles, History, Eraser, FileText, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ChatInputBar, type ModelId, type PermissionMode } from './ChatInputBar'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface EmbeddedChatProps {
  projectId: string
  className?: string
}

interface SessionInfo {
  projectId: string
  workspace: string
  active: boolean
  canResume: boolean
  lastSession: { lastUsed: string; messages: number; sessionId: string } | null
}

async function fetchInfo(projectId: string): Promise<SessionInfo> {
  const res = await fetch(`/api/pty/${projectId}/info`)
  return res.json()
}

// V15.0 WS22+WS23 — Promuove le scelte multi-opzione a brief in-session per Inbox.
// WS23: prima tenta AI summary cheap (haiku/4o-mini/flash) via /api/briefs/summarize.
// Fallback graceful a estrazione naive (3 righe sopra prima opzione).
async function promoteChoicesToInbox(
  matches: Array<{ num: string; text: string }>,
  projectId: string,
  buffer: string,
  providerHint?: string,  // accepts any providerId, backend normalizes (google→gemini)
): Promise<void> {
  // V15.0 WS23 — Step 1: prova AI summary (best-effort, fallback graceful)
  let aiTitle: string | null = null
  let aiSummary: string | null = null
  let enrichedOptions = matches
  try {
    const r = await fetch('/api/briefs/summarize', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buffer: buffer.slice(-3500), projectId, options: matches, providerHint }),
    })
    if (r.ok) {
      const data = (await r.json()) as {
        title: string | null
        summary: string | null
        options: Array<{ num: string; label: string }> | null
        fallback: false | string
      }
      if (data.fallback === false) {
        aiTitle = data.title
        aiSummary = data.summary
        if (Array.isArray(data.options) && data.options.length > 0) {
          enrichedOptions = data.options.map((o) => ({
            num: String(o.num),
            text: String(o.label || '').slice(0, 200) ||
              matches.find((m) => m.num === String(o.num))?.text ||
              '',
          }))
        }
      }
    }
  } catch {
    /* AI summary failed → fallback heuristic */
  }

  // Step 2: fallback heuristic se AI ha fallito
  let questionLine = aiSummary || ''
  if (!questionLine) {
    const lines = buffer.split('\n')
    const optionRegex = /^\s*(?:❯\s*)?([1-9])[.)]\s+(.+?)\s*$/
    const firstMatchIdx = lines.findIndex((l) => optionRegex.test(l))
    if (firstMatchIdx > 0) {
      const candidates = lines
        .slice(Math.max(0, firstMatchIdx - 4), firstMatchIdx)
        .map((l) => l.replace(/[╭╰│─━┃┏┓┗┛]/g, '').trim())
        .filter((l) => l.length > 5 && !/^[\s\-=*]+$/.test(l))
      if (candidates.length > 0) {
        questionLine = candidates.join(' ').trim().slice(0, 200)
      }
    }
    if (!questionLine) questionLine = 'Scelta multipla in sessione Claude'
  }

  const title = aiTitle ||
    (questionLine.length > 80 ? questionLine.slice(0, 77) + '…' : questionLine) ||
    `Scelta richiesta (${projectId})`
  const optionsText = enrichedOptions.map((m) => `${m.num}. ${m.text}`).join('\n')

  const decision = {
    title: title.slice(0, 200),
    causa: questionLine.slice(0, 1900),
    effetto: {
      si: enrichedOptions[0] ? `Opzione 1: ${enrichedOptions[0].text}` : 'Procedi',
      no: enrichedOptions[1] ? `Opzione 2: ${enrichedOptions[1].text}` : 'Rimanda',
    },
    rischi: [],
    soluzioneProposta: `Scegli una delle opzioni nel terminale o qui in Inbox:\n${optionsText.slice(0, 2900)}`,
    priority: 'normal' as const,
  }

  await fetch('/api/briefs/decision', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, decision }),
  })
}

export function EmbeddedChat({ projectId, className }: EmbeddedChatProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const kickoffInjectedRef = useRef<boolean>(false)
  const promptReadyRef = useRef<boolean>(false)
  const [promptReadyTick, setPromptReadyTick] = useState(0)
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error' | 'closed'>('connecting')
  // V14.17: bottone "Invia brief" pulsante visibile per 30s post auto-inject
  const [showKickoffSubmitBtn, setShowKickoffSubmitBtn] = useState(false)
  const [errMsg, setErrMsg] = useState<string>('')
  const [nonce, setNonce] = useState(0)
  const [forceNew, setForceNew] = useState(false)
  // V14.1: tick incrementato a onopen/onclose del WS per derivare reattivamente
  // l'abilitazione dell'input bar dal readyState corrente di wsRef.
  const [wsTick, setWsTick] = useState(0)

  // Settings (persist nel localStorage per progetto)
  const [model, setModel] = useState<ModelId>(() => {
    try {
      return (localStorage.getItem(`chat-model-${projectId}`) as ModelId) || 'default'
    } catch { return 'default' }
  })
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    try {
      return (localStorage.getItem(`chat-perm-${projectId}`) as PermissionMode) || 'default'
    } catch { return 'default' }
  })
  const [appliedModel, setAppliedModel] = useState<ModelId>(model)
  const [appliedPerm, setAppliedPerm] = useState<PermissionMode>(permissionMode)
  const [pendingChoices, setPendingChoices] = useState<Array<{ key: string; label: string; description?: string }>>([])

  const settingsDirty = model !== appliedModel || permissionMode !== appliedPerm

  useEffect(() => {
    try {
      localStorage.setItem(`chat-model-${projectId}`, model)
      localStorage.setItem(`chat-perm-${projectId}`, permissionMode)
    } catch { /* ignore */ }
  }, [model, permissionMode, projectId])

  const infoQ = useQuery({
    queryKey: ['pty', 'info', projectId],
    queryFn: () => fetchInfo(projectId),
    staleTime: 10_000,
  })

  // V13.2-T1: resolve account active for label
  const projectQ = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.projects.get(projectId),
    staleTime: 30_000,
  })
  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts.list(),
    staleTime: 30_000,
  })

  const effectiveAccount = useMemo(() => {
    if (!accountsQ.data) return null
    // Priority: project.accountOverride > global active
    const proj: any = projectQ.data
    const overrideId = proj?.accountOverride
    if (overrideId) {
      return accountsQ.data.accounts.find((a) => a.id === overrideId) || null
    }
    return accountsQ.data.accounts.find((a) => a.id === accountsQ.data.activeId) || null
  }, [accountsQ.data, projectQ.data])

  // V15.0 WS24 — Ref provider corrente per access da detectPrompts (callback stabile)
  const providerHintRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    providerHintRef.current = effectiveAccount?.providerId
  }, [effectiveAccount])

  const effectiveCli = effectiveAccount?.cliName || 'claude'

  // Permission prompts parser: detects "1. Yes" / "2. No" / "❯" patterns
  const outputBufRef = useRef<string>('')
  // V15.0 WS22 — Dedupe per evitare doppio POST per lo stesso menu
  const lastPromotedChoicesKeyRef = useRef<string | null>(null)
  // V15.0 WS25 — Implicit-question wait flag (pallino giallo senza brief Inbox)
  const lastImplicitWaitRef = useRef<boolean>(false)

  const detectPrompts = useCallback((chunk: string) => {
    const clean = chunk.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
    outputBufRef.current = (outputBufRef.current + clean).slice(-4000)
    const buf = outputBufRef.current

    // V14.11: sniff "prompt input ready" — quando il TUI (Claude/Codex) mostra ❯ o > su una
    // riga vuota, è disponibile a ricevere comandi/testo. Usato dall'auto-inject kickoff
    // per evitare di inviare durante lo splash (che fa perdere l'input).
    if (!promptReadyRef.current) {
      // Pattern: ❯ Claude TUI Ink, › Codex variants, $ # bash/zsh fallback su ultima riga
      // Cerca un'occorrenza recente non seguita da contenuto (cioè "prompt vuoto").
      if (/[❯›]\s*$/m.test(buf) || /[❯›]\s+\n/.test(buf)) {
        promptReadyRef.current = true
        setPromptReadyTick((t) => t + 1)
      }
    }

    const lines = buf.split('\n').slice(-15)
    const optionRegex = /^\s*(?:❯\s*)?([1-9])[.)]\s+(.+?)\s*$/
    const matches: Array<{ num: string; text: string; lineIdx: number; hasMarker: boolean }> = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      const m = line.match(optionRegex)
      if (m) {
        const hasMarker = /^[\s]*❯/.test(line)
        matches.push({ num: m[1]!, text: m[2]!.slice(0, 200), lineIdx: i, hasMarker })
      }
    }

    // V15.0 WS23 — Tighter heuristics per ridurre falsi positivi (liste descrittive
    // di Claude tipo "Ecco i 5 step: 1. ..." NON sono menu di scelta interattivi).
    // Vero menu Claude TUI:
    //  1. Almeno 1 opzione ha cursore `❯` (TUI selection marker)
    //  2. Lunghezza media testo opzioni ≤ 45 char (menu = breve, non descrizione)
    //  3. Opzioni in righe consecutive (gap max 1 riga)
    //  4. Match count tra 2 e 6 (existing)
    const isLikelyChoiceMenu = (() => {
      if (matches.length < 2 || matches.length > 6) return false
      const hasAnyMarker = matches.some((m) => m.hasMarker)
      if (!hasAnyMarker) return false
      const avgLen = matches.reduce((s, m) => s + m.text.length, 0) / matches.length
      if (avgLen > 45) return false
      for (let i = 1; i < matches.length; i++) {
        if (matches[i]!.lineIdx - matches[i - 1]!.lineIdx > 2) return false
      }
      return true
    })()

    if (isLikelyChoiceMenu) {
      const unique = new Map<string, { num: string; text: string }>()
      matches.forEach((m) => unique.set(m.num, { num: m.num, text: m.text.slice(0, 60) }))
      const uniqueArr = Array.from(unique.values())
      setPendingChoices(uniqueArr.map((m) => ({
        key: m.num,
        label: `${m.num}. ${m.text.length > 32 ? m.text.slice(0, 30) + '…' : m.text}`,
        description: m.text,
      })))

      // V15.0 WS22 — Promuovi a Inbox come in-session brief + segnala waiting_user
      const choicesKey = uniqueArr.map(m => `${m.num}.${m.text}`).join('|')
      if (choicesKey !== lastPromotedChoicesKeyRef.current) {
        lastPromotedChoicesKeyRef.current = choicesKey
        // Fire-and-forget: errori non bloccano UI (pendingChoices locali OK comunque)
        promoteChoicesToInbox(uniqueArr, projectId, buf, providerHintRef.current).catch((err) =>
          console.warn('[EmbeddedChat] promote to Inbox failed (non-fatal):', err)
        )
        // Segnala backend: questa sessione è in attesa scelta utente (pallino giallo)
        fetch(`/api/projects/${encodeURIComponent(projectId)}/session-status`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'waiting_user' }),
        }).catch(() => { /* non-fatal */ })
      }
    } else {
      setPendingChoices([])

      // V15.0 WS25 — Detect "domanda implicita" anche senza menu numerato.
      // Triggera SOLO waiting_user (pallino giallo), NON crea brief Inbox.
      // Heuristic: ultima riga non vuota termina con `?` OPPURE contiene
      // keywords italiane/inglesi richiesta-conferma.
      const linesAll = buf.split('\n').slice(-10)
      const lastNonEmpty =
        [...linesAll].reverse().find((l) => l.trim().length > 0)?.trim() || ''
      const endsWithQuestionMark = /[?？]\s*$/.test(lastNonEmpty)
      const askKeywords =
        /(?:vuoi che|procedo|confermi|posso (?:procedere|continuare)|devo (?:procedere|continuare)|ok per te|fammi sapere|confermo|should i|want me to|shall i|confirm\?|proceed\?|do you want|ok for you)/i
      const hasAskKeyword = askKeywords.test(lastNonEmpty)
      const detectImplicitWait = (endsWithQuestionMark || hasAskKeyword) && lastNonEmpty.length > 5

      if (detectImplicitWait && !lastImplicitWaitRef.current) {
        lastImplicitWaitRef.current = true
        fetch(`/api/projects/${encodeURIComponent(projectId)}/session-status`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'waiting_user' }),
        }).catch(() => { /* */ })
      } else if (!detectImplicitWait && lastImplicitWaitRef.current) {
        // Reset implicit wait quando Claude ha processato/continuato
        lastImplicitWaitRef.current = false
        if (lastPromotedChoicesKeyRef.current === null) {
          // Solo se non c'è già un waiting da menu pending
          fetch(`/api/projects/${encodeURIComponent(projectId)}/session-status`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'running' }),
          }).catch(() => { /* */ })
        }
      }

      // Reset dedupe menu quando il prompt cambia (Claude ha processato la scelta)
      if (lastPromotedChoicesKeyRef.current !== null) {
        lastPromotedChoicesKeyRef.current = null
        // Reset waiting → running lato backend (se non c'è implicit attivo)
        if (!lastImplicitWaitRef.current) {
          fetch(`/api/projects/${encodeURIComponent(projectId)}/session-status`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'running' }),
          }).catch(() => { /* non-fatal */ })
        }
      }
    }
  }, [projectId])

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Consolas, monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#e4e4e7',
        cursor: '#a78bfa',
        selectionBackground: '#3f3f46',
      },
      scrollback: 5000,
      convertEol: true,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    termRef.current = term
    fitRef.current = fit

    try { fit.fit() } catch { /* ignore */ }

    const params = new URLSearchParams()
    if (forceNew) params.set('forceNew', 'true')
    if (appliedModel && appliedModel !== 'default') params.set('model', appliedModel)
    if (appliedPerm && appliedPerm !== 'default') params.set('permissionMode', appliedPerm)
    const qs = params.toString() ? `?${params.toString()}` : ''
    const wsUrl = `ws://${window.location.hostname}:3031/api/pty/${encodeURIComponent(projectId)}${qs}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      const { cols, rows } = term
      ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      setWsTick((t) => t + 1)
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'ready') {
          setStatus('ready')
          // V14.7: auto-inject kickoff è in un useEffect dedicato (no più stale closure su projectQ.data)
        } else if (msg.type === 'data') {
          term.write(msg.data)
          detectPrompts(msg.data)
        } else if (msg.type === 'error') {
          setStatus('error')
          setErrMsg(msg.error || 'server error')
        } else if (msg.type === 'exit') {
          setStatus('closed')
          term.write(`\r\n\x1b[33m[session ended, code=${msg.code}]\x1b[0m\r\n`)
        }
      } catch { /* ignore */ }
    }

    ws.onerror = () => {
      setStatus('error')
      setErrMsg('WebSocket error — controlla server 3031')
    }

    ws.onclose = () => {
      if (status !== 'error') setStatus('closed')
      setWsTick((t) => t + 1)
    }

    // V15.9 WS44 — Browser-style copy/paste in xterm:
    //   Ctrl+C / Cmd+C  → copia testo selezionato in clipboard. Senza selezione,
    //                      lascia passare al PTY come SIGINT (interrompe comando).
    //   Ctrl+Shift+C    → sempre copia (anche con SIGINT pending).
    //   Ctrl+V / Cmd+V  → paste dalla clipboard nel PTY.
    // Cross-OS: ctrlKey su Win/Linux, metaKey (Cmd) su macOS. detectMac via
    // navigator.platform (deprecato ma più affidabile di userAgent in Tauri WebView).
    term.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
      if (event.type !== 'keydown') return true
      const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
      const cmdLike = event.ctrlKey || (isMac && event.metaKey)
      if (!cmdLike) return true
      const key = event.key.toLowerCase()
      // Ctrl+Shift+C / Cmd+Shift+C → sempre copia
      if (event.shiftKey && key === 'c') {
        const sel = term.getSelection()
        if (sel) navigator.clipboard?.writeText(sel).catch(() => { /* clipboard denied */ })
        return false
      }
      // Ctrl+C / Cmd+C → copia se selezione, altrimenti SIGINT (forward al PTY)
      if (!event.shiftKey && key === 'c') {
        const sel = term.getSelection()
        if (sel) {
          navigator.clipboard?.writeText(sel).catch(() => { /* clipboard denied */ })
          return false
        }
        return true
      }
      // Ctrl+V / Cmd+V → paste dalla clipboard
      if (!event.shiftKey && key === 'v') {
        navigator.clipboard?.readText().then((t) => {
          if (t) term.paste(t)
        }).catch(() => { /* clipboard denied */ })
        return false
      }
      return true
    })

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data }))
      }
    })

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    const onResize = () => {
      try { fit.fit() } catch { /* ignore */ }
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      ws.close()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      wsRef.current = null
      // V14.11: reset prompt sniff state al cleanup → next mount/reconnect ri-sniffa
      promptReadyRef.current = false
      outputBufRef.current = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, nonce, forceNew, appliedModel, appliedPerm])

  const reconnect = () => {
    setStatus('connecting')
    setErrMsg('')
    setNonce((n) => n + 1)
  }

  // V14.23 — sostituito window.confirm() nativo con Dialog SAIO
  const [freshConfirmOpen, setFreshConfirmOpen] = useState(false)
  const startFresh = () => {
    setFreshConfirmOpen(true)
  }
  const confirmStartFresh = () => {
    setFreshConfirmOpen(false)
    setForceNew(true)
    setStatus('connecting')
    setNonce((n) => n + 1)
  }

  const applySettings = async () => {
    try { await fetch(`/api/pty/${projectId}`, { method: 'DELETE' }) } catch { /* ignore */ }
    setAppliedModel(model)
    setAppliedPerm(permissionMode)
    setStatus('connecting')
    setNonce((n) => n + 1)
  }

  // V14.1: retry breve se WS è in transizione CONNECTING → OPEN, log diagnostico se drop
  const sendText = useCallback((text: string, autoSubmit = false) => {
    const tryOnce = (attemptsLeft: number) => {
      const ws = wsRef.current
      if (!ws) {
        console.warn('[EmbeddedChat] sendText: nessun ws ref disponibile, dropped')
        return
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data: text + '\r' }))
        setPendingChoices([])
        // V15.0 WS21 — Auto-submit Esc+Enter per TUI Claude multiline input.
        // \r da solo riempie buffer ma non invia (multiline-aware). Esc+Enter
        // (\x1b\r) è la convenzione TUI di Claude CLI per submit definitivo.
        // Default false per non rompere flow programmatici (es. kickoff brief
        // che ha il suo timing 500ms). True per messaggi user da ChatInputBar.
        if (autoSubmit) {
          setTimeout(() => {
            const w = wsRef.current
            if (w && w.readyState === WebSocket.OPEN) {
              w.send(JSON.stringify({ type: 'data', data: '\x1b\r' }))
            }
          }, 100)
        }
        return
      }
      if (attemptsLeft > 0 && ws.readyState === WebSocket.CONNECTING) {
        setTimeout(() => tryOnce(attemptsLeft - 1), 50)
        return
      }
      console.warn(`[EmbeddedChat] sendText: ws readyState=${ws.readyState} (0=connecting,2=closing,3=closed), text dropped`)
    }
    tryOnce(3)
  }, [])

  const sendChoice = (num: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'data', data: num + '\r' }))
    setPendingChoices([])
  }

  // V14.14: auto-inject kickoff brief
  // - aspetta status='ready' (PTY backend pronto) + sniff `❯` (TUI input ready)
  // - invia il TESTO del brief (no slash command — `/read` non esiste in Claude)
  // - sendText fa singolo bulk write `text + '\r'` (pattern testato, funziona)
  // - fallback su `pendingKickoffPath` solo per progetti legacy (V14.5-V14.13)
  useEffect(() => {
    if (status !== 'ready') return
    if (kickoffInjectedRef.current) return
    const proj = projectQ.data as any
    const kickoffText: string | undefined = proj?.pendingKickoffText
    const kickoffPath: string | undefined = proj?.pendingKickoffPath
    // Preferisci pendingKickoffText (V14.14+). Fallback al path solo per progetti legacy.
    const payload = kickoffText || (kickoffPath ? `@${kickoffPath}` : null)
    if (!payload) return

    // V14.12: array di timer per cleanup centralizzato (typing simulation crea N timer)
    const timers: number[] = []

    // Aspetta che il prompt sia visibile o che scatti il fallback timer
    const promptReady = promptReadyRef.current
    if (!promptReady) {
      // Niente sniff ancora → fallback safety timer di 12s.
      timers.push(
        window.setTimeout(() => {
          if (kickoffInjectedRef.current) return
          console.warn('[EmbeddedChat] auto-inject: fallback 12s — prompt sniff non scattato, invio comunque')
          injectNow()
        }, 12000)
      )
      return () => timers.forEach((t) => clearTimeout(t))
    }

    // promptReady è true → invio dopo 2000ms di buffer (TUI completamente input-ready)
    timers.push(window.setTimeout(injectNow, 2000))
    return () => timers.forEach((t) => clearTimeout(t))

    function injectNow() {
      if (kickoffInjectedRef.current) return
      kickoffInjectedRef.current = true
      console.log(`[EmbeddedChat] auto-inject brief text (${payload!.length} chars)`)
      // V14.17: invio testo + tentativo auto-submit Esc+Enter + bottone pulsante fallback.
      sendText(payload!)
      // Tentativo auto-submit dopo 500ms (Esc+Enter è la convenzione TUI multiline submit)
      timers.push(window.setTimeout(() => {
        const ws = wsRef.current
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'data', data: '\x1b\r' }))
          console.log('[EmbeddedChat] auto-submit attempt: Esc+Enter sent')
        }
      }, 500))
      // Mostra bottone pulsante fallback per 30s
      setShowKickoffSubmitBtn(true)
      timers.push(window.setTimeout(() => setShowKickoffSubmitBtn(false), 30_000))
      toast.success('Brief caricato nel prompt', {
        description:
          'Tentativo auto-submit in corso. Se non parte, premi il bottone "▶ Invia brief" o Invio nel terminale.',
        duration: 6000,
      })
      // Consumo flag server-side (PATCH)
      api.projects
        .patch(projectId, { pendingKickoffText: null, pendingKickoffPath: null } as any)
        .catch((err) => console.warn('[EmbeddedChat] consume pendingKickoff failed:', err))
    }
  }, [status, promptReadyTick, projectQ.data, projectId, sendText])

  const info = infoQ.data
  const hasHistory = !!info?.canResume
  const lastUsed = info?.lastSession?.lastUsed
  const lastMsgs = info?.lastSession?.messages ?? 0

  // V14.1: input bar abilitato se status='ready' E il WS è effettivamente OPEN.
  // wsTick è incluso nella dependency virtuale per ri-renderizzare a onopen/onclose.
  const wsOpen = wsRef.current?.readyState === WebSocket.OPEN
  const inputDisabled = status !== 'ready' || !wsOpen
  void wsTick // forza il useMemo di disabled a re-leggere wsRef.current.readyState

  return (
    <div className={className}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/60 flex-wrap gap-2">
        <div className="flex items-center gap-2 text-xs min-w-0">
          {status === 'connecting' && (<><Loader2 className="w-3 h-3 animate-spin text-amber-400" /><span className="text-amber-400">Connecting...</span></>)}
          {status === 'ready' && !forceNew && hasHistory && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 cursor-help">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
                    <History className="w-3 h-3 text-purple-400" />
                    <span className="text-emerald-400">Ripresa conversazione</span>
                    {effectiveAccount && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-violet-500/40 text-violet-300">
                        {effectiveCli} · {effectiveAccount.label}
                      </Badge>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <div className="text-xs space-y-1">
                    <div className="font-semibold">🔒 Sessione isolata per questo progetto</div>
                    <div>Workspace: <code className="text-[10px]">{info?.workspace?.split(/[\\/]/).slice(-2).join('/')}</code></div>
                    {effectiveAccount && (
                      <div>Account: <code className="text-[10px]">{effectiveAccount.id}</code> ({effectiveAccount.providerId}/{effectiveAccount.mode})</div>
                    )}
                    {lastUsed && <div className="text-muted-foreground">Ultima: {new Date(lastUsed).toLocaleString('it-IT')} · {lastMsgs} messaggi</div>}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {status === 'ready' && (forceNew || !hasHistory) && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
              <Sparkles className="w-3 h-3 text-blue-400" />
              <span className="text-emerald-400">Nuova sessione</span>
              {effectiveAccount && (
                <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-violet-500/40 text-violet-300">
                  {effectiveCli} · {effectiveAccount.label}
                </Badge>
              )}
            </div>
          )}
          {status === 'error' && (<><XCircle className="w-3 h-3 text-red-400" /><span className="text-red-400 truncate">{errMsg}</span></>)}
          {status === 'closed' && (<><span className="w-2 h-2 rounded-full bg-slate-500" /><span className="text-muted-foreground">Chiuso</span></>)}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <code className="text-[10px] text-muted-foreground hidden sm:inline">{projectId}</code>
          {status === 'ready' && (() => {
            const proj = projectQ.data as any
            const kickoffText: string | undefined = proj?.pendingKickoffText
            const kickoffPath: string | undefined = proj?.pendingKickoffPath
            const payload = kickoffText || (kickoffPath ? `@${kickoffPath}` : null)
            if (!payload) return null
            return (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] gap-1 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200"
                onClick={() => {
                  sendText(payload)
                  toast.info('Brief caricato nel prompt', {
                    description: 'Premi Invio nel terminale per inviarlo all\'AI',
                    duration: 6000,
                  })
                  api.projects
                    .patch(projectId, { pendingKickoffText: null, pendingKickoffPath: null } as any)
                    .catch((err) => console.warn('[EmbeddedChat] consume pendingKickoff failed:', err))
                }}
                title="Carica il brief nel prompt del CLI. Dopo, premi Invio nel terminale per inviarlo. (Singolo Enter automatico non funziona perché il testo lungo attiva multiline mode nella TUI.)"
              >
                <FileText className="w-3 h-3" /> Carica brief
              </Button>
            )
          })()}
          {status === 'ready' && showKickoffSubmitBtn && (
            <Button
              size="sm"
              variant="default"
              className="h-7 text-[11px] gap-1 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold animate-pulse-ring rounded-md px-3"
              onClick={() => {
                const ws = wsRef.current
                if (!ws || ws.readyState !== WebSocket.OPEN) return
                // Multi-attempt submit: Esc+Enter (TUI multiline) → Ctrl+J (LF) → singolo Enter
                ws.send(JSON.stringify({ type: 'data', data: '\x1b\r' }))
                setTimeout(() => {
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'data', data: '\x0a' }))
                  }
                }, 120)
                setTimeout(() => {
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'data', data: '\r' }))
                  }
                }, 240)
                setShowKickoffSubmitBtn(false)
                toast.success('Invio brief al TUI', { duration: 2500 })
              }}
              title="Invia il brief già caricato — prova Esc+Enter, Ctrl+J e Invio in sequenza per gestire multiline mode."
            >
              <Send className="w-3.5 h-3.5" /> Invia brief
            </Button>
          )}
          {status === 'ready' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] gap-1 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10"
              onClick={() => sendText('/clear', true)}
              title="Invia /clear alla CLI — pulisce la conversazione visibile E resetta il contesto del modello (libera il context window). Stesso PTY, sessione mantenuta."
            >
              <Eraser className="w-3 h-3" /> Clear
            </Button>
          )}
          {((status === 'ready' && hasHistory && !forceNew) || status === 'closed' || status === 'error') && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
              onClick={startFresh}
              title={`Spawna una sessione PTY completamente nuova senza --continue (nuovo session-id ${effectiveCli}). La cronologia precedente resta archiviata in ~/.claude/projects/ ma non viene più ripresa al prossimo apri.`}
            >
              <RotateCcw className="w-3 h-3" /> Nuova
            </Button>
          )}
          {(status === 'error' || status === 'closed') && (
            <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10" onClick={reconnect}>
              <RefreshCw className="w-3 h-3" /> Riconnetti
            </Button>
          )}
        </div>
      </div>

      {/* xterm display (read-focused) + screensaver overlay quando sessione closed */}
      <div className="relative w-full" style={{ height: '420px' }}>
        <div
          ref={containerRef}
          className="w-full h-full bg-[#0a0a0a]"
        />
        {status === 'closed' && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]/97 overflow-hidden pointer-events-none">
            {/* Bouncing ball pong-style — animazioni CSS pure, ~0% CPU */}
            <div
              className="absolute w-3 h-3 rounded-full bg-emerald-400/80 shadow-[0_0_20px_rgba(16,185,129,0.7)]"
              style={{ animation: 'saio-pong-x 5.3s ease-in-out infinite, saio-pong-y 3.7s ease-in-out infinite' }}
            />
            {/* Trail (palla secondaria viola) per effetto pong/lissajous */}
            <div
              className="absolute w-2 h-2 rounded-full bg-violet-400/60 shadow-[0_0_15px_rgba(139,92,246,0.6)]"
              style={{ animation: 'saio-pong-x2 6.1s ease-in-out infinite, saio-pong-y2 4.3s ease-in-out infinite' }}
            />
            {/* Paddle laterali fissi */}
            <div className="absolute left-2 top-1/2 -translate-y-1/2 w-1 h-12 rounded-full bg-emerald-500/30" />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 w-1 h-12 rounded-full bg-violet-500/30" />

            {/* Testo CTA centrato */}
            <div className="relative z-10 text-center pointer-events-auto px-6">
              <div className="text-emerald-400/80 text-xs font-mono tracking-[0.25em] mb-3 animate-pulse">
                ▒▒  SESSIONE TERMINATA  ▒▒
              </div>
              <div className="text-[11px] text-muted-foreground leading-relaxed">
                Clicca <span className="text-violet-300 font-medium">Riconnetti</span> per ripartire dalla cronologia precedente
                <br />
                oppure <span className="text-foreground font-medium">Nuova</span> per ricominciare da zero
              </div>
            </div>
          </div>
        )}
        <style>{`
          @keyframes saio-pong-x {
            0%, 100% { left: 4%; }
            50% { left: 94%; }
          }
          @keyframes saio-pong-y {
            0%, 100% { top: 8%; }
            50% { top: 86%; }
          }
          @keyframes saio-pong-x2 {
            0%, 100% { left: 92%; }
            50% { left: 6%; }
          }
          @keyframes saio-pong-y2 {
            0%, 100% { top: 80%; }
            50% { top: 12%; }
          }
          @keyframes pulse-ring {
            0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.7); }
            50% { box-shadow: 0 0 0 10px rgba(16,185,129,0); }
          }
          .animate-pulse-ring { animation: pulse-ring 1.6s ease-out infinite; }
        `}</style>
      </div>

      {/* Chat input bar + settings + quick choices */}
      <ChatInputBar
        onSend={(t) => sendText(t, true)}
        onQuickChoice={sendChoice}
        pendingChoices={pendingChoices}
        disabled={inputDisabled}
        model={model}
        permissionMode={permissionMode}
        onModelChange={setModel}
        onPermissionModeChange={setPermissionMode}
        onSettingsApply={applySettings}
        settingsDirty={settingsDirty}
        providerName={effectiveCli}
      />

      {/* V14.23 — Dialog SAIO-style per "Nuova conversazione" (rimpiazzo confirm() nativo) */}
      <Dialog open={freshConfirmOpen} onOpenChange={setFreshConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-violet-400" />
              Nuova conversazione da zero?
            </DialogTitle>
            <DialogDescription>
              Verrà spawnata una sessione PTY completamente nuova senza <code className="text-[11px] bg-muted px-1 rounded">--continue</code>.
              La sessione precedente rimane salvata in <code className="text-[11px] bg-muted px-1 rounded">~/.claude/projects/</code> ma
              non verrà ripresa al prossimo apri.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFreshConfirmOpen(false)}>
              Annulla
            </Button>
            <Button onClick={confirmStartFresh} className="gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" />
              Inizia da zero
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
