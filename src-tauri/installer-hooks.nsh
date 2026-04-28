; V15.9 WS39 — NSIS installer hooks per SAIO Tauri (Windows)
;
; Tauri 2 invoca queste macro durante install/uninstall NSIS:
;   NSIS_HOOK_PREINSTALL    — prima di copiare i file
;   NSIS_HOOK_POSTINSTALL   — dopo aver copiato i file (in elevated context)
;   NSIS_HOOK_PREUNINSTALL  — prima di rimuovere i file
;   NSIS_HOOK_POSTUNINSTALL — dopo aver rimosso i file
;
; Scope: registra automaticamente il task scheduler `RM-Saio-Tauri-Elevator`
; durante installation per abilitare zero-UAC cron toggle. L'installer NSIS
; gira già in elevated context (richiede admin per perMachine install) quindi
; la registrazione del task NON aggiunge popup UAC extra: l'utente vede SOLO
; il prompt admin standard di NSIS.

!macro NSIS_HOOK_POSTINSTALL
    DetailPrint "Registering RM-Saio-Tauri-Elevator task scheduler..."

    ; Lo script register-elevator.ps1 viene incluso in $INSTDIR\resources\
    ; via bundle.resources nel tauri.conf.json
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\scripts\register-elevator.ps1"'
    Pop $0  ; exit code

    ${If} $0 == 0
        DetailPrint "Elevator task registered successfully (zero-UAC cron toggle enabled)."
    ${Else}
        DetailPrint "WARNING: elevator task registration failed (exit $0). Cron toggle will require UAC popup. Run scripts\register-elevator.ps1 manually as admin to fix."
    ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
    DetailPrint "Removing RM-Saio-Tauri-Elevator task scheduler..."
    nsExec::ExecToLog 'schtasks.exe /delete /tn "RM-Saio-Tauri-Elevator" /f'
    Pop $0
    ; Cleanup best-effort: ignoriamo l'exit code (potrebbe non esistere se utente
    ; aveva eliminato il task manualmente o se non era mai stato registrato)
    DetailPrint "Elevator task cleanup done (exit $0)."
!macroend
