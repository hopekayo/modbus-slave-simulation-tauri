# Modbus Slave Simulation (Tauri)

[English](./README.md) | [简体中文](./README.zh-CN.md)

使用 [Tauri 2](https://v2.tauri.app/) 和 React 重新实现的跨平台 [Modbus](https://en.wikipedia.org/wiki/Modbus) 从站模拟器。本项目参考了原作者 [GitHubDragonFly/ModbusSlaveSimulation](https://github.com/GitHubDragonFly/ModbusSlaveSimulation) 的 Windows/Mono 版本，但使用 Rust 作为后端、Web 技术作为前端，打造了一款现代化、轻量化的桌面应用。

## 功能特性

- **通信协议**：支持 RTU、TCP、UDP 以及 ASCII over RTU。
- **从站地址**：可配置 Unit ID（1–247）。
- **数据区**：每类地址均支持 65,535 个地址，包括
  - 线圈（Coils，0x）
  - 离散量输入（Discrete Inputs，1x）
  - 输入寄存器（Input Registers，3x）
  - 保持寄存器（Holding Registers，4x）
- **启动前预设值**：在服务器启动前即可编辑任意寄存器/线圈的值，修改会保留在内存中。
- **可编辑表格**：双击单元格即可翻转布尔值或设置 0–65535 的 Uint16 值。
- **多实例运行**：可同时运行多个应用实例，分别使用不同端口或串口。
- **虚拟串口支持**：兼容 Windows 的 `com0com` 和 Linux 的 `tty0tty` 虚拟串口对；串口输入框也支持手动输入。
- **实时日志**：实时显示主站请求帧和通信状态。

## 支持的 Modbus 功能码

- `01` 读取线圈状态（Read Coil Status）
- `02` 读取离散输入状态（Read Input Status）
- `03` 读取保持寄存器（Read Holding Registers）
- `04` 读取输入寄存器（Read Input Registers）
- `05` 写单个线圈（Write Single Coil）
- `06` 写单个寄存器（Write Single Register）
- `15` 写多个线圈（Write Multiple Coils）
- `16` 写多个寄存器（Write Multiple Registers）
- `22` 屏蔽写寄存器（Mask Write Register）
- `23` 读写多个寄存器（Read/Write Multiple Registers）

## 技术栈

- **后端**：Rust + Tauri 2 + Tokio
- **Modbus 库**：[rmodbus](https://crates.io/crates/rmodbus)
- **串口通信**：[tokio-serial](https://crates.io/crates/tokio-serial)
- **前端**：React 19 + TypeScript + Tailwind CSS + Vite

## 环境要求

- [Node.js](https://nodejs.org/)（建议 v20 或更高版本）
- [Rust](https://www.rust-lang.org/tools/install) 工具链（`cargo` + `rustc`）
- Windows、Linux 或 macOS（串口通信需要系统对应的驱动或权限）

## 开发

先安装依赖，然后启动 Tauri 开发窗口：

```bash
npm install
npm run tauri dev
```

> **Linux/macOS 注意**：确保 `cargo` 在 PATH 中。如果通过 rustup 安装 Rust，默认路径为 `~/.cargo/bin`。

### Windows（PowerShell）

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm install
npm run tauri dev
```

### Linux / macOS

```bash
export PATH="$HOME/.cargo/bin:$PATH"
npm install
npm run tauri dev
```

## 构建

```bash
npm run tauri build
```

构建产物将位于 `src-tauri/target/release/bundle/`。

### Windows

构建会生成 `.msi` 安装包（以及可选的 `.exe`），位于 `src-tauri/target/release/bundle/`。

### Linux

Tauri 会根据系统环境和 `tauri.conf.json` 中的 bundle 目标生成 `.deb`、`.rpm`、`.AppImage` 等分发包。例如在 Debian/Ubuntu 上可以找到：

- `src-tauri/target/release/bundle/deb/*.deb`
- `src-tauri/target/release/bundle/appimage/*.AppImage`

> 构建 `.rpm` 需要 `rpm`/`rpmbuild`；构建 `.AppImage` 需要 `appimagetool` 及相关依赖。

### macOS

构建会生成 `.dmg` 磁盘镜像和 `.app` 应用包：

- `src-tauri/target/release/bundle/dmg/*.dmg`
- `src-tauri/target/release/bundle/macos/*.app`

> 同时支持 Apple Silicon（M1/M2/M3）和 Intel Mac。Tauri 默认按照当前激活的 Rust 工具链架构构建。如需交叉编译，请配置对应的 Rust target 和工具链。

## 下载

预编译的 Windows、Linux 和 macOS 安装包可在 [Releases](https://github.com/hopekayo/modbus-slave-simulation-tauri/releases) 页面下载。

> Linux 用户可下载 `.deb` 或 `.AppImage` 包；macOS 用户可下载 `.dmg` 镜像。

## 许可证

本项目采用 [MIT License](./LICENSE) 开源，与原版基于 nModbus 的模拟器许可证保持一致。

## 致谢

原版项目：[GitHubDragonFly/ModbusSlaveSimulation](https://github.com/GitHubDragonFly/ModbusSlaveSimulation)
