use rmodbus::server::context::ModbusContext;
use tauri::State;
use tokio_serial::available_ports;

use crate::models::{DataRangeRequest, DataValues, ServerConfig, ServerStatus, SingleValue};
use crate::modbus::{
    start_server_instance as start_modbus_instance,
    stop_server_instance as stop_modbus_instance,
    AppState, get_instance_context, get_instance_status as modbus_get_instance_status,
    list_servers,
};

#[tauri::command]
pub async fn get_serial_ports() -> Result<Vec<String>, String> {
    match available_ports() {
        Ok(ports) => Ok(ports.into_iter().map(|p| p.port_name).collect()),
        Err(e) => Err(format!("Failed to list serial ports: {}", e)),
    }
}

#[tauri::command]
pub async fn get_instance_data(
    state: State<'_, AppState>,
    id: String,
    request: DataRangeRequest,
) -> Result<DataValues, String> {
    let ctx = get_instance_context(&state, id.clone())
        .await
        .ok_or_else(|| format!("Instance {} not found", id))?;
    let ctx = ctx.read().await;
    let start = request.start as usize;
    let count = request.count as usize;

    let values: Vec<u16> = match request.kind.as_str() {
        "coil" => (start..start + count)
            .map(|i| ctx.get_coil(i as u16).unwrap_or(false) as u16)
            .collect(),
        "discrete" => (start..start + count)
            .map(|i| ctx.get_discrete(i as u16).unwrap_or(false) as u16)
            .collect(),
        "input" => (start..start + count)
            .map(|i| ctx.get_input(i as u16).unwrap_or(0))
            .collect(),
        "holding" => (start..start + count)
            .map(|i| ctx.get_holding(i as u16).unwrap_or(0))
            .collect(),
        _ => return Err(format!("Unknown data kind: {}", request.kind)),
    };

    Ok(DataValues {
        kind: request.kind,
        start: request.start,
        values,
    })
}

#[tauri::command]
pub async fn set_instance_value(
    state: State<'_, AppState>,
    id: String,
    value: SingleValue,
) -> Result<(), String> {
    let ctx = get_instance_context(&state, id.clone())
        .await
        .ok_or_else(|| format!("Instance {} not found", id))?;
    let mut ctx = ctx.write().await;
    let addr = value.address;

    match value.kind.as_str() {
        "coil" => ctx.set_coil(addr, value.value != 0).map_err(|e| format!("{:?}", e)),
        "discrete" => ctx.set_discrete(addr, value.value != 0).map_err(|e| format!("{:?}", e)),
        "input" => ctx.set_input(addr, value.value).map_err(|e| format!("{:?}", e)),
        "holding" => ctx.set_holding(addr, value.value).map_err(|e| format!("{:?}", e)),
        _ => Err(format!("Unknown data kind: {}", value.kind)),
    }
}

#[tauri::command]
pub async fn start_server_instance(
    state: State<'_, AppState>,
    config: ServerConfig,
) -> Result<ServerStatus, String> {
    start_modbus_instance(&state, config).await
}

#[tauri::command]
pub async fn stop_server_instance(
    state: State<'_, AppState>,
    id: String,
) -> Result<ServerStatus, String> {
    stop_modbus_instance(&state, id).await
}

#[tauri::command]
pub async fn list_servers_cmd(state: State<'_, AppState>) -> Result<Vec<ServerStatus>, String> {
    Ok(list_servers(&state).await)
}

#[tauri::command]
pub async fn get_instance_status(
    state: State<'_, AppState>,
    id: String,
) -> Result<ServerStatus, String> {
    Ok(modbus_get_instance_status(&state, id).await)
}
