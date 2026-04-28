// SAIO Tauri 2 library (V15.9 WS39 + WS42 M11)
//
// Entry point: lib.rs -> run()
// Spawns the Express backend as a sidecar child process at startup, then
// opens the webview that loads the frontend (dev: Vite localhost; release:
// the static bundle in dist/).
//
// Sidecar pattern (Tauri 2):
//   - In dev: developer runs `npm run dev:server` in a separate terminal.
//     The Tauri app skips the spawn (gated on tauri::is_dev()).
//   - In release: Tauri ships `binaries/node-<target>` as externalBin and
//     `binaries/saio-server.cjs` as a bundle resource. lib.rs spawns
//     `node saio-server.cjs` via tauri-plugin-shell.
//
// The frontend points at http://127.0.0.1:3031 for the Express API.

use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

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
        .setup(|app| {
            // V15.9 WS42 M11 — spawn Express sidecar in release mode.
            // In dev mode the developer runs `npm run dev:server` separately,
            // so we skip the spawn to avoid port conflicts on 3031.
            if !cfg!(debug_assertions) {
                let resource_dir = app
                    .path()
                    .resource_dir()
                    .expect("failed to resolve resource_dir");
                // bundle.resources preserves the relative subpath, so the cjs
                // ends up at <resource_dir>/binaries/saio-server.cjs
                let bundle_path = resource_dir.join("binaries").join("saio-server.cjs");
                let bundle_str = bundle_path
                    .to_str()
                    .expect("bundle path contains invalid UTF-8")
                    .to_string();

                log::info!("[sidecar] starting node {bundle_str}");

                let sidecar = app
                    .shell()
                    .sidecar("node")
                    .expect("failed to acquire node sidecar")
                    .args([&bundle_str]);

                let (mut rx, _child) = sidecar.spawn().expect("failed to spawn sidecar");

                tauri::async_runtime::spawn(async move {
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                log::info!("[sidecar] {}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Stderr(line) => {
                                log::warn!("[sidecar] {}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Terminated(payload) => {
                                log::warn!(
                                    "[sidecar] terminated code={:?} signal={:?}",
                                    payload.code,
                                    payload.signal
                                );
                                break;
                            }
                            _ => {}
                        }
                    }
                });
            } else {
                log::info!("[sidecar] dev mode — skipping (run `npm run dev:server` separately)");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
