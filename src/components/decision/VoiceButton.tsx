import { useEffect, useState } from 'react'
import { Mic, MicOff, AlertCircle, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useVoiceInput } from '@/hooks/useVoiceInput'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface VoiceButtonProps {
  onTranscript: (text: string) => void
  disabled?: boolean
  initial?: string
  size?: 'sm' | 'default'
}

export function VoiceButton({ onTranscript, disabled, initial = '', size = 'sm' }: VoiceButtonProps) {
  const [showError, setShowError] = useState(false)
  const { isSupported, isListening, interim, start, stop, reset, error } = useVoiceInput({
    lang: 'it-IT',
    onResult: (text) => {
      const combined = initial ? `${initial} ${text}`.trim() : text
      onTranscript(combined)
    },
  })

  useEffect(() => {
    if (error) {
      setShowError(true)
      const msg =
        error === 'mic-permission-denied'
          ? 'Permesso microfono negato. Abilitalo dalle impostazioni del browser (lucchetto in alto a sinistra → Microfono → Consenti).'
          : error === 'no-microphone'
          ? 'Nessun microfono rilevato sul dispositivo.'
          : error === 'not-allowed'
          ? 'Permesso microfono negato. Riprova e conferma nel popup del browser.'
          : error === 'no-speech'
          ? 'Nessuna voce rilevata. Parla più vicino al microfono.'
          : error === 'aborted'
          ? null
          : `Errore dettatura: ${error}`
      if (msg) {
        toast.error('Dettatura vocale', { description: msg, duration: 6000 })
      }
    }
  }, [error])

  // Clean on unmount
  useEffect(() => () => stop(), [stop])

  if (!isSupported) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size={size === 'sm' ? 'icon' : 'default'} disabled className="opacity-50">
              <MicOff className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="text-xs max-w-[220px] inline-block">
              Dettatura non supportata su questo browser. Usa Chrome o Edge per dettare in italiano.
            </span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  const hasError = showError && error && error !== 'aborted'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={isListening ? 'default' : 'ghost'}
            size={size === 'sm' ? 'icon' : 'default'}
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault()
              if (isListening) {
                stop()
              } else {
                reset()
                setShowError(false)
                start()
              }
            }}
            className={cn(
              'transition-all relative',
              isListening &&
                'bg-red-500 hover:bg-red-600 text-white animate-pulse-soft shadow-lg shadow-red-500/50',
              hasError && 'border-amber-500/50'
            )}
          >
            {hasError ? (
              <AlertCircle className="w-4 h-4 text-amber-500" />
            ) : isListening ? (
              <Square className="w-4 h-4 fill-current" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
            {isListening && (
              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px]">
          <div className="text-xs space-y-1">
            {hasError ? (
              <div className="text-amber-400">
                {error === 'mic-permission-denied' || error === 'not-allowed'
                  ? 'Permesso microfono negato. Clicca sul lucchetto accanto all\'URL → Microfono → Consenti.'
                  : error === 'no-microphone'
                  ? 'Nessun microfono rilevato.'
                  : `Errore: ${error}`}
              </div>
            ) : isListening ? (
              <div>
                <div className="text-red-300 font-semibold">🔴 Sto ascoltando...</div>
                <div>Clicca per fermare</div>
                {interim && <div className="italic opacity-80 mt-1">"{interim}"</div>}
              </div>
            ) : (
              <div>
                <div className="font-semibold">Dettatura vocale (IT)</div>
                <div className="text-muted-foreground">Serve Chrome o Edge con permesso microfono</div>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
