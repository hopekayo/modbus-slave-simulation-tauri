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
  { key: "tcp", label: "TCP" },
  { key: "udp", label: "UDP" },
  { key: "rtu", label: "RTU" },
  { key: "ascii", label: "ASCII" },
];

const MAX_LOGS = 2048;

interface ServerInstance {
  id: string;
  mode: string;
  unitId: string;
  host: string;
  port: string;
  serialPort: string;
  manualCom: string;
  baudRate: string;
  dataBits: string;
  parity: string;
  stopBits: string;
  running: boolean;
  status: string;
}

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
  const [instances, setInstances] = useState<ServerInstance[]>([]);
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [serialPorts, setSerialPorts] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState("20");
  const [ioRange, setIoRange] = useState("coil");
  const [data, setData] = useState<number[]>([]);
  const [selectedAddr, setSelectedAddr] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(true);
  const [editValue, setEditValue] = useState("");
  const [editingAddr, setEditingAddr] = useState<number | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  const activeInstance = instances.find((i) => i.id === activeInstanceId) || null;

  const cols = colsForKind(ioRange);
  const maxRows = useMemo(() => {
    if (rowCount === "MAX") {
      return Math.ceil(65535 / cols);
    }
    return parseInt(rowCount, 10);
  }, [rowCount, cols]);

  useEffect(() => {
    refreshSerialPorts();
    const unlistenLog = listen<{ server_id: string; message: string }>("modbus-log", (event) => {
      addLog(`[${event.payload.server_id}] ${event.payload.message}`);
    });
    const unlistenStatus = listen<{ server_id: string; message: string }>(
      "modbus-status",
      (event) => {
        updateInstanceStatus(event.payload.server_id, event.payload.message);
      }
    );
    return () => {
      unlistenLog.then((u) => u());
      unlistenStatus.then((u) => u());
    };
  }, []);

  useEffect(() => {
    if (activeInstanceId) {
      loadData();
    } else {
      setData([]);
    }
  }, [activeInstanceId, ioRange, rowCount, maxRows, cols]);

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

  function updateInstanceStatus(id: string, message: string) {
    setInstances((prev) =>
      prev.map((inst) => (inst.id === id ? { ...inst, status: message } : inst))
    );
  }

  async function refreshSerialPorts() {
    try {
      const ports = await invoke<string[]>("get_serial_ports");
      setSerialPorts(ports.length > 0 ? ports : ["none found"]);
    } catch (e) {
      setSerialPorts(["none found"]);
    }
  }

  async function loadData() {
    if (!activeInstanceId) return;
    const count = maxRows * cols;
    try {
      const result = await invoke<{ kind: string; start: number; values: number[] }>(
        "get_instance_data",
        {
          id: activeInstanceId,
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
    if (addr >= 65535 || !activeInstanceId) return;

    if (isRegister(ioRange)) {
      setEditingAddr(addr);
      setEditValue(data[addr]?.toString() ?? "0");
    } else {
      const newValue = data[addr] ? 0 : 1;
      await updateValue(addr, newValue);
    }
  }

  async function updateValue(addr: number, value: number) {
    if (!activeInstanceId) return;
    try {
      await invoke("set_instance_value", {
        id: activeInstanceId,
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

  function addInstance() {
    const nextIndex = instances.length + 1;
    const id = `slave-${nextIndex}`;
    const port = (502 + instances.length).toString();
    const newInstance: ServerInstance = {
      id,
      mode: "tcp",
      unitId: "1",
      host: "127.0.0.1",
      port,
      serialPort: serialPorts[0] || "",
      manualCom: "",
      baudRate: "9600",
      dataBits: "8",
      parity: "None",
      stopBits: "1",
      running: false,
      status: "Stopped",
    };
    setInstances((prev) => [...prev, newInstance]);
    setActiveInstanceId(id);
  }

  async function removeInstance(id: string) {
    const inst = instances.find((i) => i.id === id);
    if (inst?.running) {
      await handleStop(id);
    }
    setInstances((prev) => prev.filter((i) => i.id !== id));
    if (activeInstanceId === id) {
      setActiveInstanceId(null);
    }
  }

  function updateInstance(id: string, patch: Partial<ServerInstance>) {
    setInstances((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  async function handleStart(id: string) {
    const inst = instances.find((i) => i.id === id);
    if (!inst) return;

    const parsedUnitId = parseInt(inst.unitId, 10);
    if (Number.isNaN(parsedUnitId) || parsedUnitId < 1 || parsedUnitId > 247) {
      alert("Unit ID must be between 1 and 247");
      return;
    }

    const config: any = { id, mode: inst.mode, unit_id: parsedUnitId };
    if (inst.mode === "tcp" || inst.mode === "udp") {
      config.network = { host: inst.host, port: parseInt(inst.port, 10) };
    } else {
      const portName = inst.manualCom.trim() || inst.serialPort;
      config.serial = {
        port: portName,
        baud_rate: parseInt(inst.baudRate, 10),
        data_bits: parseInt(inst.dataBits, 10),
        parity: inst.parity,
        stop_bits: parseInt(inst.stopBits, 10),
      };
    }

    try {
      const result = await invoke<{ id: string; running: boolean; details: string }>(
        "start_server_instance",
        { config }
      );
      updateInstance(id, { running: result.running, status: result.details });
      addLog(`[${id}] ${result.details}`);
    } catch (e) {
      updateInstance(id, { status: `Error: ${e}` });
    }
  }

  async function handleStop(id: string) {
    try {
      const result = await invoke<{ id: string; running: boolean; details: string }>(
        "stop_server_instance",
        { id }
      );
      updateInstance(id, { running: result.running, status: result.details });
      addLog(`[${id}] ${result.details}`);
    } catch (e) {
      updateInstance(id, { status: `Error: ${e}` });
    }
  }

  const isSerial = (mode: string) => mode === "rtu" || mode === "ascii";

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100 overflow-hidden">
      <div className="flex-none p-3 border-b border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold text-sky-400">Modbus Slave Simulators</h1>
          <button
            onClick={addInstance}
            className="px-3 py-1 bg-sky-600 hover:bg-sky-500 rounded text-sm font-medium"
          >
            Add Slave
          </button>
        </div>

        <div className="flex flex-wrap gap-3">
          {instances.map((inst) => (
            <div
              key={inst.id}
              onClick={() => setActiveInstanceId(inst.id)}
              className={`flex-none w-[320px] border rounded p-3 cursor-pointer transition-colors ${
                activeInstanceId === inst.id
                  ? "border-sky-500 bg-slate-800"
                  : "border-slate-600 bg-slate-800/50"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm">{inst.id}</span>
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      inst.running ? "bg-green-500" : "bg-slate-500"
                    }`}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeInstance(inst.id);
                    }}
                    disabled={inst.running}
                    className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-[70px_1fr] gap-2 items-center text-xs mb-2">
                <label>Mode</label>
                <select
                  value={inst.mode}
                  onChange={(e) => updateInstance(inst.id, { mode: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  disabled={inst.running}
                  className="text-sm"
                >
                  {MODE_OPTIONS.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>

                <label>Unit ID</label>
                <input
                  type="number"
                  min={1}
                  max={247}
                  value={inst.unitId}
                  onChange={(e) => updateInstance(inst.id, { unitId: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  disabled={inst.running}
                  className="text-sm"
                />
              </div>

              {!isSerial(inst.mode) ? (
                <div className="grid grid-cols-[70px_1fr] gap-2 items-center text-xs mb-2">
                  <label>Host</label>
                  <input
                    value={inst.host}
                    onChange={(e) => updateInstance(inst.id, { host: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    disabled={inst.running}
                    className="text-sm"
                  />
                  <label>Port</label>
                  <input
                    value={inst.port}
                    onChange={(e) => updateInstance(inst.id, { port: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    disabled={inst.running}
                    className="text-sm"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-[70px_1fr] gap-2 items-center text-xs mb-2">
                  <label>Port</label>
                  <select
                    value={inst.serialPort}
                    onChange={(e) => updateInstance(inst.id, { serialPort: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    disabled={inst.running || serialPorts.length === 0}
                    className="text-sm"
                  >
                    {serialPorts.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <label>Baud</label>
                  <select
                    value={inst.baudRate}
                    onChange={(e) => updateInstance(inst.id, { baudRate: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    disabled={inst.running}
                    className="text-sm"
                  >
                    {BAUD_OPTIONS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                  <label>Data Bits</label>
                  <select
                    value={inst.dataBits}
                    onChange={(e) => updateInstance(inst.id, { dataBits: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    disabled={inst.running}
                    className="text-sm"
                  >
                    {DATA_BITS_OPTIONS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                  <label>Parity</label>
                  <select
                    value={inst.parity}
                    onChange={(e) => updateInstance(inst.id, { parity: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    disabled={inst.running}
                    className="text-sm"
                  >
                    {PARITY_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <label>Stop Bits</label>
                  <select
                    value={inst.stopBits}
                    onChange={(e) => updateInstance(inst.id, { stopBits: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    disabled={inst.running}
                    className="text-sm"
                  >
                    {STOP_BITS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <label>Manual COM</label>
                  <input
                    value={inst.manualCom}
                    onChange={(e) => updateInstance(inst.id, { manualCom: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    disabled={inst.running}
                    placeholder="e.g. COM3"
                    className="text-sm"
                  />
                </div>
              )}

              <div className="flex gap-2 mt-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStart(inst.id);
                  }}
                  disabled={inst.running}
                  className="px-3 py-1 bg-sky-600 hover:bg-sky-500 rounded text-xs font-medium disabled:opacity-50"
                >
                  Start
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStop(inst.id);
                  }}
                  disabled={!inst.running}
                  className="px-3 py-1 bg-slate-600 hover:bg-slate-500 rounded text-xs font-medium disabled:opacity-50"
                >
                  Stop
                </button>
              </div>
              <div className="mt-2 text-xs text-slate-400 truncate">
                {inst.status}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-none px-3 py-2 border-b border-slate-700 flex items-center gap-4">
        <label className="text-sm">I/O Address Range</label>
        <select
          value={ioRange}
          onChange={(e) => setIoRange(e.target.value)}
          className="text-sm"
          disabled={!activeInstanceId}
        >
          {IO_RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        <label className="text-sm">Row Count</label>
        <select
          value={rowCount}
          onChange={(e) => setRowCount(e.target.value)}
          disabled={!activeInstanceId}
          className="text-sm"
        >
          {ROW_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          onClick={loadData}
          disabled={!activeInstanceId}
          className="px-2 py-1 bg-slate-600 hover:bg-slate-500 rounded text-xs disabled:opacity-50"
        >
          Refresh
        </button>
        <div className="ml-auto text-sm">
          {activeInstance ? (
            <>
              Active: <span className="font-mono text-sky-400">{activeInstance.id}</span>
              {" | "}
              Cell Address:{" "}
              <span className="font-mono text-yellow-400">
                {selectedAddr !== null ? formatAddress(ioRange, selectedAddr) : ""}
              </span>
            </>
          ) : (
            <span className="text-slate-500">Select a slave instance to view data</span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2 pt-0">
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
