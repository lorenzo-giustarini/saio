/**
 * V15.0 WS22 — Hook monitoring CPU sostenuto.
 *
 * Polling /api/perf/snapshot ogni 2s. Mantiene rolling window 12s di campioni.
 * Se per >= 5 campioni consecutivi (= 10s) il totalCpuPercent supera la soglia
 * (default 100%, configurabile via env VITE_SAIO_PERF_THRESHOLD), setta
 * `highLoad: true` → componente PerfAlert mostra banner + audio.
 *
 * Reset: quando torna sotto soglia per >= 3 campioni (= 6s) consecutivi.
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

export interface PerfProcess {
  pid: number
  name?: string
  cpu?: number
  mem_mb?: number
  status?: string
  parent?: number
  error?: string
}

export interface PerfSnapshot {
  totalCpuPercent: number
  cpuCount?: number
  processes: PerfProcess[]
  error?: string
}

const THRESHOLD = Number((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SAIO_PERF_THRESHOLD ?? 100)
const POLL_MS = 2_000
const HISTORY_MS = 12_000
const HIGH_LOAD_SAMPLES = 5 // 5 × 2s = 10s
const RECOVERY_SAMPLES = 3 // 3 × 2s = 6s

export function usePerfMonitor(enabled = true) {
  const { data } = useQuery({
    queryKey: ['perf', 'snapshot'],
    queryFn: async (): Promise<PerfSnapshot> => {
      const r = await fetch('/api/perf/snapshot', { credentials: 'include' })
      if (!r.ok) return { totalCpuPercent: 0, processes: [] }
      return r.json()
    },
    refetchInterval: enabled ? POLL_MS : false,
    staleTime: 1_000,
    enabled,
  })

  const historyRef = useRef<Array<{ ts: number; cpu: number }>>([])
  const [highLoad, setHighLoad] = useState(false)

  useEffect(() => {
    if (!data) return
    const now = Date.now()
    historyRef.current.push({ ts: now, cpu: data.totalCpuPercent })
    historyRef.current = historyRef.current.filter((e) => now - e.ts < HISTORY_MS)

    // Verifica trigger high-load: ultimi N samples tutti sopra soglia
    const recent = historyRef.current.slice(-HIGH_LOAD_SAMPLES)
    const triggerHigh = recent.length >= HIGH_LOAD_SAMPLES && recent.every((e) => e.cpu > THRESHOLD)

    // Verifica recovery: ultimi M samples tutti sotto soglia
    const recoverWindow = historyRef.current.slice(-RECOVERY_SAMPLES)
    const triggerRecover =
      recoverWindow.length >= RECOVERY_SAMPLES && recoverWindow.every((e) => e.cpu <= THRESHOLD)

    if (triggerHigh && !highLoad) setHighLoad(true)
    else if (triggerRecover && highLoad) setHighLoad(false)
  }, [data, highLoad])

  return {
    totalCpu: data?.totalCpuPercent ?? 0,
    processes: data?.processes ?? [],
    cpuCount: data?.cpuCount ?? 1,
    highLoad,
    threshold: THRESHOLD,
  }
}
