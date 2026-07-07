# Modbus Slave Simulation (Tauri) 中文说明

[English](./README.md) | [简体中文](./README.zh-CN.md)

一款基于 [Tauri 2](https://v2.tauri.app/) 和 React 重构的跨平台 [Modbus](https://en.wikipedia.org/wiki/Modbus) 从站模拟器。本项目灵感来源于原版 [GitHubDragonFly/ModbusSlaveSimulation](https://github.com/GitHubDragonFly/ModbusSlaveSimulation) Windows/Mono 应用程序，但使用 Rust 作为后端、Web 技术作为前端，重新打造为现代化轻量级桌面应用。

## 功能特性

- **通信协议**：RTU、TCP、UDP，以及基于 RTU 的 ASCII。
- **从站 ID**：可配置的 Unit ID（1–247）。
- **数据类型**：每类最多 65,535 个地址
  - 线圈（Coils，0x）
  - 离散量输入（Discrete Inputs，1x）
  - 输入寄存器（Input Registers，3x）
  - 保持寄存器（Holding Registers，4x）
- **预置数值**：在服务器启动前可编辑任意寄存器/线圈；修改仅在内存中持久化。
- **可编辑表格**：双击单元格即可切换布尔值，或设置 Uint16 数值（0–65535）。
- **多实例运行**：可并行运行多个应用实例，使用不同端口或串口。
- **虚拟串口**：兼容 Windows `com0com` 和 Linux `tty0tty` 虚拟串口对；串口字段也支持手动输入。
- **实时日志**：记录主站请求帧和通信状态。

## 支持的 Modbus 功能码

- `01` 读取线圈状态（Read Coil Status）
- `02` 读取离散量输入状态（Read Input Status）
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
- **串口**：[tokio-serial](https://crates.io/crates/tokio-serial)
- **前端**：React 19 + TypeScript + Tailwind CSS + Vite

## 环境要求

- [Node.js](https://nodejs.org/)（建议 v20 或更高版本）
- [Rust](https://www.rust-lang.org/tools/install) 工具链（`cargo` + `rustc`）
- Windows、Linux 或 macOS（串口功能需要对应系统的驱动或权限）

## 开发运行

先安装依赖，然后启动 Tauri 开发窗口：

```bash
npm install
npm run tauri dev
```

> **Linux/macOS 提示**：请确保 `cargo` 在 PATH 中。如果通过 rustup 安装 Rust，默认路径是 `~/.cargo/bin`。

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

## 构建打包

```bash
npm run tauri build
```

构建产物将位于 `src-tauri/target/release/bundle/` 目录下。

### Windows

构建会生成 `.msi` 安装包（以及可选的 `.exe`），位于 `src-tauri/target/release/bundle/`。

### Linux

Tauri 会生成 `.deb`、`.rpm` 和 `.AppImage` 等分发包（取决于系统已安装的打包工具和 `tauri.conf.json` 的 bundle 目标）。例如在 Debian/Ubuntu 上可找到：

- `src-tauri/target/release/bundle/deb/*.deb`
- `src-tauri/target/release/bundle/appimage/*.AppImage`

> 构建 `.rpm` 需要 `rpm`/`rpmbuild`；构建 `.AppImage` 需要 `appimagetool` 及相关依赖。

### macOS

构建会生成 `.dmg` 磁盘镜像和 `.app` 应用包：

- `src-tauri/target/release/bundle/dmg/*.dmg`
- `src-tauri/target/release/bundle/macos/*.app`

> Apple Silicon（M1/M2/M3）和 Intel Mac 均受支持。Tauri 默认按当前激活的 Rust 工具链架构构建。如需交叉编译到另一种架构，请配置对应的 Rust target 和工具链。

## 下载安装

Windows、Linux 和 macOS 的预构建安装包可在 [Releases](https://github.com/hopekayo/modbus-slave-simulation-tauri/releases) 页面下载。

> Linux 用户可下载 `.deb` 或 `.AppImage` 包；macOS 用户可下载 `.dmg` 镜像。

## 许可证

本项目采用 [MIT License](./LICENSE) 开源许可，与原版基于 nModbus 的模拟器保持一致。

## 致谢

原始项目：[GitHubDragonFly/ModbusSlaveSimulation](https://github.com/GitHubDragonFly/ModbusSlaveSimulation)
