use std::collections::HashMap;
use std::sync::Arc;

use rmodbus::{
    generate_ascii_frame, guess_request_frame_len, parse_ascii_frame,
    server::{storage::ModbusStorage, ModbusFrame},
    ModbusFrameBuf, ModbusProto,
};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, UdpSocket};
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;

use crate::models::{LogEvent, SerialConfig, ServerConfig, ServerStatus, StatusEvent};

pub const MAX_REG: usize = 65_535;
pub type ModbusDataStore = ModbusStorage<MAX_REG, MAX_REG, MAX_REG, MAX_REG>;

pub struct ServerInstance {
    pub handle: ServerHandle,
    pub context: Arc<RwLock<Box<ModbusDataStore>>>,
    pub config: ServerConfig,
}

pub struct AppState {
    pub servers: Mutex<HashMap<String, ServerInstance>>,
    pub app_handle: Mutex<Option<AppHandle>>,
}

pub struct ServerHandle {
    pub task: tokio::task::JoinHandle<()>,
    pub cancel: CancellationToken,
}

fn modbus_proto_from_mode(mode: &str) -> Option<ModbusProto> {
    match mode {
        "tcp" | "udp" => Some(ModbusProto::TcpUdp),
        "rtu" => Some(ModbusProto::Rtu),
        "ascii" => Some(ModbusProto::Ascii),
        _ => None,
    }
}

async fn emit_log(app: &Option<AppHandle>, server_id: String, message: String) {
    if let Some(handle) = app {
        let _ = handle.emit("modbus-log", LogEvent { server_id, message });
    }
}

async fn emit_status(app: &Option<AppHandle>, server_id: String, message: String) {
    if let Some(handle) = app {
        let _ = handle.emit("modbus-status", StatusEvent { server_id, message });
    }
}

fn describe_request<V: rmodbus::VectorTrait<u8>>(frame: &ModbusFrame<V>) -> String {
    let fc = frame.func.byte();
    let start = frame.reg;
    let qty = frame.count;

    let name = match fc {
        0x01 => "Read Coil Status",
        0x02 => "Read Input Status",
        0x03 => "Read Holding Reg.",
        0x04 => "Read Input Reg.",
        0x05 => "Write Single Coil",
        0x06 => "Write Single Reg.",
        0x0F => "Write Multiple Coils",
        0x10 => "Write Multiple Reg.",
        0x16 => "Mask Write Register",
        0x17 => "Read/Write Multiple Reg.",
        _ => "Unknown Function",
    };

    if (0x01..=0x04).contains(&fc) {
        format!("{} {} starting at address {}.", name, qty, start)
    } else if fc == 0x05 || fc == 0x06 {
        format!("{} at address {}.", name, start)
    } else if fc == 0x0F || fc == 0x10 {
        format!("{} {} at address {}.", name, qty, start)
    } else {
        format!("{} at address {}.", name, start)
    }
}

async fn process_frame(
    unit: u8,
    proto: ModbusProto,
    request: &[u8],
    context: Arc<RwLock<Box<ModbusDataStore>>>,
    app: &Option<AppHandle>,
    server_id: String,
) -> Option<Vec<u8>> {
    let mut response = Vec::new();
    let mut frame = ModbusFrame::new(unit, request, proto, &mut response);

    if frame.parse().is_err() {
        emit_log(app, server_id, "Modbus frame parse error".to_string()).await;
        return None;
    }

    if frame.processing_required {
        let result = if frame.readonly {
            let ctx = context.read().await;
            frame.process_read(&**ctx)
        } else {
            let mut ctx = context.write().await;
            frame.process_write(&mut **ctx)
        };

        if result.is_err() {
            emit_log(app, server_id, "Modbus frame processing error".to_string()).await;
        } else {
            emit_log(app, server_id.clone(), describe_request(&frame)).await;
            emit_status(app, server_id, "Comms Okay".to_string()).await;
        }
    }

    if frame.response_required {
        if frame.finalize_response().is_ok() {
            Some(response)
        } else {
            None
        }
    } else {
        None
    }
}

async fn tcp_server(
    unit: u8,
    host: String,
    port: u16,
    context: Arc<RwLock<Box<ModbusDataStore>>>,
    app: Option<AppHandle>,
    cancel: CancellationToken,
    ready: Option<tokio::sync::oneshot::Sender<Result<(), String>>>,
    server_id: String,
) {
    let addr = format!("{}:{}", host, port);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => {
            if let Some(r) = ready {
                let _ = r.send(Ok(()));
            }
            l
        }
        Err(e) => {
            let msg = format!("TCP bind error: {}", e);
            emit_status(&app, server_id, msg.clone()).await;
            if let Some(r) = ready {
                let _ = r.send(Err(msg));
            }
            return;
        }
    };
    emit_status(&app, server_id.clone(), format!("TCP listening on {}", addr)).await;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            accept = listener.accept() => {
                match accept {
                    Ok((mut stream, peer)) => {
                        let ctx = context.clone();
                        let app_clone = app.clone();
                        let cancel_clone = cancel.clone();
                        let conn_id = server_id.clone();
                        tokio::spawn(async move {
                            emit_log(&app_clone, conn_id.clone(), format!("TCP client connected: {}", peer)).await;
                            let mut header = [0u8; 6];
                            loop {
                                tokio::select! {
                                    _ = cancel_clone.cancelled() => break,
                                    read = stream.read_exact(&mut header) => {
                                        if read.is_err() { break; }
                                        let len = u16::from_be_bytes([header[4], header[5]]) as usize;
                                        let mut body = vec![0u8; len];
                                        if stream.read_exact(&mut body).await.is_err() { break; }
                                        let mut request = Vec::with_capacity(6 + len);
                                        request.extend_from_slice(&header);
                                        request.extend_from_slice(&body);
                                        if let Some(resp) = process_frame(unit, ModbusProto::TcpUdp, &request, ctx.clone(), &app_clone, conn_id.clone()).await {
                                            if stream.write_all(&resp).await.is_err() { break; }
                                        }
                                    }
                                }
                            }
                            emit_log(&app_clone, conn_id, "TCP client disconnected".to_string()).await;
                        });
                    }
                    Err(e) => {
                        emit_status(&app, server_id.clone(), format!("TCP accept error: {}", e)).await;
                    }
                }
            }
        }
    }

    emit_status(&app, server_id, "TCP server stopped".to_string()).await;
}

async fn udp_server(
    unit: u8,
    host: String,
    port: u16,
    context: Arc<RwLock<Box<ModbusDataStore>>>,
    app: Option<AppHandle>,
    cancel: CancellationToken,
    ready: Option<tokio::sync::oneshot::Sender<Result<(), String>>>,
    server_id: String,
) {
    let addr = format!("{}:{}", host, port);
    let socket = match UdpSocket::bind(&addr).await {
        Ok(s) => {
            if let Some(r) = ready {
                let _ = r.send(Ok(()));
            }
            Arc::new(s)
        }
        Err(e) => {
            let msg = format!("UDP bind error: {}", e);
            emit_status(&app, server_id, msg.clone()).await;
            if let Some(r) = ready {
                let _ = r.send(Err(msg));
            }
            return;
        }
    };
    emit_status(&app, server_id.clone(), format!("UDP listening on {}", addr)).await;

    let mut buf = [0u8; 1024];
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            recv = socket.recv_from(&mut buf) => {
                match recv {
                    Ok((len, src)) => {
                        let request = &buf[..len];
                        if let Some(resp) = process_frame(unit, ModbusProto::TcpUdp, request, context.clone(), &app, server_id.clone()).await {
                            let _ = socket.send_to(&resp, src).await;
                        }
                    }
                    Err(e) => {
                        emit_status(&app, server_id.clone(), format!("UDP recv error: {}", e)).await;
                    }
                }
            }
        }
    }

    emit_status(&app, server_id, "UDP server stopped".to_string()).await;
}

async fn serial_server(
    unit: u8,
    proto: ModbusProto,
    serial: SerialConfig,
    context: Arc<RwLock<Box<ModbusDataStore>>>,
    app: Option<AppHandle>,
    cancel: CancellationToken,
    ready: Option<tokio::sync::oneshot::Sender<Result<(), String>>>,
    server_id: String,
) {
    let baud = serial.baud_rate;
    let data_bits = match serial.data_bits {
        5 => tokio_serial::DataBits::Five,
        6 => tokio_serial::DataBits::Six,
        7 => tokio_serial::DataBits::Seven,
        _ => tokio_serial::DataBits::Eight,
    };
    let parity = match serial.parity.as_str() {
        "Even" => tokio_serial::Parity::Even,
        "Odd" => tokio_serial::Parity::Odd,
        _ => tokio_serial::Parity::None,
    };
    let stop_bits = match serial.stop_bits {
        2 => tokio_serial::StopBits::Two,
        _ => tokio_serial::StopBits::One,
    };

    let builder = tokio_serial::new(serial.port.clone(), baud)
        .data_bits(data_bits)
        .parity(parity)
        .stop_bits(stop_bits)
        .flow_control(tokio_serial::FlowControl::None);

    let mut port = match tokio_serial::SerialStream::open(&builder) {
        Ok(p) => {
            if let Some(r) = ready {
                let _ = r.send(Ok(()));
            }
            p
        }
        Err(e) => {
            let msg = format!("Serial open error: {}", e);
            emit_status(&app, server_id, msg.clone()).await;
            if let Some(r) = ready {
                let _ = r.send(Err(msg));
            }
            return;
        }
    };

    emit_status(&app, server_id.clone(), format!("Serial {} open at {}", serial.port, baud)).await;

    let mut buf = [0u8; 1024];
    let mut pending = Vec::new();

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            read = port.read(&mut buf) => {
                match read {
                    Ok(0) => break,
                    Ok(len) => {
                        if proto == ModbusProto::Ascii {
                            // ASCII mode: read until LF, then parse
                            pending.extend_from_slice(&buf[..len]);
                            while let Some(end) = pending.iter().position(|&b| b == b'\n') {
                                let line = pending.drain(..=end).collect::<Vec<_>>();
                                let mut decoded: ModbusFrameBuf = [0; 256];
                                match parse_ascii_frame(&line, line.len(), &mut decoded, 0) {
                                    Ok(decoded_len) => {
                                        let len = decoded_len as usize;
                                        let request = &decoded[..len];
                                        if let Some(resp) = process_frame(unit, ModbusProto::Ascii, request, context.clone(), &app, server_id.clone()).await {
                                            let mut ascii_resp = Vec::new();
                                            if generate_ascii_frame(&resp, &mut ascii_resp).is_ok() {
                                                let _ = port.write_all(&ascii_resp).await;
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        emit_log(&app, server_id.clone(), format!("ASCII decode error: {:?}", e)).await;
                                    }
                                }
                            }
                        } else {
                            // RTU mode: accumulate and try to parse frame length
                            pending.extend_from_slice(&buf[..len]);
                            while !pending.is_empty() {
                                match guess_request_frame_len(&pending, ModbusProto::Rtu) {
                                    Ok(frame_len) if frame_len > 0 && pending.len() >= frame_len as usize => {
                                        let request: Vec<u8> = pending.drain(..frame_len as usize).collect();
                                        if let Some(resp) = process_frame(unit, ModbusProto::Rtu, &request, context.clone(), &app, server_id.clone()).await {
                                            let _ = port.write_all(&resp).await;
                                        }
                                    }
                                    _ => break,
                                }
                            }
                            // Prevent unbounded growth
                            if pending.len() > 512 {
                                pending.clear();
                            }
                        }
                    }
                    Err(e) => {
                        emit_status(&app, server_id.clone(), format!("Serial read error: {}", e)).await;
                        break;
                    }
                }
            }
        }
    }

    emit_status(&app, server_id, "Serial server stopped".to_string()).await;
}

pub async fn start_server_instance(
    state: &AppState,
    config: ServerConfig,
) -> Result<ServerStatus, String> {
    let mut servers = state.servers.lock().await;

    if servers.contains_key(&config.id) {
        return Ok(ServerStatus {
            id: config.id.clone(),
            running: true,
            mode: config.mode.clone(),
            details: "Server already running".to_string(),
        });
    }

    // Check port conflicts for TCP/UDP instances
    if let Some(net) = config.network.as_ref() {
        let port = net.port;
        let host = net.host.clone();
        for (id, inst) in servers.iter() {
            if inst.config.mode == config.mode {
                if let Some(existing) = inst.config.network.as_ref() {
                    if existing.port == port && existing.host == host {
                        return Ok(ServerStatus {
                            id: config.id.clone(),
                            running: false,
                            mode: config.mode.clone(),
                            details: format!("Port {} already in use by {}", port, id),
                        });
                    }
                }
            }
        }
    }

    let proto = modbus_proto_from_mode(&config.mode)
        .ok_or_else(|| format!("Unsupported mode: {}", config.mode))?;

    let app = state.app_handle.lock().await.clone();
    let context: Arc<RwLock<Box<ModbusDataStore>>> =
        Arc::new(RwLock::new(Box::new(ModbusStorage::default())));
    let cancel = CancellationToken::new();
    let task_cancel = cancel.clone();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let server_id = config.id.clone();
    let mode = config.mode.clone();

    let task = match config.mode.as_str() {
        "tcp" => {
            let net = config.network.as_ref().ok_or("Missing network config")?;
            tokio::spawn(tcp_server(
                config.unit_id,
                net.host.clone(),
                net.port,
                context.clone(),
                app,
                task_cancel,
                Some(ready_tx),
                server_id,
            ))
        }
        "udp" => {
            let net = config.network.as_ref().ok_or("Missing network config")?;
            tokio::spawn(udp_server(
                config.unit_id,
                net.host.clone(),
                net.port,
                context.clone(),
                app,
                task_cancel,
                Some(ready_tx),
                server_id,
            ))
        }
        "rtu" => {
            let serial = config.serial.as_ref().ok_or("Missing serial config")?;
            tokio::spawn(serial_server(
                config.unit_id,
                proto,
                serial.clone(),
                context.clone(),
                app,
                task_cancel,
                Some(ready_tx),
                server_id,
            ))
        }
        "ascii" => {
            let serial = config.serial.as_ref().ok_or("Missing serial config")?;
            tokio::spawn(serial_server(
                config.unit_id,
                proto,
                serial.clone(),
                context.clone(),
                app,
                task_cancel,
                Some(ready_tx),
                server_id,
            ))
        }
        _ => return Err(format!("Unsupported mode: {}", config.mode)),
    };

    let ready = tokio::time::timeout(std::time::Duration::from_secs(2), ready_rx)
        .await
        .map_err(|_| "Server start timed out".to_string())?
        .map_err(|_| "Server start cancelled".to_string())?;

    if let Err(e) = ready {
        return Ok(ServerStatus {
            id: config.id,
            running: false,
            mode: config.mode,
            details: e,
        });
    }

    let id = config.id.clone();
    servers.insert(
        id.clone(),
        ServerInstance {
            handle: ServerHandle { task, cancel },
            context,
            config,
        },
    );

    Ok(ServerStatus {
        id,
        running: true,
        mode,
        details: "Server started".to_string(),
    })
}

pub async fn stop_server_instance(
    state: &AppState,
    id: String,
) -> Result<ServerStatus, String> {
    let mut servers = state.servers.lock().await;
    if let Some(h) = servers.remove(&id) {
        h.handle.cancel.cancel();
        let _ = tokio::time::timeout(std::time::Duration::from_millis(500), h.handle.task).await;
    }

    Ok(ServerStatus {
        id,
        running: false,
        mode: String::new(),
        details: "Server stopped".to_string(),
    })
}

pub async fn get_instance_status(state: &AppState, id: String) -> ServerStatus {
    let servers = state.servers.lock().await;
    if let Some(inst) = servers.get(&id) {
        ServerStatus {
            id,
            running: true,
            mode: inst.config.mode.clone(),
            details: "Running".to_string(),
        }
    } else {
        ServerStatus {
            id,
            running: false,
            mode: String::new(),
            details: "Stopped".to_string(),
        }
    }
}

pub async fn list_servers(state: &AppState) -> Vec<ServerStatus> {
    let servers = state.servers.lock().await;
    servers
        .values()
        .map(|inst| ServerStatus {
            id: inst.config.id.clone(),
            running: true,
            mode: inst.config.mode.clone(),
            details: "Running".to_string(),
        })
        .collect()
}

pub async fn get_instance_context(
    state: &AppState,
    id: String,
) -> Option<Arc<RwLock<Box<ModbusDataStore>>>> {
    let servers = state.servers.lock().await;
    servers.get(&id).map(|inst| inst.context.clone())
}
