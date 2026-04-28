// SAIO Tauri 2 main entry (V15.9 WS39)
// Prevents an additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    saio_lib::run()
}
