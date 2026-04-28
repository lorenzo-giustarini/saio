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

// V15.9 WS39 M2 SMOKE TEST: sidecar Express disabilitato finché non bundlerò
// il binary saio-server con esbuild (Microtask 9). Per ora la app apre la
// finestra e l'utente lancia manualmente `npm run dev:server` in altra shell.
// Quando attivo sidecar: ripristina blocchi commentati sotto.

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
        .setup(|_app| {
            // TODO M11 — re-enable sidecar:
            // use tauri::Manager;
            // use tauri_plugin_shell::ShellExt;
            // let sidecar = _app.shell().sidecar("saio-server")?;
            // let (mut rx, child) = sidecar.spawn()?;
            // tauri::async_runtime::spawn(async move {
            //     while let Some(event) = rx.recv().await {
            //         use tauri_plugin_shell::process::CommandEvent;
            //         match event {
            //             CommandEvent::Stdout(l) => log::info!("[sidecar] {}", String::from_utf8_lossy(&l)),
            //             CommandEvent::Stderr(l) => log::warn!("[sidecar] {}", String::from_utf8_lossy(&l)),
            //             CommandEvent::Terminated(p) => { log::warn!("[sidecar] terminated: {:?}", p); break; }
            //             _ => {}
            //         }
            //     }
            // });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
