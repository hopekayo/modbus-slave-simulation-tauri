mod commands;
mod models;
mod modbus;

use std::sync::LazyLock;

use rmodbus::server::storage::ModbusStorage;
use tauri::Manager;
use tokio::sync::{Mutex, RwLock};

use crate::modbus::{AppState, ModbusDataStore};

static MODBUS_CONTEXT: LazyLock<RwLock<Box<ModbusDataStore>>> =
    LazyLock::new(|| RwLock::new(Box::new(ModbusStorage::default())));

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            context: &MODBUS_CONTEXT,
            handle: Mutex::new(None),
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
            commands::get_data_range,
            commands::set_value,
            commands::start_server,
            commands::stop_server_cmd,
            commands::get_server_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
