# Modbus Slave Simulation (Tauri)

A cross-platform [Modbus](https://en.wikipedia.org/wiki/Modbus) slave simulator rebuilt with [Tauri 2](https://v2.tauri.app/) and React. This project is inspired by the original [GitHubDragonFly/ModbusSlaveSimulation](https://github.com/GitHubDragonFly/ModbusSlaveSimulation) Windows/Mono application, but rewritten as a modern, lightweight desktop app using Rust for the backend and a web-based UI.

## Features

- **Protocols**: RTU, TCP, UDP, and ASCII over RTU.
- **Slave ID**: configurable Unit ID (1–247).
- **Data types**: 65,535 addresses each for
  - Coils (0x)
  - Discrete Inputs (1x)
  - Input Registers (3x)
  - Holding Registers (4x)
- **Pre-set values**: edit any register/coil before the server starts; changes are persisted in memory.
- **Editable grid**: double-click a cell to flip a Boolean value or set a Uint16 value (0–65535).
- **Multiple instances**: run multiple app instances side-by-side with different ports or serial ports.
- **Virtual serial ports**: compatible with Windows `com0com` and Linux `tty0tty` pairs; the serial port field can also be typed manually.
- **Logging**: real-time log of master request frames and communication status.

## Supported Modbus Function Codes

- `01` Read Coil Status
- `02` Read Input Status
- `03` Read Holding Registers
- `04` Read Input Registers
- `05` Write Single Coil
- `06` Write Single Register
- `15` Write Multiple Coils
- `16` Write Multiple Registers
- `22` Mask Write Register
- `23` Read/Write Multiple Registers

## Tech Stack

- **Backend**: Rust + Tauri 2 + Tokio
- **Modbus library**: [rmodbus](https://crates.io/crates/rmodbus)
- **Serial**: [tokio-serial](https://crates.io/crates/tokio-serial)
- **Frontend**: React 19 + TypeScript + Tailwind CSS + Vite

## Requirements

- [Node.js](https://nodejs.org/) (v20 or later recommended)
- [Rust](https://www.rust-lang.org/tools/install) toolchain (`cargo` + `rustc`)
- Windows, Linux, or macOS (serial ports require OS-specific drivers or permissions)

## Development

```bash
# Ensure cargo is on your PATH (Windows PowerShell example)
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

npm install
npm run tauri dev
```

## Build

```bash
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri build
```

Build artifacts will be placed in `src-tauri/target/release/bundle/`.

## Download

Pre-built installers are available on the [Releases](https://github.com/YOUR_USERNAME/REPO_NAME/releases) page.

## License

This project is licensed under the [MIT License](./LICENSE), matching the license of the original nModbus-based simulator.

## Acknowledgements

Original project: [GitHubDragonFly/ModbusSlaveSimulation](https://github.com/GitHubDragonFly/ModbusSlaveSimulation)
