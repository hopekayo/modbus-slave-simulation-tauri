import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const ROW_OPTIONS = ["20", "50", "100", "200", "500", "MAX"];
const BAUD_OPTIONS = ["1200", "2400", "4800", "9600", "19200", "38400", "57600", "115200"];
const DATA_BITS_OPTIONS = ["5", "6", "7", "8"];
const PARITY_OPTIONS = ["None", "Even", "Odd"];
const STOP_BITS_OPTIONS = ["1", "2"];

const IO_RANGES = [
  { key: "coil", label: "Coil Outputs (000000)" },
  { key: "discrete", label: "Discrete Inputs (100000)" },
  { key: "input", label: "Input Registers (300000)" },
  { key: "holding", label: "Holding Registers (400000)" },
];

const MODE_OPTIONS = [
  { key: "rtu", label: "RTU" },
  { key: "tcp", label: "TCP" },
  { key: "udp", label: "UDP" },
  { key: "ascii", label: "ASCII" },
];

const MAX_LOGS = 2048;

function isRegister(kind: string) {
  return kind === "input" || kind === "holding";
}

function colsForKind(kind: string) {
  return isRegister(kind) ? 10 : 16;
}

function formatAddress(kind: string, addr: number) {
  const prefix =
    kind === "coil" ? "0" : kind === "discrete" ? "1" : kind === "input" ? "3" : "4";
  return prefix + (addr + 1).toString().padStart(5, "0");
}

function rangeLabel(kind: string, row: number, cols: number) {
  const start = row * cols;
  const end = Math.min(start + cols - 1, 65534);
  return `${formatAddress(kind, start)}-${formatAddress(kind, end)}`;
}

function App() {
  const [mode, setMode] = useState("tcp");
  const [unitId, setUnitId] = useState("1");
  const [host, setHost] = useState("127.0.0.1");
  const [netPort, setNetPort] = useState("502");
  const [serialPorts, setSerialPorts] = useState<string[]>([]);
  const [serialPort, setSerialPort] = useState("");
  const [manualCom, setManualCom] = useState("");
  const [baudRate, setBaudRate] = useState("9600");
  const [dataBits, setDataBits] = useState("8");
  const [parity, setParity] = useState("None");
  const [stopBits, setStopBits] = useState("1");
  const [rowCount, setRowCount] = useState("20");
  const [ioRange, setIoRange] = useState("coil");
  const [data, setData] = useState<number[]>([]);
  const [selectedAddr, setSelectedAddr] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(true);
  const [status, setStatus] = useState("Stopped");
  const [isRunning, setIsRunning] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editingAddr, setEditingAddr] = useState<number | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  const cols = colsForKind(ioRange);
  const maxRows = useMemo(() => {
    if (rowCount === "MAX") {
      return Math.ceil(65535 / cols);
    }
    return parseInt(rowCount, 10);
  }, [rowCount, cols]);

  useEffect(() => {
    refreshSerialPorts();
    const unlistenLog = listen<{ message: string }>("modbus-log", (event) => {
      addLog(event.payload.message);
    });
    const unlistenStatus = listen<{ message: string }>("modbus-status", (event) => {
      setStatus(event.payload.message);
    });
    return () => {
      unlistenLog.then((u) => u());
      unlistenStatus.then((u) => u());
    };
  }, []);

  useEffect(() => {
    loadData();
  }, [ioRange, rowCount, maxRows, cols]);

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  const addLog = (message: string) => {
    setLogs((prev) => {
      const next = [...prev, message];
      if (next.length > MAX_LOGS) {
        next.shift();
      }
      return next;
    });
  };

  async function refreshSerialPorts() {
    try {
      const ports = await invoke<string[]>("get_serial_ports");
      setSerialPorts(ports.length > 0 ? ports : ["none found"]);
      if (ports.length > 0) {
        setSerialPort(ports[0]);
      } else {
        setSerialPort("");
      }
    } catch (e) {
      setSerialPorts(["none found"]);
    }
  }

  async function loadData() {
    const count = maxRows * cols;
    try {
      const result = await invoke<{ kind: string; start: number; values: number[] }>(
        "get_data_range",
        {
          request: { kind: ioRange, start: 0, count },
        }
      );
      setData(result.values);
    } catch (e) {
      console.error("Failed to load data", e);
    }
  }

  async function handleCellClick(row: number, col: number) {
    const addr = row * cols + (col - 1);
    if (addr >= 65535) return;
    setSelectedAddr(addr);
  }

  async function handleCellDoubleClick(row: number, col: number) {
    const addr = row * cols + (col - 1);
    if (addr >= 65535) return;

    if (isRegister(ioRange)) {
      setEditingAddr(addr);
      setEditValue(data[addr]?.toString() ?? "0");
    } else {
      const newValue = data[addr] ? 0 : 1;
      await updateValue(addr, newValue);
    }
  }

  async function updateValue(addr: number, value: number) {
    try {
      await invoke("set_value", {
        value: { kind: ioRange, address: addr, value },
      });
      setData((prev) => {
        const next = [...prev];
        next[addr] = value;
        return next;
      });
    } catch (e) {
      console.error("Failed to set value", e);
    }
  }

  function handleEditSubmit() {
    if (editingAddr === null) return;
    const parsed = parseInt(editValue, 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 65535) {
      alert("The value must be an integer between 0 and 65535!");
      return;
    }
    updateValue(editingAddr, parsed);
    setEditingAddr(null);
    setEditValue("");
  }

  async function handleStart() {
    const parsedUnitId = parseInt(unitId, 10);
    if (Number.isNaN(parsedUnitId) || parsedUnitId < 1 || parsedUnitId > 247) {
      alert("Unit ID must be between 1 and 247");
      return;
    }
    const config: any = { mode, unit_id: parsedUnitId };
    if (mode === "tcp" || mode === "udp") {
      config.network = { host, port: parseInt(netPort, 10) };
    } else {
      const portName = manualCom.trim() || serialPort;
      config.serial = {
        port: portName,
        baud_rate: parseInt(baudRate, 10),
        data_bits: parseInt(dataBits, 10),
        parity,
        stop_bits: parseInt(stopBits, 10),
      };
    }
    try {
      const result = await invoke<{ running: boolean; details: string }>(
        "start_server",
        { config }
      );
      setIsRunning(result.running);
      setStatus(result.details);
    } catch (e) {
      setStatus(`Error: ${e}`);
    }
  }

  async function handleStop() {
    try {
      const result = await invoke<{ running: boolean; details: string }>(
        "stop_server_cmd"
      );
      setIsRunning(result.running);
      setStatus(result.details);
    } catch (e) {
      setStatus(`Error: ${e}`);
    }
  }

  const isSerial = mode === "rtu" || mode === "ascii";
  const serialDisabled = manualCom.trim() === "" && serialPort === "";

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100 overflow-hidden">
      <div className="flex-none p-3 border-b border-slate-700">
        <div className="flex flex-wrap gap-4 items-start">
          <div className="flex-1 min-w-[280px] border border-slate-600 rounded p-3">
            <h2 className="text-sm font-semibold mb-2 text-sky-400">
              {isSerial ? "Serial" : "TCP / UDP"}
            </h2>
            {!isSerial ? (
              <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                <label className="text-xs">Local IP</label>
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  disabled={isRunning}
                  className="text-sm"
                />
                <label className="text-xs">Local Port</label>
                <input
                  value={netPort}
                  onChange={(e) => setNetPort(e.target.value)}
                  disabled={isRunning}
                  className="text-sm"
                />
              </div>
            ) : (
              <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                <label className="text-xs">Port</label>
                <select
                  value={serialPort}
                  onChange={(e) => setSerialPort(e.target.value)}
                  disabled={isRunning || serialPorts.length === 0}
                  className="text-sm"
                >
                  {serialPorts.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <label className="text-xs">Baud</label>
                <select
                  value={baudRate}
                  onChange={(e) => setBaudRate(e.target.value)}
                  disabled={isRunning}
                  className="text-sm"
                >
                  {BAUD_OPTIONS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <label className="text-xs">Data Bits</label>
                <select
                  value={dataBits}
                  onChange={(e) => setDataBits(e.target.value)}
                  disabled={isRunning}
                  className="text-sm"
                >
                  {DATA_BITS_OPTIONS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <label className="text-xs">Parity</label>
                <select
                  value={parity}
                  onChange={(e) => setParity(e.target.value)}
                  disabled={isRunning}
                  className="text-sm"
                >
                  {PARITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <label className="text-xs">Stop Bits</label>
                <select
                  value={stopBits}
                  onChange={(e) => setStopBits(e.target.value)}
                  disabled={isRunning}
                  className="text-sm"
                >
                  {STOP_BITS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <label className="text-xs">Manual COM</label>
                <input
                  value={manualCom}
                  onChange={(e) => setManualCom(e.target.value)}
                  placeholder="e.g. COM3 or /dev/tnt0"
                  disabled={isRunning}
                  className="text-sm"
                />
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleStart}
                disabled={isRunning || (isSerial && serialDisabled)}
                className="px-3 py-1 bg-sky-600 hover:bg-sky-500 rounded text-sm font-medium disabled:opacity-50"
              >
                Open
              </button>
              <button
                onClick={handleStop}
                disabled={!isRunning}
                className="px-3 py-1 bg-slate-600 hover:bg-slate-500 rounded text-sm font-medium disabled:opacity-50"
              >
                Close
              </button>
              {isSerial && (
                <button
                  onClick={refreshSerialPorts}
                  disabled={isRunning}
                  className="px-3 py-1 bg-slate-600 hover:bg-slate-500 rounded text-sm font-medium disabled:opacity-50"
                >
                  Refresh
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-[200px] border border-slate-600 rounded p-3">
            <div className="grid grid-cols-[100px_1fr] gap-2 items-center mb-2">
              <label className="text-sm">Comm Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                disabled={isRunning}
                className="text-sm"
              >
                {MODE_OPTIONS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2 items-center mb-2">
              <label className="text-sm">Unit ID</label>
              <input
                type="number"
                min={1}
                max={247}
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                disabled={isRunning}
                className="text-sm"
              />
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2 items-center mb-2">
              <label className="text-sm">Row Count</label>
              <select
                value={rowCount}
                onChange={(e) => setRowCount(e.target.value)}
                disabled={isRunning}
                className="text-sm"
              >
                {ROW_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-4 text-xs text-slate-400">
              <div>Function Code 15 - Write Multiple Coils</div>
              <div>Function Code 16 - Write Multiple Registers</div>
              <div>Function Code 22 - Masked Bit Write</div>
              <div>Function Code 23 - Read/Write Multiple Registers</div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-none px-3 py-2 border-b border-slate-700 flex items-center gap-4">
        <label className="text-sm">I/O Address Range</label>
        <select
          value={ioRange}
          onChange={(e) => setIoRange(e.target.value)}
          className="text-sm"
        >
          {IO_RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        <button
          onClick={loadData}
          className="px-2 py-1 bg-slate-600 hover:bg-slate-500 rounded text-xs"
        >
          Refresh
        </button>
        <div className="ml-auto text-sm">
          Cell Address: <span className="font-mono text-yellow-400">{selectedAddr !== null ? formatAddress(ioRange, selectedAddr) : ""}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-800 z-10">
            <tr>
              <th className="border border-slate-600 px-2 py-1 text-left bg-slate-700">
                Address
              </th>
              {Array.from({ length: cols }).map((_, i) => (
                <th
                  key={i}
                  className="border border-slate-600 px-2 py-1 text-center bg-slate-700"
                >
                  +{i}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxRows }).map((_, row) => (
              <tr key={row}>
                <td className="border border-slate-600 px-2 py-1 font-mono whitespace-nowrap">
                  {rangeLabel(ioRange, row, cols)}
                </td>
                {Array.from({ length: cols }).map((_, col) => {
                  const addr = row * cols + col;
                  if (addr >= 65535) {
                    return (
                      <td
                        key={col}
                        className="border border-slate-600 px-1 py-1 bg-slate-800"
                      />
                    );
                  }
                  return (
                    <td
                      key={col}
                      className="border border-slate-600 px-1 py-1 text-center font-mono cursor-pointer hover:bg-slate-700"
                      onClick={() => handleCellClick(row, col + 1)}
                      onDoubleClick={() => handleCellDoubleClick(row, col + 1)}
                    >
                      {data[addr] ?? 0}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex-none px-3 py-2 border-t border-slate-700">
        <div className="flex items-center gap-2 mb-2">
          <input
            type="checkbox"
            id="showLogs"
            checked={showLogs}
            onChange={(e) => setShowLogs(e.target.checked)}
          />
          <label htmlFor="showLogs" className="text-sm select-none">
            Master Requests (Message Frame)
          </label>
        </div>
        {showLogs && (
          <div
            ref={logsRef}
            className="h-32 overflow-y-auto border border-slate-600 rounded bg-slate-950 p-2 font-mono text-xs"
          >
            {logs.length === 0 ? (
              <div className="text-slate-500">No requests yet.</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="truncate">
                  {log}
                </div>
              ))
            )}
          </div>
        )}
        <div className="mt-2 text-sm">
          Message: <span className="text-yellow-400">{status}</span>
        </div>
      </div>

      {editingAddr !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-600 rounded p-4 w-64">
            <h3 className="text-sm font-semibold mb-3">Set Value</h3>
            <input
              type="number"
              min={0}
              max={65535}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleEditSubmit()}
              className="w-full mb-3 text-sm"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditingAddr(null)}
                className="px-3 py-1 bg-slate-600 hover:bg-slate-500 rounded text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSubmit}
                className="px-3 py-1 bg-sky-600 hover:bg-sky-500 rounded text-sm"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
