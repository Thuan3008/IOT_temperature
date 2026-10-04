/**
 * SmartColdChain IoT — Main Dashboard (main.jsx)
 *
 * Kiến trúc:
 *  ┌─ App (root state, auto-refresh)
 *  │   ├─ Sidebar
 *  │   └─ Main content
 *  │       ├─ TopBar
 *  │       ├─ TripBanner
 *  │       ├─ KpiGrid  (4 metric cards)
 *  │       ├─ ControlPanel
 *  │       ├─ ContentGrid
 *  │       │   ├─ TrendChart (SVG)
 *  │       │   └─ SensorList
 *  │       ├─ HistoryTable
 *  │       └─ TripMap (Leaflet)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import TripMap, { isValidLocation } from "./components/TripMap";
import DriverView from "./components/DriverView";
import ControlPanel from "./components/ControlPanel";
import "./style.css";

/* ──────────────── CONSTANTS ──────────────── */

const API_BASE    = import.meta.env.VITE_API_URL || "http://localhost:3000";
const SENSOR_IDS  = ["S1", "S2", "S3", "S4", "S5"];
const SENSOR_NAMES = {
  S1: "Gần dàn lạnh",
  S2: "Trung tâm khoang",
  S3: "Gần cửa",
  S4: "Góc đọng nhiệt",
  S5: "Vùng dự phòng",
};
const CHART_COLORS = ["#0d9488", "#2563eb", "#d97706", "#dc2626", "#7c3aed"];
const DEFAULT_LIMITS = { min: 3, max: 8 };

/* ──────────────── HELPERS ──────────────── */

function formatTime(value) {
  if (!value) return "Chưa có dữ liệu";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatTimeShort(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function getReadings(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.value)) return payload.value;
  return [];
}

function getPacketGroups(readings) {
  const groups = new Map();
  for (const r of readings) {
    const key = String(r.packet_id);
    if (!groups.has(key)) groups.set(key, { ...r, sensors: [] });
    groups.get(key).sensors.push(r);
  }
  return [...groups.values()].sort(
    (a, b) => new Date(b.measured_at) - new Date(a.measured_at)
  );
}

function classifyTemp(temp, limits) {
  if (temp == null || !Number.isFinite(temp)) return "offline";
  if (limits.min != null && temp < limits.min) return "alert";
  if (limits.max != null && temp > limits.max) return "alert";
  // Warn if within 1°C of limits
  const warnLow  = limits.min != null && temp < limits.min + 1;
  const warnHigh = limits.max != null && temp > limits.max - 1;
  if (warnLow || warnHigh) return "warn";
  return "normal";
}

const TRIP_STATE_LABELS = {
  IN_TRANSIT: "Đang vận chuyển",
  ARMED:      "Đã sẵn sàng",
  IDLE:       "Chưa khởi hành",
  COMPLETED:  "Đã hoàn thành",
};

/* ════════════════════════════════════════════════════════════════
   SIDEBAR
   ════════════════════════════════════════════════════════════════ */

function Sidebar({ health, activeSection, onNavigate }) {
  const navItems = [
    { id: "overview",  label: "Tổng quan",     icon: "⊞" },
    { id: "controls",  label: "Điều khiển",    icon: "⚙" },
    { id: "sensors",   label: "Cảm biến",      icon: "◉" },
    { id: "alerts",    label: "Cảnh báo",      icon: "⚠" },
    { id: "history",   label: "Lịch sử",       icon: "⊙" },
    { id: "trip-map",  label: "Bản đồ GPS",    icon: "⊕" },
  ];

  const statusText = {
    online:   "Hệ thống hoạt động",
    offline:  "Mất kết nối",
    checking: "Đang kết nối…",
  }[health] || "Đang kiểm tra…";

  return (
    <aside className="sidebar" role="navigation" aria-label="Điều hướng chính">
      {/* Brand */}
      <div className="sidebar-header">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">❄</div>
          <div className="brand-text">
            <span className="brand-name">ColdChain IoT</span>
            <span className="brand-sub">Smart Monitoring</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <div className="nav-section-label">Giám sát</div>
        {navItems.map(({ id, label, icon }) => (
          <button
            key={id}
            className={`nav-item${activeSection === id ? " active" : ""}`}
            onClick={() => onNavigate(id)}
            aria-current={activeSection === id ? "page" : undefined}
          >
            <span className="nav-icon" aria-hidden="true">{icon}</span>
            {label}
          </button>
        ))}
      </nav>

      {/* Footer status */}
      <div className="sidebar-footer">
        <div className="system-status">
          <span className={`status-indicator ${health}`} aria-hidden="true" />
          <span>{statusText}</span>
        </div>
      </div>
    </aside>
  );
}

/* ════════════════════════════════════════════════════════════════
   TOP BAR
   ════════════════════════════════════════════════════════════════ */

function TopBar({ health, lastChecked, onRefresh, isRefreshing, onDriverMode }) {
  const badgeLabel = {
    online:   "Đang hoạt động",
    offline:  "Mất kết nối",
    checking: "Đang kiểm tra",
  }[health] || "—";

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="page-label">Smart Cold Chain / Dashboard</div>
        <h1 className="page-title">Giám sát vận chuyển lạnh</h1>
      </div>

      <div className="topbar-right">
        {/* Driver Mode button */}
        <button
          className="btn btn-driver-mode"
          onClick={onDriverMode}
          title="Mở chế độ lái xe — toàn màn hình, không cuộn"
        >
          🚛 Chế độ lái xe
        </button>

        {/* Connection status */}
        <div className={`connection-badge ${health}`} role="status" aria-live="polite">
          <span className="badge-dot" aria-hidden="true" />
          {badgeLabel}
        </div>

        {/* Last updated */}
        {lastChecked && (
          <span className="updated-at-label" aria-live="polite">
            {formatTimeShort(lastChecked)}
          </span>
        )}

        {/* Refresh button */}
        <button
          className={`icon-button${isRefreshing ? " spinning" : ""}`}
          onClick={onRefresh}
          aria-label="Làm mới dữ liệu"
          title="Làm mới"
          disabled={isRefreshing}
        >
          ↻
        </button>
      </div>
    </header>
  );
}

/* ════════════════════════════════════════════════════════════════
   TRIP BANNER
   ════════════════════════════════════════════════════════════════ */

function TripBanner({ tripId, deviceId, tripState, limits, vehiclePlate }) {
  const stateLabel = TRIP_STATE_LABELS[tripState] || tripState || "—";

  return (
    <section className="trip-banner" id="overview" aria-label="Thông tin chuyến hiện tại">
      <div className="trip-emoji" aria-hidden="true">🚚</div>

      <div className="trip-info">
        <div className="trip-eyebrow">Chuyến đang theo dõi</div>
        <div className="trip-id">{tripId}</div>
        <div className="trip-meta">
          <span>Thiết bị {deviceId}</span>
          <span className="trip-meta-sep">·</span>
          <span>ESP32 · 5 cảm biến DHT22</span>
          {vehiclePlate && (
            <>
              <span className="trip-meta-sep">·</span>
              <span>{vehiclePlate}</span>
            </>
          )}
        </div>
      </div>

      <div className="trip-state-pill">
        <span className="state-pulse" aria-hidden="true" />
        {stateLabel.toUpperCase()}
      </div>

      <div className="trip-threshold-box">
        <div className="trip-threshold-label">Khoảng nhiệt độ</div>
        <div className="trip-threshold-value">
          {limits.min == null ? "—" : `${limits.min}°C`}
          <span style={{ fontSize: 11, fontWeight: 400, margin: "0 6px", opacity: 0.65 }}>đến</span>
          {limits.max == null ? "—" : `${limits.max}°C`}
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   KPI GRID (4 metric cards)
   ════════════════════════════════════════════════════════════════ */

function KpiGrid({ latestPacket, packets, latestBySensor, limits, outOfRange }) {
  const temperatures = [...latestBySensor.values()].map((r) => r.temperature).filter(Number.isFinite);
  const humidities   = [...latestBySensor.values()].map((r) => r.humidity).filter(Number.isFinite);
  const maxTemp      = temperatures.length ? Math.max(...temperatures) : null;
  const avgHum       = humidities.length
    ? (humidities.reduce((a, b) => a + b, 0) / humidities.length)
    : null;
  const doorStatus   = latestPacket?.door_status || null;
  const onlineCount  = [...latestBySensor.values()].filter((r) => r.sensor_status === "ONLINE").length;

  const cards = [
    {
      label: "Nhiệt độ cao nhất",
      value: maxTemp != null ? `${maxTemp.toFixed(1)}°C` : "—",
      icon: "🌡",
      iconClass: outOfRange > 0 ? "red" : "teal",
      sub: outOfRange > 0
        ? `⚠ ${outOfRange} cảm biến ngoài ngưỡng!`
        : "Trong giới hạn bảo quản",
      trend: outOfRange > 0 ? "bad" : "ok",
      trendLabel: outOfRange > 0 ? "Cảnh báo" : "Bình thường",
      isAlert: outOfRange > 0,
    },
    {
      label: "Độ ẩm trung bình",
      value: avgHum != null ? `${avgHum.toFixed(0)}%` : "—",
      icon: "💧",
      iconClass: "blue",
      sub: "Trung bình các cảm biến hoạt động",
      trend: "ok",
      trendLabel: "Bình thường",
    },
    {
      label: "Trạng thái cửa khoang",
      value: doorStatus || "—",
      icon: doorStatus === "CLOSED" ? "🔒" : doorStatus === "OPEN" ? "🔓" : "⊡",
      iconClass: doorStatus === "CLOSED" ? "teal" : doorStatus === "OPEN" ? "amber" : "blue",
      sub: doorStatus === "CLOSED"
        ? "Khoang hàng đang đóng kín"
        : doorStatus === "OPEN"
        ? "Cửa đang mở — theo dõi chặt"
        : "Chưa nhận trạng thái",
      trend: doorStatus === "OPEN" ? "warn" : "ok",
      trendLabel: doorStatus === "OPEN" ? "Mở cửa" : "Đóng cửa",
    },
    {
      label: "Cảm biến hoạt động",
      value: `${onlineCount}/5`,
      icon: "📡",
      iconClass: onlineCount < 5 ? "amber" : "green",
      sub: `${packets.length} bản tin đã nhận`,
      trend: onlineCount < 3 ? "bad" : onlineCount < 5 ? "warn" : "ok",
      trendLabel: onlineCount === 5 ? "Tất cả online" : `${5 - onlineCount} offline`,
    },
  ];

  return (
    <div className="kpi-grid" role="list" aria-label="Thông số nhanh">
      {cards.map((card) => (
        <article
          key={card.label}
          className={`kpi-card${card.isAlert ? " alert-card" : ""}`}
          role="listitem"
        >
          <div className="kpi-header">
            <div className="kpi-label">{card.label}</div>
            <div className={`kpi-icon ${card.iconClass}`} aria-hidden="true">
              {card.icon}
            </div>
          </div>
          <div className="kpi-value">{card.value}</div>
          <div className="kpi-sub">{card.sub}</div>
          {card.trend && (
            <div className={`kpi-trend ${card.trend}`}>{card.trendLabel}</div>
          )}
        </article>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   CONTROL PANEL
   ════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════
   TREND CHART
   ════════════════════════════════════════════════════════════════ */

function TrendChart({ packets, limits }) {
  const points = useMemo(() => [...packets].reverse().slice(-24), [packets]);

  if (!points.length) {
    return (
      <div className="chart-empty">
        <div className="chart-empty-icon">📊</div>
        <div>Đang chờ dữ liệu telemetry từ ESP32…</div>
      </div>
    );
  }

  const W = 740, H = 210;
  const pad = { top: 18, right: 16, bottom: 30, left: 44 };

  const allValues = points.flatMap((p) =>
    p.sensors.map((s) => s.temperature).filter(Number.isFinite)
  );
  const minVal = Math.min(limits.min ?? Math.min(...allValues), ...allValues) - 1;
  const maxVal = Math.max(limits.max ?? Math.max(...allValues), ...allValues) + 1;
  const range  = maxVal - minVal || 1;

  const px = (i) =>
    pad.left + (points.length === 1 ? 0 : (i * (W - pad.left - pad.right)) / (points.length - 1));
  const py = (v) =>
    pad.top + ((maxVal - v) * (H - pad.top - pad.bottom)) / range;

  const ticks = [minVal, (minVal + maxVal) / 2, maxVal];

  return (
    <>
      <div className="chart-wrapper">
        <svg
          className="trend-chart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Biểu đồ nhiệt độ 5 cảm biến theo thời gian"
        >
          {/* Grid lines */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.left} x2={W - pad.right}
                y1={py(t)}    y2={py(t)}
                className="gridline"
              />
              <text
                x={pad.left - 8}
                y={py(t) + 4}
                textAnchor="end"
                className="axis-label"
              >
                {t.toFixed(1)}°
              </text>
            </g>
          ))}

          {/* Limit lines */}
          {[limits.min, limits.max].filter((v) => v != null).map((v) => (
            <line
              key={v}
              x1={pad.left} x2={W - pad.right}
              y1={py(v)}    y2={py(v)}
              className="limit-line"
            />
          ))}

          {/* Sensor polylines */}
          {SENSOR_IDS.map((id, idx) => {
            const coords = points
              .map((p, i) => {
                const r = p.sensors.find((s) => s.sensor_id === id);
                return r && Number.isFinite(r.temperature)
                  ? `${px(i)},${py(r.temperature)}`
                  : null;
              })
              .filter(Boolean);
            return coords.length ? (
              <polyline
                key={id}
                points={coords.join(" ")}
                fill="none"
                stroke={CHART_COLORS[idx]}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null;
          })}

          {/* X-axis labels */}
          <text x={pad.left}      y={H - 6} className="axis-label">Cũ hơn</text>
          <text x={W - pad.right} y={H - 6} textAnchor="end" className="axis-label">Mới nhất</text>
        </svg>
      </div>

      <div className="chart-legend" aria-label="Chú thích biểu đồ">
        {SENSOR_IDS.map((id, i) => (
          <div key={id} className="legend-item">
            <span className="legend-dot" style={{ background: CHART_COLORS[i] }} aria-hidden="true" />
            {id} · {SENSOR_NAMES[id]}
          </div>
        ))}
        <div className="legend-item">
          <span className="legend-dash" aria-hidden="true" />
          Ngưỡng bảo quản
        </div>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   SENSOR LIST
   ════════════════════════════════════════════════════════════════ */

function SensorList({ latestBySensor, limits }) {
  const onlineCount = [...latestBySensor.values()].filter(
    (r) => r.sensor_status === "ONLINE"
  ).length;

  return (
    <>
      <div className="sensor-list" role="list" aria-label="Danh sách cảm biến">
        {SENSOR_IDS.map((id) => {
          const sensor = latestBySensor.get(id);
          const status = sensor?.sensor_status || "NO DATA";
          const temp   = sensor?.temperature;
          const hum    = sensor?.humidity;
          const cls    = classifyTemp(temp, limits);

          const dotClass = status === "ONLINE" ? "ok" : "offline";

          return (
            <div key={id} className={`sensor-row ${status === "ONLINE" ? "" : "offline"}`} role="listitem">
              <div className={`sensor-avatar ${cls}`} aria-hidden="true">
                {id}
              </div>

              <div className="sensor-info">
                <div className="sensor-id">{id} · {SENSOR_NAMES[id]}</div>
                <div className="sensor-status-text">
                  {status === "ONLINE" ? "Đang hoạt động" : status}
                </div>
              </div>

              <div className="sensor-readings">
                <div className={`sensor-temp${cls !== "normal" && cls !== "offline" ? ` ${cls}` : ""}`}>
                  {temp == null ? "N/A" : `${Number(temp).toFixed(1)}°C`}
                </div>
                <div className="sensor-hum">
                  {hum == null ? "N/A" : `${Number(hum).toFixed(0)}% RH`}
                </div>
              </div>

              <span
                className={`sensor-status-dot ${dotClass}`}
                title={status}
                aria-label={`Trạng thái: ${status}`}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   HISTORY TABLE
   ════════════════════════════════════════════════════════════════ */

function HistoryTable({ packets, lastChecked }) {
  return (
    <section className="panel history-panel" id="history" aria-label="Lịch sử bản tin telemetry">
      <div className="panel-header">
        <div className="panel-title-group">
          <div className="panel-eyebrow">Telemetry MQTT</div>
          <div className="panel-title">Bản tin gần đây</div>
        </div>
        <span className="updated-at-label">
          {lastChecked ? `Đồng bộ ${formatTimeShort(lastChecked)}` : "Đang đồng bộ…"}
        </span>
      </div>

      {packets.length ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Packet</th>
                <th>Thời gian đo</th>
                <th>Thiết bị / Chuyến</th>
                <th>Cảm biến</th>
                <th>Cửa</th>
                <th>GPS</th>
                <th>Nguồn</th>
              </tr>
            </thead>
            <tbody>
              {packets.slice(0, 15).map((p) => (
                <tr key={p.packet_id}>
                  <td>
                    <span className="packet-id">#{p.packet_id}</span>
                  </td>
                  <td>{formatTime(p.measured_at)}</td>
                  <td>
                    <div className="device-info">
                      <strong>{p.device_id}</strong>
                      <small>{p.trip_id}</small>
                    </div>
                  </td>
                  <td>
                    <span className="reading-badge">{p.sensors.length} / 5</span>
                  </td>
                  <td>
                    <span className={`door-tag ${p.door_status === "CLOSED" ? "closed" : "open"}`}>
                      {p.door_status || "—"}
                    </span>
                  </td>
                  <td>
                    {p.latitude == null ? (
                      <span style={{ color: "var(--color-text-4)" }}>—</span>
                    ) : (
                      <span className="gps-coords">
                        {Number(p.latitude).toFixed(4)}, {Number(p.longitude).toFixed(4)}
                      </span>
                    )}
                  </td>
                  <td>
                    {p.is_buffered ? (
                      <span className="buffer-tag">BUFFERED</span>
                    ) : (
                      <span style={{ color: "var(--color-text-4)", fontSize: 11 }}>Trực tiếp</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state" role="status">
          <div className="empty-state-icon">📭</div>
          <div className="empty-state-title">Chưa có bản tin</div>
          <p className="empty-state-sub">
            Publish telemetry lên MQTT broker để bắt đầu giám sát hành trình.
          </p>
        </div>
      )}
    </section>
  );
}

function AlertPanel({ alerts, onResolve }) {
  const [tab, setTab] = useState("OPEN");
  const [pendingId, setPendingId] = useState(null);
  const [actionError, setActionError] = useState("");
  const visible = alerts.filter((alert) => alert.status === tab);
  const openCount = alerts.filter((alert) => alert.status === "OPEN").length;

  async function handleResolve(alertId) {
    setPendingId(alertId);
    setActionError("");
    try {
      await onResolve(alertId);
    } catch (error) {
      setActionError(error.message || "Không thể xử lý cảnh báo");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="panel alerts-panel" id="alerts" aria-label="Quản lý cảnh báo">
      <div className="panel-header">
        <div className="panel-title-group">
          <div className="panel-eyebrow">Alert Management</div>
          <div className="panel-title">Cảnh báo <span className="alert-count">{openCount} đang mở</span></div>
        </div>
        <div className="alert-tabs" role="tablist" aria-label="Trạng thái cảnh báo">
          <button type="button" role="tab" aria-selected={tab === "OPEN"} className={tab === "OPEN" ? "selected" : ""} onClick={() => setTab("OPEN")}>Đang mở</button>
          <button type="button" role="tab" aria-selected={tab === "RESOLVED"} className={tab === "RESOLVED" ? "selected" : ""} onClick={() => setTab("RESOLVED")}>Đã xử lý</button>
        </div>
      </div>
      {actionError && <div className="alert-action-error" role="alert">{actionError}</div>}
      {visible.length ? (
        <div className="alert-list">
          {visible.map((alert) => (
            <div className="alert-row" key={alert.alert_id}>
              <div className="alert-row-main">
                <div className="alert-row-heading">
                  <strong>{alert.alert_type}</strong>
                  {alert.sensor_id && <span className="alert-sensor">{alert.sensor_id}</span>}
                  <span className={`alert-status ${alert.status === "OPEN" ? "open" : "resolved"}`}>
                    {alert.status === "OPEN" ? "Đang mở" : "Đã xử lý"}
                  </span>
                </div>
                <p>{alert.message || "Không có mô tả"}</p>
                <small>#{alert.alert_id} · {formatTime(alert.created_at)}{alert.resolved_at ? ` · Xử lý ${formatTime(alert.resolved_at)}` : ""}</small>
              </div>
              {alert.status === "OPEN" && (
                <button type="button" className="alert-resolve-button" disabled={pendingId === alert.alert_id} onClick={() => handleResolve(alert.alert_id)}>
                  {pendingId === alert.alert_id ? "Đang xử lý…" : "Đã xử lý"}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state" role="status">
          <div className="empty-state-title">{tab === "OPEN" ? "Không có cảnh báo đang mở" : "Chưa có cảnh báo đã xử lý"}</div>
        </div>
      )}
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   APP (root)
   ════════════════════════════════════════════════════════════════ */

function App() {
  const [readings,      setReadings]      = useState([]);
  const [alerts,        setAlerts]        = useState([]);
  const [sensorStates,  setSensorStates]  = useState([]);
  const [deviceStates,  setDeviceStates]  = useState([]);
  const [health,        setHealth]        = useState("checking");
  const [limits,        setLimits]        = useState(DEFAULT_LIMITS);
  const [tripState,     setTripState]     = useState("IN_TRANSIT");
  const [deliveryMode,  setDeliveryMode]  = useState(false);
  const [error,         setError]         = useState("");
  const [lastChecked,   setLastChecked]   = useState(null);
  const [vehiclePlate,  setVehiclePlate]  = useState("");
  const [activeSection, setActiveSection] = useState("overview");
  const [isRefreshing,  setIsRefreshing]  = useState(false);
  const [driverMode,    setDriverMode]    = useState(false);

  /* ── Data fetch ── */
  const refresh = useCallback(async (manual = false) => {
    if (manual) setIsRefreshing(true);
    try {
      const [healthRes, telRes, sensorRes, deviceRes] = await Promise.all([
        fetch(`${API_BASE}/api/health`),
        fetch(`${API_BASE}/api/telemetry`),
        fetch(`${API_BASE}/api/sensors`),
        fetch(`${API_BASE}/api/devices`),
      ]);
      const healthData = await healthRes.json();
      if (!healthRes.ok) throw new Error(`API chưa sẵn sàng (${healthRes.status})`);

      const telData = await telRes.json();
      if (!telRes.ok) throw new Error(telData.message || "Không tải được telemetry");

      if (!sensorRes.ok || !deviceRes.ok) throw new Error("Không tải được trạng thái thiết bị/cảm biến");
      const [sensors, devices] = await Promise.all([sensorRes.json(), deviceRes.json()]);

      const next = getReadings(telData);
      setReadings(next);
      setSensorStates(sensors);
      setDeviceStates(devices);
      setHealth(healthData.database === "SQL Server Connected" ? "online" : "offline");
      setError("");
      setLastChecked(new Date());

      const tripId = next[0]?.trip_id;
      const alertQuery = tripId ? `&tripId=${encodeURIComponent(tripId)}` : "";
      const [openRes, resolvedRes] = await Promise.all([
        fetch(`${API_BASE}/api/alerts?status=OPEN${alertQuery}`),
        fetch(`${API_BASE}/api/alerts?status=RESOLVED${alertQuery}`),
      ]);
      if (!openRes.ok || !resolvedRes.ok) throw new Error("Không tải được cảnh báo");
      const [openAlerts, resolvedAlerts] = await Promise.all([openRes.json(), resolvedRes.json()]);
      setAlerts([...openAlerts, ...resolvedAlerts]);
      if (tripId) {
        const tripRes = await fetch(`${API_BASE}/api/trips/${encodeURIComponent(tripId)}`);
        if (tripRes.ok) {
          const trip = await tripRes.json();
          setLimits({ min: trip.min_temperature ?? null, max: trip.max_temperature ?? null });
          setTripState(trip.trip_state || "UNKNOWN");
          setDeliveryMode(Boolean(trip.delivery_mode));
          setVehiclePlate(trip.vehicle_plate || "");
        }
      }
    } catch (e) {
      setHealth("offline");
      setError(e.message || "Không kết nối được backend");
    } finally {
      if (manual) setIsRefreshing(false);
    }
  }, []);

  async function handleResolveAlert(alertId) {
    const response = await fetch(`${API_BASE}/api/alerts/${encodeURIComponent(alertId)}/resolve`, { method: "PATCH" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Không thể xử lý cảnh báo");
    setAlerts((current) => current.map((alert) => alert.alert_id === alertId
      ? { ...alert, status: result.status, resolved_at: result.resolved_at }
      : alert));
  }

  /* Auto-refresh every 5 s */
  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  /* ── Derived data ── */
  const packets = useMemo(() => getPacketGroups(readings), [readings]);
  const latestPacket = packets[0];

  const tripId   = latestPacket?.trip_id   || "TRIP001";
  const deviceId = latestPacket?.device_id || "ESP32-01";
  const deviceOffline = deviceStates.find((device) => device.device_id === deviceId)?.status !== "ONLINE";

  const latestBySensor = useMemo(() => {
    const map = new Map();
    for (const r of readings) {
      if (r.device_id === deviceId && r.trip_id === tripId && !map.has(r.sensor_id)) map.set(r.sensor_id, r);
    }
    for (const id of SENSOR_IDS) {
      const reading = map.get(id);
      const state = sensorStates.find((sensor) => sensor.device_id === deviceId && sensor.sensor_id === id);
      const status = deviceOffline ? "OFFLINE" : (state?.status || "OFFLINE");
      // SQL status phản ánh timeout/LWT mới nhất; không dùng số đo trong packet cũ.
      map.set(id, { ...reading, sensor_id: id, sensor_status: status,
        temperature: status === "ONLINE" ? reading?.temperature ?? null : null,
        humidity: status === "ONLINE" ? reading?.humidity ?? null : null });
    }
    return map;
  }, [readings, sensorStates, deviceOffline, deviceId, tripId]);

  const outOfRange = useMemo(
    () =>
      [...latestBySensor.values()].filter(
        (r) =>
          r.temperature != null &&
          ((limits.min != null && r.temperature < limits.min) ||
           (limits.max != null && r.temperature > limits.max))
      ).length,
    [latestBySensor, limits]
  );

  const routeHistory = useMemo(
    () =>
      packets
        .filter(
          (p) => p.trip_id === tripId && p.device_id === deviceId && isValidLocation(p)
        )
        .map((p) => ({ latitude: p.latitude, longitude: p.longitude, timestamp: p.measured_at }))
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
    [packets, tripId, deviceId]
  );

  const currentLocation = routeHistory.at(-1) || null;
  const temperatures = [...latestBySensor.values()].map((r) => r.temperature).filter(Number.isFinite);

  /* ── Section navigation ── */
  function navigateTo(sectionId) {
    setActiveSection(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ── Render ── */
  return (
    <div className="app-shell">

      {/* ═══ DRIVER MODE (fullscreen, no scroll) ═══ */}
      {driverMode && (
        <DriverView
          currentLocation={currentLocation}
          routeHistory={routeHistory}
          latestBySensor={latestBySensor}
          limits={limits}
          latestPacket={latestPacket}
          deliveryMode={deliveryMode}
          tripId={tripId}
          vehiclePlate={vehiclePlate}
          onExitDriverMode={() => setDriverMode(false)}
        />
      )}

      <Sidebar
        health={health}
        activeSection={activeSection}
        onNavigate={navigateTo}
      />

      <div className="main-content">
        <div className="main-inner">
          {/* Top bar */}
          <TopBar
            health={health}
            lastChecked={lastChecked}
            onRefresh={() => refresh(true)}
            isRefreshing={isRefreshing}
            onDriverMode={() => setDriverMode(true)}
          />

          {/* Error banner */}
          {error && (
            <div className="error-banner" role="alert">
              <span className="error-banner-icon">⚠️</span>
              <div>
                <strong>Không tải được dữ liệu.</strong> {error}.{" "}
                Kiểm tra backend tại <code>{API_BASE}</code>.
              </div>
            </div>
          )}

          {/* Trip hero */}
          <TripBanner
            tripId={tripId}
            deviceId={deviceId}
            tripState={tripState}
            limits={limits}
            vehiclePlate={vehiclePlate}
          />

          {/* KPI cards */}
          <KpiGrid
            latestPacket={latestPacket}
            packets={packets}
            latestBySensor={latestBySensor}
            limits={limits}
            outOfRange={outOfRange}
          />

          {/* Control Panel */}
          <ControlPanel
            deviceId={deviceId}
            tripId={tripId}
            deliveryMode={deliveryMode}
            setDeliveryMode={setDeliveryMode}
            limits={limits}
            onStarted={(result) => {
              if (result.tripState) setTripState(result.tripState);
              if (result.Tmin != null || result.Tmax != null)
                setLimits({ min: result.Tmin, max: result.Tmax });
            }}
          />

          {/* Chart + Sensors */}
          <div className="content-grid">
            <article className="panel" id="chart-panel" aria-label="Biểu đồ nhiệt độ">
              <div className="panel-header">
                <div className="panel-title-group">
                  <div className="panel-eyebrow">Nhiệt độ theo thời gian</div>
                  <div className="panel-title">Diễn biến nhiệt độ</div>
                </div>
                <div className="live-badge">
                  <span className="live-dot" aria-hidden="true" />
                  LIVE · 5 GIÂY
                </div>
              </div>
              <TrendChart packets={packets} limits={limits} />
            </article>

            <article className="panel" id="sensors" aria-label="Danh sách cảm biến">
              <div className="panel-header">
                <div className="panel-title-group">
                  <div className="panel-eyebrow">Thiết bị ESP32</div>
                  <div className="panel-title">Cảm biến</div>
                </div>
                <span className="sensor-count-badge">
                  {[...latestBySensor.values()].filter((r) => r.sensor_status === "ONLINE").length}/5 online
                </span>
              </div>
              <SensorList latestBySensor={latestBySensor} limits={limits} />
            </article>
          </div>

          <AlertPanel alerts={alerts} onResolve={handleResolveAlert} />

          {/* History table */}
          <HistoryTable packets={packets} lastChecked={lastChecked} />

          {/* Map */}
          <section className="panel map-panel" id="trip-map" aria-label="Bản đồ hành trình">
            <div className="panel-header">
              <div className="panel-title-group">
                <div className="panel-eyebrow">GPS / Hành trình</div>
                <div className="panel-title">Vị trí xe tải</div>
              </div>
              <span className="updated-at-label">
                {routeHistory.length} điểm ·{" "}
                {currentLocation ? formatTimeShort(currentLocation.timestamp) : "Đang chờ GPS"}
              </span>
            </div>
            <TripMap
              currentLocation={currentLocation}
              routeHistory={routeHistory}
              tripInfo={{
                tripId,
                vehiclePlate,
                currentTemp: temperatures.length ? Math.max(...temperatures) : null,
                doorStatus:  latestPacket?.door_status,
              }}
            />
          </section>

          {/* Footer */}
          <footer className="page-footer">
            <span>Smart Cold Chain IoT</span>
            <span>·</span>
            <span>Tự động làm mới mỗi 5 giây</span>
            <span>·</span>
            <span>API: {API_BASE}</span>
          </footer>
        </div>
      </div>
    </div>
  );
}

/* ── Mount ── */
createRoot(document.getElementById("root")).render(<App />);

