/**
 * V15.0 WS10 + WS19 — Banner che avvisa di dipendenze runtime mancanti.
 *
 * Auto-mount in Layout quando l'utente è loggato. Si chiude con dismiss che
 * persiste in localStorage (re-appare al prossimo mount se manca ancora qualcosa).
 *
 * WS19: bottone "Installa Python deps" che chiama POST /api/system/install-python-deps
 * e mostra streaming output. Refresh dello stato deps al termine.
 */
import { useEffect, useRef, useState } from 'react'
import { AlertCircle, X, Copy, ExternalLink, CheckCircle2, Loader2, Terminal } from 'lucide-react'
import { useDepsCheck, DEPS_CHECK_KEY } from '@/hooks/useDepsCheck'
import { Button } from '@/components/ui/button'
import { useQueryClient } from '@tanstack/react-query'

const DISMISS_KEY = 'saio-deps-banner-dismissed'

export function DepsCheckBanner() {
  const { data, isLoading } = useDepsCheck()
  const queryClient = useQueryClient()
  const [dismissed, setDismissed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installLog, setInstallLog] = useState<string>('')
  const [installResult, setInstallResult] = useState<'success' | 'failed' | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === 'true')
    } catch {
      /* ignore */
    }
  }, [])

  // Auto-scroll log al fondo
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [installLog])

  if (isLoading || !data || dismissed) return null

  // WS19: mostra banner anche se solo CORE deps mancanti (es. pythonDeps)
  // se almeno una CRITICAL o pythonDeps mancante
  const pythonDepsMissing = data.deps.pythonDeps && !data.deps.pythonDeps.found
  if (data.allCriticalOk && !pythonDepsMissing) return null

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, 'true')
    } catch {
      /* ignore */
    }
  }

  async function copyCmd(cmd: string) {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(cmd)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      /* ignore */
    }
  }

  async function installPythonDeps() {
    if (installing) return
    setInstalling(true)
    setInstallLog('Avvio installazione Python deps...\n')
    setInstallResult(null)
    setExpanded(true)

    try {
      const res = await fetch('/api/system/install-python-deps', {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        if (res.status === 409) {
          setInstallLog((l) => l + '\nERRORE: installazione già in corso (un altro tab?)\n')
        } else {
          setInstallLog((l) => l + `\nERRORE HTTP ${res.status}\n`)
        }
        setInstallResult('failed')
        return
      }

      // Stream lettura body chunked
      const reader = res.body?.getReader()
      if (!reader) {
        setInstallLog((l) => l + '\nStream non supportato dal browser\n')
        setInstallResult('failed')
        return
      }
      const decoder = new TextDecoder()
      let success = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        setInstallLog((l) => l + chunk)
        if (chunk.includes('INSTALLAZIONE COMPLETATA')) {
          success = true
        }
      }
      setInstallResult(success ? 'success' : 'failed')

      // Refresh deps-check
      await queryClient.invalidateQueries({ queryKey: DEPS_CHECK_KEY })
    } catch (err) {
      setInstallLog((l) => l + `\nERRORE fetch: ${(err as Error).message}\n`)
      setInstallResult('failed')
    } finally {
      setInstalling(false)
    }
  }

  const missing = data.missingCritical
  const optionalMissing = Object.entries(data.deps).filter(
    ([, v]) => !v.found && v.category !== 'CRITICAL'
  )

  // WS19: Il bottone "install Python deps" appare se pythonDeps è mancante
  const canInstallPythonDeps = pythonDepsMissing && !installing && installResult !== 'success'

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-3">
      <div className="max-w-6xl mx-auto flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-amber-200">
              {missing.length > 0
                ? 'Dipendenze runtime mancanti — alcune feature non funzioneranno'
                : 'Dipendenze Python orchestrator mancanti'}
            </h3>
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="text-xs text-amber-300 underline ml-2"
            >
              {expanded ? 'Nascondi' : 'Vedi dettagli'}
            </button>
          </div>
          <p className="text-xs text-amber-200/80">
            {missing.length > 0 && (
              <>
                CRITICAL mancanti: <span className="font-medium">{missing.join(', ')}</span>. Installa
                con il comando indicato sotto.{' '}
              </>
            )}
            {pythonDepsMissing && missing.length === 0 && (
              <>
                Python deps orchestrator non importabili: <span className="font-medium">{data.deps.pythonDeps?.version}</span>.{' '}
                Se hai già Python globalmente con tutti i moduli, dismissa questo banner; oppure crea
                venv isolato col bottone qui sotto.{' '}
              </>
            )}
            {missing.length > 0 && (
              <>
                Per CRITICAL usa terminale:{' '}
                <code className="bg-amber-500/20 px-1.5 py-0.5 rounded text-xs ml-1">
                  npm run setup:deps
                </code>
              </>
            )}
          </p>

          {/* WS19: Install button per Python deps */}
          {canInstallPythonDeps && (
            <div className="mt-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={installPythonDeps}
                disabled={installing}
                className="bg-amber-500 hover:bg-amber-600 text-amber-950"
              >
                {installing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Installazione in corso...
                  </>
                ) : (
                  <>
                    <Terminal className="w-3.5 h-3.5 mr-1.5" />
                    Installa Python deps automaticamente
                  </>
                )}
              </Button>
              <p className="text-[10px] text-amber-300/70 mt-1">
                Crea venv in <code>orchestrator/.venv</code> e installa{' '}
                <code>psutil + watchdog{platform() === 'win32' ? ' + pywinpty' : ''}</code>. Richiede ~30-60s.
              </p>
            </div>
          )}

          {/* WS19: Streaming log durante install */}
          {(installing || installLog) && (
            <div className="mt-3 pt-2 border-t border-amber-500/20">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-amber-200/80 font-medium">
                  Log installazione
                  {installResult === 'success' && (
                    <span className="ml-2 text-green-400">✓ Completato</span>
                  )}
                  {installResult === 'failed' && (
                    <span className="ml-2 text-red-400">✗ Fallito</span>
                  )}
                </span>
              </div>
              <pre
                ref={logRef}
                className="text-[10px] bg-black/60 text-amber-100 p-2 rounded overflow-y-auto max-h-48 font-mono whitespace-pre-wrap"
              >
                {installLog || 'Avvio...'}
              </pre>
              {installResult === 'success' && (
                <p className="text-[11px] text-green-300 mt-1.5">
                  ✓ Riavvia il backend (Ctrl+C nel terminale + <code>npm run dev:all</code>) per
                  applicare il nuovo venv.
                </p>
              )}
            </div>
          )}

          {expanded && !installing && !installLog && (
            <div className="mt-3 space-y-2 pt-2 border-t border-amber-500/20">
              {Object.entries(data.deps)
                .filter(([, v]) => !v.found)
                .map(([name, status]) => (
                  <div key={name} className="text-xs flex items-start gap-2">
                    <span className="text-amber-400 font-mono">×</span>
                    <div className="flex-1">
                      <div className="font-medium text-amber-100">
                        {name}{' '}
                        <span className="text-[10px] uppercase text-amber-400/70 ml-1">
                          {status.category}
                        </span>
                      </div>
                      {status.version && (
                        <div className="text-[10px] text-amber-300/70">{status.version}</div>
                      )}
                      {status.installCommand && (
                        <div className="flex items-center gap-2 mt-1">
                          <code className="bg-black/30 px-2 py-0.5 rounded text-amber-100 font-mono">
                            {status.installCommand}
                          </code>
                          <button
                            type="button"
                            onClick={() => copyCmd(status.installCommand!)}
                            className="text-amber-300 hover:text-amber-100"
                            title="Copia"
                          >
                            {copied === status.installCommand ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      )}
                      {status.installLink && (
                        <a
                          href={status.installLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-amber-300 hover:text-amber-100 underline inline-flex items-center gap-1 mt-1"
                        >
                          {status.installLink}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              {optionalMissing.length > 0 && (
                <div className="text-[11px] text-amber-300/60 mt-2">
                  Anche queste opzionali sono mancanti (non bloccanti):{' '}
                  {optionalMissing.map(([n]) => n).join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={dismiss}
          className="shrink-0 text-amber-300 hover:text-amber-100"
          title="Nascondi banner (riapparirà solo se manca ancora qualcosa al prossimo refresh)"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}

// platform() helper per il rendering condizionale (no API node 'os' nel browser)
function platform(): string {
  // navigator.platform è deprecato ma OK come euristica per UI hint
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')) {
    return 'win32'
  }
  return 'posix'
}
