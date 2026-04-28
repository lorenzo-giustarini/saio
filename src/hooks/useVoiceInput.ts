import { useCallback, useEffect, useRef, useState } from 'react'

interface UseVoiceInputOptions {
  lang?: string
  continuous?: boolean
  interimResults?: boolean
  onResult?: (transcript: string, isFinal: boolean) => void
}

interface UseVoiceInputReturn {
  isSupported: boolean
  isListening: boolean
  transcript: string
  interim: string
  start: () => void
  stop: () => void
  reset: () => void
  error: string | null
}

export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const {
    lang = 'it-IT',
    continuous = true,
    interimResults = true,
    onResult,
  } = options

  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<any>(null)
  const finalRef = useRef<string>('')
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isSupported = typeof window !== 'undefined' && (
    'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  )

  useEffect(() => {
    if (!isSupported) return
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const rec = new SR()
    rec.continuous = continuous
    rec.interimResults = interimResults
    rec.lang = lang
    rec.maxAlternatives = 1

    rec.onstart = () => {
      setIsListening(true)
      setError(null)
    }
    rec.onend = () => {
      setIsListening(false)
    }
    rec.onerror = (e: any) => {
      setError(e.error || 'speech-recognition-error')
      setIsListening(false)
    }
    rec.onresult = (event: any) => {
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          const text = result[0].transcript
          finalRef.current += (finalRef.current ? ' ' : '') + text.trim()
          setTranscript(finalRef.current)
          onResult?.(finalRef.current, true)
        } else {
          interimText += result[0].transcript
        }
      }
      setInterim(interimText)
      if (interimText) onResult?.(finalRef.current + ' ' + interimText, false)
      // Auto-stop after 3s of silence
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = setTimeout(() => {
        try { rec.stop() } catch {}
      }, 3000)
    }

    recognitionRef.current = rec
    return () => {
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
      recognitionRef.current = null
    }
  }, [isSupported, lang, continuous, interimResults, onResult])

  const start = useCallback(async () => {
    if (!recognitionRef.current) return
    setError(null)
    // Pre-check microphone permission (triggers browser prompt if not granted)
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        // Stop immediately — we just needed the permission
        stream.getTracks().forEach((t) => t.stop())
      }
    } catch (err: any) {
      const name = err?.name || 'UnknownError'
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('mic-permission-denied')
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('no-microphone')
      } else {
        setError(`mic-${name}`)
      }
      return
    }
    try {
      recognitionRef.current.start()
    } catch (e: any) {
      const msg = e?.message || String(e)
      if (msg.includes('already started')) {
        // Already running — ignore
        return
      }
      setError(msg)
    }
  }, [])

  const stop = useCallback(() => {
    if (!recognitionRef.current) return
    try {
      recognitionRef.current.stop()
    } catch {
      /* ignore */
    }
    // Force UI state update in case onend is delayed
    setIsListening(false)
  }, [])

  const reset = useCallback(() => {
    finalRef.current = ''
    setTranscript('')
    setInterim('')
    setError(null)
  }, [])

  return { isSupported, isListening, transcript, interim, start, stop, reset, error }
}
