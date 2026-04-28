// SAIO Tauri 2 library (V15.9 WS39)
//
// Entry point: lib.rs -> run()
// Avvia un sidecar process Express (server/index.ts compilato) all'avvio,
// poi apre la webview che carica il frontend (dev: Vite localhost; release:
// bundle statico).
//
// Pattern Sidecar (Tauri 2):
// - In dev: Tauri lancia `node server/index.ts` come child process detached
// - In release: Tauri bundla `saio-server-{platform}` binary precompilato
//   con esbuild + node-portable e lo spawna via tauri-plugin-shell sidecar API
//
// Il frontend Vite/React punta a http://127.0.0.1:3031 per le API Express
// (proxy gestisce). In release Tauri serve frontend da bundle statico interno
// e Express ascolta su porta random per evitare collisioni.

use tauri::Manager;
use std::sync::Mutex;
use tauri_plugin_shell::ShellExt;

struct SidecarChild(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(SidecarChild(Mutex::new(None)))
        .setup(|app| {
            // Avvia il sidecar Express (saio-server)
            let sidecar_command = app
                .shell()
                .sidecar("saio-server")
                .expect("failed to create sidecar command");
            let (mut rx, child) = sidecar_command
                .spawn()
                .expect("failed to spawn sidecar");
            // Salva handle per cleanup al window close
            let state = app.state::<SidecarChild>();
            *state.0.lock().unwrap() = Some(child);

            // Forward sidecar stdout/stderr al log Tauri
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            log::info!("[sidecar] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            log::warn!("[sidecar] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Error(err) => {
                            log::error!("[sidecar] error: {}", err);
                        }
                        CommandEvent::Terminated(payload) => {
                            log::warn!("[sidecar] terminated: {:?}", payload);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Cleanup sidecar al close della finestra principale
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<SidecarChild>() {
                    if let Some(child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
