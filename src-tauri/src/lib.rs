mod commands;
mod models;
mod modbus;

use std::collections::HashMap;

use tauri::Manager;
use tokio::sync::Mutex;

use crate::modbus::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            servers: Mutex::new(HashMap::new()),
            app_handle: Mutex::new(None),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Some(state) = handle.try_state::<AppState>() {
                    let mut app_handle = state.app_handle.lock().await;
                    *app_handle = Some(handle.clone());
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_serial_ports,
            commands::get_instance_data,
            commands::set_instance_value,
            commands::start_server_instance,
            commands::stop_server_instance,
            commands::list_servers_cmd,
            commands::get_instance_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
