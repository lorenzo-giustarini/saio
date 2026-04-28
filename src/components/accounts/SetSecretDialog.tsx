import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Key, Loader2, CheckCircle2 } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from 'sonner'

interface Props {
  open: boolean
  onClose: () => void
  accountId: string
  accountLabel: string
  envVarRef: string
}

export function SetSecretDialog({ open, onClose, accountId, accountLabel, envVarRef }: Props) {
  const [value, setValue] = useState('')
  const queryClient = useQueryClient()

  const mut = useMutation({
    mutationFn: () => api.accounts.setSecret(accountId, value),
    onSuccess: () => {
      toast.success('API key salvata', {
        description: 'Salvata in ~/.claude/settings.json + health check aggiornato',
      })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['accounts-health'] })
      setValue('')
      onClose()
    },
    onError: (err) => toast.error('Errore salvataggio', { description: String(err) }),
  })

  const handleClose = () => {
    if (!mut.isPending) {
      setValue('')
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="w-5 h-5 text-blue-400" />
            Inserisci API key per {accountLabel}
          </DialogTitle>
          <DialogDescription>
            Salva in <code className="bg-muted px-1 rounded text-xs">~/.claude/settings.json</code> sotto{' '}
            <code className="bg-muted px-1 rounded text-xs">env.{envVarRef}</code>. Non verrà mai
            loggata in chiaro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Label className="text-xs">Chiave API</Label>
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sk-..."
            autoComplete="off"
            autoFocus
            maxLength={10000}
          />
          <p className="text-[10px] text-muted-foreground">
            La chiave sarà disponibile immediatamente per nuove sessioni. Il file viene permesso 0600
            (solo tu puoi leggerlo) su Unix. Su Windows dipende da ACL user.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleClose} disabled={mut.isPending}>
            Annulla
          </Button>
          <Button
            size="sm"
            onClick={() => mut.mutate()}
            disabled={!value.trim() || mut.isPending}
            className="gap-1.5"
          >
            {mut.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvo...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" /> Salva
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
