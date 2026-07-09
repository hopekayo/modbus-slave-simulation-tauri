use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialConfig {
    pub port: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub parity: String,
    pub stop_bits: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub id: String,
    pub mode: String, // "rtu", "ascii", "tcp", "udp"
    pub unit_id: u8,
    pub serial: Option<SerialConfig>,
    pub network: Option<NetworkConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataRangeRequest {
    pub kind: String, // "coil", "discrete", "input", "holding"
    pub start: u16,
    pub count: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataValues {
    pub kind: String,
    pub start: u16,
    pub values: Vec<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SingleValue {
    pub kind: String,
    pub address: u16,
    pub value: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerStatus {
    pub id: String,
    pub running: bool,
    pub mode: String,
    pub details: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogEvent {
    pub server_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatusEvent {
    pub server_id: String,
    pub message: String,
}
