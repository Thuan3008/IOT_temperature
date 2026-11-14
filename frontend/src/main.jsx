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
import TripMap, {
  isValidLocation,
  LOGISTICS_HUBS,
  PLANNED_ROUTE,
  calculateBearing,
} from "./components/TripMap";
import DriverView from "./components/DriverView";
import ControlPanel from "./components/ControlPanel";
import DemoScenarioPanel from "./components/DemoScenarioPanel";
import TripReportView from "./components/TripReportView";
import RouteManagementView from "./components/RouteManagementView";
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

function mergeLiveReadings(persisted, liveRows) {
  const savedIds = new Set(persisted.map((row) => row.message_id).filter(Boolean));
  return [
    ...liveRows.filter((row) => !savedIds.has(row.message_id)),
    ...persisted,
  ].sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at)).slice(0, 1000);
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
   SIDEBAR & NAVIGATION
   ════════════════════════════════════════════════════════════════ */

const SECTION_METAS = {
  overview: {
    label: "Smart Cold Chain / Tổng quan",
    title: "Tổng quan giám sát vận chuyển",
  },
  controls: {
    label: "Smart Cold Chain / Điều khiển",
    title: "Bảng điều khiển & Cài đặt hành trình",
  },
  routes: {
    label: "Smart Cold Chain / Quản lý tuyến",
    title: "Quản lý các tuyến đường & Điều phối chuyến vận chuyển",
  },
  sensors: {
    label: "Smart Cold Chain / Cảm biến",
    title: "Giám sát chi tiết 5 cảm biến DHT22",
  },
  alerts: {
    label: "Smart Cold Chain / Cảnh báo",
    title: "Trung tâm quản lý cảnh báo & Sự cố",
  },
  history: {
    label: "Smart Cold Chain / Lịch sử",
    title: "Lịch sử dữ liệu Telemetry & Bộ đệm",
  },
  "trip-map": {
    label: "Smart Cold Chain / Bản đồ GPS",
    title: "Bản đồ lộ trình & Định vị xe trực tiếp",
  },
  reports: {
    label: "Smart Cold Chain / Báo cáo",
    title: "Báo cáo cuối chuyến hàng & Xuất chứng nhận",
  },
};

function Sidebar({ health, activeSection, onNavigate, openAlertsCount = 0 }) {
  const navItems = [
    { id: "overview",  label: "Tổng quan",     icon: "⊞" },
    { id: "controls",  label: "Điều khiển",    icon: "⚙" },
    { id: "routes",    label: "Quản lý tuyến", icon: "🛣️" },
    { id: "sensors",   label: "Cảm biến",      icon: "◉" },
    { id: "alerts",    label: "Cảnh báo",      icon: "⚠", badge: openAlertsCount },
    { id: "history",   label: "Lịch sử",       icon: "⊙" },
    { id: "trip-map",  label: "Bản đồ GPS",    icon: "⊕" },
    { id: "reports",   label: "Báo cáo chuyến",icon: "📋" },
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
        {navItems.map(({ id, label, icon, badge }) => (
          <button
            key={id}
            className={`nav-item${activeSection === id ? " active" : ""}`}
            onClick={() => onNavigate(id)}
            aria-current={activeSection === id ? "page" : undefined}
          >
            <span className="nav-icon" aria-hidden="true">{icon}</span>
            <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
            {Boolean(badge) && <span className="nav-badge">{badge}</span>}
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

function TopBar({ health, lastChecked, onRefresh, isRefreshing, onDriverMode, activeSection, onNavigate }) {
  const meta = SECTION_METAS[activeSection] || SECTION_METAS.overview;
  const badgeLabel = {
    online:   "Đang hoạt động",
    offline:  "Mất kết nối",
    checking: "Đang kiểm tra",
  }[health] || "—";

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="page-label">{meta.label}</div>
        <h1 className="page-title">{meta.title}</h1>
      </div>

      <div className="topbar-right">
        {/* Nút Demo kịch bản một nút bấm */}
        <button
          className="btn btn-demo-shortcut"
          type="button"
          onClick={() => {
            if (onNavigate) {
              onNavigate("controls");
              setTimeout(() => {
                const el = document.getElementById("demo-scenarios");
                if (el) el.scrollIntoView({ behavior: "smooth" });
              }, 100);
            }
          }}
          title="Chạy kịch bản demo mất mạng và xả đệm một nút bấm"
        >
          ⚡ Demo mất mạng
        </button>

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

function TripBanner({ tripId, deviceId, tripState, limits, vehiclePlate, onNavigate }) {
  const stateLabel = TRIP_STATE_LABELS[tripState] || tripState || "—";
  const isCompleted = tripState === "COMPLETED";

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

      {onNavigate && (
        <button
          className="quick-card-btn"
          style={{
            marginLeft: "auto",
            background: isCompleted ? "var(--color-primary)" : "rgba(255, 255, 255, 0.08)",
            color: "var(--color-text)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            padding: "8px 14px",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6
          }}
          onClick={() => onNavigate("reports")}
          title="Xem báo cáo tổng kết chuyến hàng & Xuất file"
        >
          📋 {isCompleted ? "Xem báo cáo đã chốt" : "Báo cáo cuối chuyến"}
        </button>
      )}
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

function HistoryTable({ packets, lastChecked, limit = 50 }) {
  return (
    <section className="panel history-panel" id="history" aria-label="Lịch sử bản tin telemetry">
      <div className="panel-header">
        <div className="panel-title-group">
          <div className="panel-eyebrow">Telemetry MQTT</div>
          <div className="panel-title">
            Bản tin telemetry ({packets.length ? `${Math.min(packets.length, limit)} / ${packets.length}` : "0"})
          </div>
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
              {packets.slice(0, limit).map((p) => (
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
          <button type="button" role="tab" aria-selected={tab === "RESOLVED"} className={tab === "RESOLVED" ? "selected" : ""} onClick={() => setTab("RESOLVED")}>Đã xử lý / phục hồi</button>
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
                    {alert.status === "OPEN" ? "Đang mở" : alert.recovered_at ? "Đã phục hồi" : "Đã xử lý"}
                  </span>
                </div>
                <p>{alert.message || "Không có mô tả"}</p>
                <small>#{alert.alert_id} · Bắt đầu {formatTime(alert.created_at)}
                  {alert.occurrence_count > 1 ? ` · ${alert.occurrence_count} lần ghi nhận` : ""}
                  {alert.status === "OPEN" && alert.last_seen_at ? ` · Gần nhất ${formatTime(alert.last_seen_at)}` : ""}
                  {alert.recovered_at ? ` · Phục hồi ${formatTime(alert.recovered_at)}` : alert.resolved_at ? ` · Xử lý ${formatTime(alert.resolved_at)}` : ""}
                </small>
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
          <div className="empty-state-title">{tab === "OPEN" ? "Không có cảnh báo đang mở" : "Chưa có cảnh báo đã xử lý hoặc phục hồi"}</div>
        </div>
      )}
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   PAGE VIEWS (TỪNG TRANG RIÊNG BIỆT)
   ════════════════════════════════════════════════════════════════ */

/* ── 1. Trang Tổng quan ── */
function OverviewView({
  tripId,
  deviceId,
  tripState,
  limits,
  vehiclePlate,
  latestPacket,
  packets,
  latestBySensor,
  outOfRange,
  currentLocation,
  alerts,
  onNavigate,
  activeRoute,
}) {
  const openAlerts = alerts.filter((a) => a.status === "OPEN");

  return (
    <div className="page-view overview-view">
      <TripBanner
        tripId={tripId}
        deviceId={deviceId}
        tripState={tripState}
        limits={limits}
        vehiclePlate={vehiclePlate}
        onNavigate={onNavigate}
      />

      <KpiGrid
        latestPacket={latestPacket}
        packets={packets}
        latestBySensor={latestBySensor}
        limits={limits}
        outOfRange={outOfRange}
      />

      <div className="content-grid">
        <article className="panel" id="chart-panel" aria-label="Biểu đồ nhiệt độ">
          <div className="panel-header">
            <div className="panel-title-group">
              <div className="panel-eyebrow">Nhiệt độ theo thời gian</div>
              <div className="panel-title">Diễn biến nhiệt độ</div>
            </div>
            <div className="live-badge">
              <span className="live-dot" aria-hidden="true" />
              LIVE · 4 GIÂY
            </div>
          </div>
          <TrendChart packets={packets} limits={limits} />
        </article>

        <article className="panel" id="sensors-panel" aria-label="Danh sách cảm biến">
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

      <div className="quick-cards-grid">
        <div className="quick-card">
          <div>
            <div className="quick-card-header">
              <span className="quick-card-title">📍 Vị trí & Lộ trình xe</span>
              <span className="badge-dot" style={{ background: "var(--color-primary)" }} />
            </div>
            <div className="quick-card-body" style={{ marginTop: 8 }}>
              {currentLocation ? (
                <>
                  <div>Tọa độ hiện tại: <strong>{Number(currentLocation.latitude).toFixed(4)}, {Number(currentLocation.longitude).toFixed(4)}</strong></div>
                  <div className="quick-card-meta">
                    <span>Trạng thái: <strong>{currentLocation.vehicleStatus || "Đang chạy"}</strong></span>
                    <span>·</span>
                    <span>Cập nhật: {formatTimeShort(currentLocation.timestamp)}</span>
                  </div>
                </>
              ) : (
                <div>Đang kết nối GPS hoặc xe đang ở điểm xuất phát...</div>
              )}
            </div>
          </div>
          <button className="quick-card-btn" onClick={() => onNavigate("trip-map")}>
            Mở bản đồ GPS chi tiết →
          </button>
        </div>

        <div className="quick-card">
          <div>
            <div className="quick-card-header">
              <span className="quick-card-title">⚠️ Trạng thái cảnh báo</span>
              <span className={`badge-dot ${openAlerts.length > 0 ? "offline" : "online"}`} />
            </div>
            <div className="quick-card-body" style={{ marginTop: 8 }}>
              {openAlerts.length > 0 ? (
                <div style={{ color: "var(--color-danger)", fontWeight: 600 }}>
                  Có {openAlerts.length} cảnh báo đang mở cần kiểm tra ngay!
                </div>
              ) : (
                <div style={{ color: "var(--color-success)", fontWeight: 600 }}>
                  ✓ Toàn bộ cảm biến và cửa khoang nằm trong giới hạn an toàn.
                </div>
              )}
              <div className="quick-card-meta">
                <span>Tổng sự cố ghi nhận: {alerts.length}</span>
              </div>
            </div>
          </div>
          <button className="quick-card-btn" onClick={() => onNavigate("alerts")}>
            Quản lý cảnh báo →
          </button>
        </div>

        <div className="quick-card">
          <div>
            <div className="quick-card-header">
              <span className="quick-card-title">📋 Báo cáo cuối chuyến</span>
              <span className={`badge-dot ${tripState === "COMPLETED" ? "online" : "offline"}`} />
            </div>
            <div className="quick-card-body" style={{ marginTop: 8 }}>
              <div>
                Trạng thái: <strong>{tripState === "COMPLETED" ? "Đã kết thúc & sẵn sàng xuất file" : "Đang vận chuyển"}</strong>
              </div>
              <div className="quick-card-meta">
                <span>KPI: Thời gian, nhiệt độ Min/Max, vượt ngưỡng, cửa mở, mất mạng</span>
              </div>
            </div>
          </div>
          <button className="quick-card-btn" onClick={() => onNavigate("reports")}>
            Xem & Xuất CSV / PDF →
          </button>
        </div>

        <div className="quick-card">
          <div>
            <div className="quick-card-header">
              <span className="quick-card-title">🛣️ Quản lý các tuyến đường</span>
              <span className="badge-dot" style={{ background: "#2dd4bf" }} />
            </div>
            <div className="quick-card-body" style={{ marginTop: 8 }}>
              <div>
                Tuyến hiện tại: <strong>{activeRoute?.origin?.shortName || "Kho xuất phát"} ➔ {activeRoute?.destination?.shortName || "Điểm giao"}</strong>
              </div>
              <div className="quick-card-meta">
                <span>Cự ly: {activeRoute?.distanceKm} km · Dự kiến: {activeRoute?.durationMin} phút</span>
              </div>
            </div>
          </div>
          <button className="quick-card-btn" onClick={() => onNavigate("routes")}>
            Quản lý & Điều phối tuyến →
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 2. Trang Điều khiển ── */
function ControlsView({
  deviceId,
  tripId,
  deliveryMode,
  setDeliveryMode,
  limits,
  tripState,
  setTripState,
  setLimits,
  vehiclePlate,
  health,
  latestPacket,
  onRefresh,
  onNavigate,
  onTripStarted,
}) {
  return (
    <div className="page-view controls-view">
      <TripBanner
        tripId={tripId}
        deviceId={deviceId}
        tripState={tripState}
        limits={limits}
        vehiclePlate={vehiclePlate}
        onNavigate={onNavigate}
      />

      <ControlPanel
        deviceId={deviceId}
        tripId={tripId}
        deliveryMode={deliveryMode}
        setDeliveryMode={setDeliveryMode}
        limits={limits}
        onStarted={(result) => {
          if (onTripStarted) onTripStarted(result);
          if (result.tripState) setTripState(result.tripState);
          if (result.Tmin != null || result.Tmax != null)
            setLimits({ min: result.Tmin, max: result.Tmax });
        }}
      />

      {/* ── Kịch bản Demo Một Nút Bấm (ESP32 → MQTT → Backend → Dashboard) ── */}
      <DemoScenarioPanel
        deviceId={deviceId}
        tripId={tripId}
        health={health}
        onRefresh={onRefresh}
      />

      <div className="device-info-panel">
        <div className="panel-title-group">
          <div className="panel-eyebrow">Phần cứng & Hạ tầng IoT</div>
          <div className="panel-title">Thông số kết nối & Cấu hình thiết bị</div>
        </div>
        <div className="device-info-grid">
          <div className="device-info-item">
            <div className="device-info-label">Thiết bị IoT</div>
            <div className="device-info-value">{deviceId} (ESP32-WROOM)</div>
          </div>
          <div className="device-info-item">
            <div className="device-info-label">Mạng & Kết nối</div>
            <div className="device-info-value">{health === "online" ? "MQTT / WiFi Connected" : "Mất kết nối"}</div>
          </div>
          <div className="device-info-item">
            <div className="device-info-label">Biển số xe</div>
            <div className="device-info-value">{vehiclePlate || "Chưa gán biển số"}</div>
          </div>
          <div className="device-info-item">
            <div className="device-info-label">Cửa khoang hiện tại</div>
            <div className="device-info-value">{latestPacket?.door_status || "CLOSED"}</div>
          </div>
          <div className="device-info-item">
            <div className="device-info-label">Cơ chế đệm ngoại tuyến</div>
            <div className="device-info-value">Flash Ring Buffer (Tự động lưu khi mất mạng)</div>
          </div>
          <div className="device-info-item">
            <div className="device-info-label">Chu kỳ phát telemetry</div>
            <div className="device-info-value">4.0 giây / bản tin</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 3. Trang Cảm biến ── */
function SensorsView({
  latestBySensor,
  limits,
  packets,
  outOfRange,
}) {
  const onlineCount = [...latestBySensor.values()].filter(
    (r) => r.sensor_status === "ONLINE"
  ).length;

  const temps = [...latestBySensor.values()].map((r) => r.temperature).filter(Number.isFinite);
  const hums = [...latestBySensor.values()].map((r) => r.humidity).filter(Number.isFinite);
  const maxTemp = temps.length ? Math.max(...temps) : null;
  const minTemp = temps.length ? Math.min(...temps) : null;
  const avgHum = hums.length ? Math.round(hums.reduce((a, b) => a + b, 0) / hums.length) : null;

  return (
    <div className="page-view sensors-view">
      <div className="stats-summary-bar">
        <div className="stats-summary-card">
          <div className="stats-summary-label">Cảm biến Online</div>
          <div className="stats-summary-num" style={{ color: onlineCount === 5 ? "#15803d" : "#d97706" }}>
            {onlineCount}/5
          </div>
        </div>
        <div className={`stats-summary-card ${outOfRange > 0 ? "alert-highlight" : ""}`}>
          <div className="stats-summary-label">Ngoài ngưỡng nhiệt</div>
          <div className="stats-summary-num">{outOfRange}</div>
        </div>
        <div className="stats-summary-card">
          <div className="stats-summary-label">Nhiệt độ cao nhất</div>
          <div className="stats-summary-num">{maxTemp != null ? `${maxTemp.toFixed(1)}°C` : "—"}</div>
        </div>
        <div className="stats-summary-card">
          <div className="stats-summary-label">Nhiệt độ thấp nhất</div>
          <div className="stats-summary-num">{minTemp != null ? `${minTemp.toFixed(1)}°C` : "—"}</div>
        </div>
        <div className="stats-summary-card">
          <div className="stats-summary-label">Độ ẩm trung bình</div>
          <div className="stats-summary-num">{avgHum != null ? `${avgHum}%` : "—"}</div>
        </div>
      </div>

      <div className="sensor-cards-grid">
        {SENSOR_IDS.map((id) => {
          const sensor = latestBySensor.get(id);
          const status = sensor?.sensor_status || "NO DATA";
          const temp = sensor?.temperature;
          const hum = sensor?.humidity;
          const cls = classifyTemp(temp, limits);
          const isOnline = status === "ONLINE";

          return (
            <div key={id} className={`sensor-card-large ${cls} ${isOnline ? "" : "offline"}`}>
              <div className="sensor-card-top">
                <div className={`sensor-card-id-badge ${cls}`}>
                  {id}
                </div>
                <span className={`sensor-card-status-pill ${isOnline ? "online" : "offline"}`}>
                  {isOnline ? "ONLINE" : status}
                </span>
              </div>

              <div>
                <div className="sensor-card-title">{SENSOR_NAMES[id]}</div>
                <div className="sensor-card-loc">Cảm biến DHT22 · Vị trí khoang hàng</div>
              </div>

              <div className="sensor-card-metric-row">
                <div>
                  <div style={{ fontSize: 10, color: "var(--color-text-4)", fontWeight: 700, textTransform: "uppercase" }}>Nhiệt độ</div>
                  <div className={`sensor-card-temp-big ${cls}`}>
                    {temp != null ? `${Number(temp).toFixed(1)}°C` : "—"}
                  </div>
                </div>
                <div className="sensor-card-hum-box">
                  <div style={{ fontSize: 10, color: "var(--color-text-4)", fontWeight: 700, textTransform: "uppercase" }}>Độ ẩm</div>
                  <div className="sensor-card-hum-val">
                    {hum != null ? `${Number(hum).toFixed(0)}%` : "—"}
                  </div>
                </div>
              </div>

              <div className="sensor-card-range-badge">
                {cls === "normal" && <span className="text-success">✓ Trong ngưỡng ({limits.min}°C - {limits.max}°C)</span>}
                {cls === "warn" && <span className="text-warning">⚠ Tiệm cận ngưỡng ({limits.min}°C - {limits.max}°C)</span>}
                {cls === "alert" && <span className="text-danger">⛔ Vi phạm ngưỡng ({limits.min}°C - {limits.max}°C)!</span>}
                {cls === "offline" && <span className="text-muted">Chưa nhận tín hiệu</span>}
              </div>
            </div>
          );
        })}
      </div>

      <article className="panel" aria-label="Biểu đồ toàn cảnh 5 cảm biến">
        <div className="panel-header">
          <div className="panel-title-group">
            <div className="panel-eyebrow">Đồ thị thời gian thực</div>
            <div className="panel-title">Diễn biến nhiệt độ 5 cảm biến theo hành trình</div>
          </div>
          <div className="live-badge">
            <span className="live-dot" aria-hidden="true" />
            LIVE · 4 GIÂY
          </div>
        </div>
        <TrendChart packets={packets} limits={limits} />
      </article>
    </div>
  );
}

/* ── 4. Trang Cảnh báo ── */
function AlertsView({ alerts, onResolveAlert }) {
  const openCount = alerts.filter((a) => a.status === "OPEN").length;
  const resolvedCount = alerts.filter((a) => a.status === "RESOLVED").length;

  return (
    <div className="page-view alerts-view">
      <div className="stats-summary-bar">
        <div className={`stats-summary-card ${openCount > 0 ? "alert-highlight" : ""}`}>
          <div className="stats-summary-label">Cảnh báo đang mở (Cần xử lý)</div>
          <div className="stats-summary-num">{openCount}</div>
        </div>
        <div className="stats-summary-card">
          <div className="stats-summary-label">Đã xử lý / Tự phục hồi</div>
          <div className="stats-summary-num" style={{ color: "#15803d" }}>{resolvedCount}</div>
        </div>
        <div className="stats-summary-card">
          <div className="stats-summary-label">Tổng sự cố ghi nhận</div>
          <div className="stats-summary-num">{alerts.length}</div>
        </div>
        <div className="stats-summary-card">
          <div className="stats-summary-label">Tình trạng khoang</div>
          <div className="stats-summary-num" style={{ fontSize: 16, color: openCount > 0 ? "var(--color-danger)" : "var(--color-success)" }}>
            {openCount > 0 ? "⚠️ Cần kiểm tra ngay" : "✓ An toàn"}
          </div>
        </div>
      </div>

      <AlertPanel alerts={alerts} onResolve={onResolveAlert} />
    </div>
  );
}

/* ── 5. Trang Lịch sử ── */
function HistoryView({ packets, lastChecked }) {
  const bufferedCount = packets.filter((p) => p.is_buffered).length;
  const liveCount = packets.length - bufferedCount;

  return (
    <div className="page-view history-view">
      <div className="stats-summary-bar">
        <div className="stats-summary-card">
          <div className="stats-summary-label">Tổng số bản tin nhận</div>
          <div className="stats-summary-num">{packets.length}</div>
        </div>
        <div className="stats-summary-card">
          <div className="stats-summary-label">Bản tin trực tiếp (MQTT)</div>
          <div className="stats-summary-num" style={{ color: "#0d9488" }}>{liveCount}</div>
        </div>
        <div className="stats-summary-card">
          <div className="stats-summary-label">Bản tin đệm (Buffer recovered)</div>
          <div className="stats-summary-num" style={{ color: "#d97706" }}>{bufferedCount}</div>
        </div>
        <div className="stats-summary-card">
          <div className="stats-summary-label">Lần đồng bộ mới nhất</div>
          <div className="stats-summary-num" style={{ fontSize: 15, fontFamily: "var(--font-mono)" }}>
            {formatTimeShort(lastChecked)}
          </div>
        </div>
      </div>

      <HistoryTable packets={packets} lastChecked={lastChecked} limit={100} />
    </div>
  );
}

/* ── 6. Trang Bản đồ GPS ── */
function TripMapView({
  currentLocation,
  routeHistory,
  tripInfo,
  activeRoute,
  setActiveRoute,
  simState,
  setSimState,
}) {
  return (
    <div className="page-view trip-map-view full-map-container">
      <section className="panel map-panel" aria-label="Bản đồ hành trình GPS">
        <div className="panel-header">
          <div className="panel-title-group">
            <div className="panel-eyebrow">GPS / Định vị lộ trình vận tải lạnh</div>
            <div className="panel-title">Điều phối lộ trình & Giám sát vị trí xe tải</div>
          </div>
          <span className="updated-at-label">
            {routeHistory.length} tọa độ đã ghi ·{" "}
            {currentLocation ? formatTimeShort(currentLocation.timestamp) : "Đang chờ GPS"}
          </span>
        </div>
        <TripMap
          currentLocation={currentLocation}
          routeHistory={routeHistory}
          tripInfo={tripInfo}
          activeRoute={activeRoute}
          setActiveRoute={setActiveRoute}
          simState={simState}
          setSimState={setSimState}
        />
      </section>
    </div>
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
  const [liveState,     setLiveState]     = useState(null);
  const [currentTripId, setCurrentTripId] = useState(null);
  const liveRowsRef = useRef([]);

  /* ── Tuyến đường & Trạng thái mô phỏng đồng bộ toàn hệ thống (Option C) ── */
  const [activeRoute, setActiveRoute] = useState({
    controlMode: "custom", // "custom" | "live"
    origin: LOGISTICS_HUBS.origins[0],
    destination: LOGISTICS_HUBS.destinations[0],
    coordinates: PLANNED_ROUTE,
    distanceKm: 14.8,
    durationMin: 28,
  });

  const [simState, setSimState] = useState({
    simIndex: 0,
    isSimulating: false,
    simSpeed: 2,
    position: PLANNED_ROUTE[0],
    bearing: 45,
    isStopped: false,
    speedText: "0 km/h",
  });

  /* Timer chạy mô phỏng di chuyển xe (Chạy ngầm liên tục cho cả Dashboard & Driver Mode) */
  useEffect(() => {
    if (!simState.isSimulating) return;

    const intervalMs = Math.max(200, Math.round(1500 / simState.simSpeed));
    const timer = setInterval(() => {
      setSimState((prev) => {
        const coords = activeRoute.coordinates || [];
        if (prev.simIndex >= coords.length - 1) {
          return {
            ...prev,
            isSimulating: false,
            isStopped: true,
            speedText: "0 km/h",
          };
        }

        const nextIdx = prev.simIndex + 1;
        const curr = coords[prev.simIndex];
        const next = coords[nextIdx];
        let bearing = prev.bearing;
        if (curr && next && (curr[0] !== next[0] || curr[1] !== next[1])) {
          bearing = calculateBearing(curr[0], curr[1], next[0], next[1]);
        }

        const isStopped = nextIdx >= coords.length - 1;
        const speedText = isStopped
          ? "0 km/h"
          : `${Math.round(35 * (prev.simSpeed >= 5 ? 1.5 : 1))} km/h`;

        return {
          ...prev,
          simIndex: nextIdx,
          position: next || curr,
          bearing,
          isStopped,
          speedText,
          isSimulating: !isStopped,
        };
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [simState.isSimulating, simState.simSpeed, activeRoute.coordinates]);

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
      setReadings(mergeLiveReadings(next, liveRowsRef.current));
      setSensorStates(sensors);
      setDeviceStates(devices);
      setHealth(healthData.database === "SQL Server Connected" ? "online" : "offline");
      setError("");
      setLastChecked(new Date());

      // Tìm chuyến đang chạy từ Backend
      let activeTrip = null;
      try {
        const activeRes = await fetch(`${API_BASE}/api/trips/active?deviceId=ESP32-01`);
        if (activeRes.ok) activeTrip = await activeRes.json();
      } catch {}

      const effectiveTripId = currentTripId || activeTrip?.trip_id || next[0]?.trip_id;
      if (activeTrip && !currentTripId) {
        setCurrentTripId(activeTrip.trip_id);
      }

      const alertQuery = effectiveTripId ? `&tripId=${encodeURIComponent(effectiveTripId)}` : "";
      const [openRes, resolvedRes] = await Promise.all([
        fetch(`${API_BASE}/api/alerts?status=OPEN${alertQuery}`),
        fetch(`${API_BASE}/api/alerts?status=RESOLVED${alertQuery}`),
      ]);
      if (!openRes.ok || !resolvedRes.ok) throw new Error("Không tải được cảnh báo");
      const [openAlerts, resolvedAlerts] = await Promise.all([openRes.json(), resolvedRes.json()]);
      setAlerts([...openAlerts, ...resolvedAlerts]);

      if (activeTrip) {
        setLimits({ min: activeTrip.min_temperature ?? null, max: activeTrip.max_temperature ?? null });
        setTripState(activeTrip.trip_state || "UNKNOWN");
        setDeliveryMode(Boolean(activeTrip.delivery_mode));
        setVehiclePlate(activeTrip.vehicle_plate || "");
      } else if (effectiveTripId) {
        const tripRes = await fetch(`${API_BASE}/api/trips/${encodeURIComponent(effectiveTripId)}`);
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

  // MQTT samples reach this stream before the slower SQL history write.
  useEffect(() => {
    const stream = new EventSource(`${API_BASE}/api/live`);
    const onTelemetry = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!Array.isArray(data.sensors) || data.isBuffered) return;
        const messageId = data.messageId || `live-${Date.now()}`;
        const packetId = `live:${messageId}`;
        const rows = data.sensors.map((sensor) => ({
          packet_id: packetId,
          message_id: messageId,
          device_id: data.deviceId,
          trip_id: data.tripId,
          door_status: data.door,
          latitude: data.latitude,
          longitude: data.longitude,
          measured_at: data.timestamp,
          received_at: new Date().toISOString(),
          is_buffered: false,
          sensor_id: sensor.sensorId,
          sensor_status: sensor.status,
          temperature: sensor.temperature,
          humidity: sensor.humidity,
        }));
        liveRowsRef.current = [
          ...rows,
          ...liveRowsRef.current.filter((row) => row.message_id !== messageId),
        ].slice(0, 125);
        setLiveState({ deviceId: data.deviceId, tripId: data.tripId, packetId, messageId, receivedAt: Date.now() });
        setReadings((current) => mergeLiveReadings(current, liveRowsRef.current));
      } catch (error) {
        console.warn("Invalid live telemetry event:", error);
      }
    };
    stream.addEventListener("telemetry", onTelemetry);
    return () => { stream.removeEventListener("telemetry", onTelemetry); stream.close(); };
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
  // Wokwi's simulated clock can lag behind wall time. The packet that just
  // arrived over SSE is the current physical reading even if an SQL row has
  // a later measured_at timestamp.
  const freshLivePacket = liveState && Date.now() - liveState.receivedAt < 15000
    ? packets.find((packet) => packet.packet_id === liveState.packetId || packet.message_id === liveState.messageId)
    : null;
  const latestPacket = freshLivePacket || packets[0];
  const displayPackets = freshLivePacket
    ? [freshLivePacket, ...packets.filter((packet) => packet.packet_id !== freshLivePacket.packet_id)]
    : packets;

  const tripId   = currentTripId || latestPacket?.trip_id || "TRIP001";
  const deviceId = latestPacket?.device_id || "ESP32-01";
  const hasFreshLive = Boolean(freshLivePacket && liveState.deviceId === deviceId && liveState.tripId === tripId);
  const deviceOffline = !hasFreshLive && deviceStates.find((device) => device.device_id === deviceId)?.status !== "ONLINE";

  const latestBySensor = useMemo(() => {
    const map = new Map();
    if (hasFreshLive) {
      for (const reading of freshLivePacket.sensors) map.set(reading.sensor_id, reading);
    }
    for (const r of readings) {
      if (r.device_id === deviceId && r.trip_id === tripId && !map.has(r.sensor_id)) map.set(r.sensor_id, r);
    }
    for (const id of SENSOR_IDS) {
      const reading = map.get(id);
      const state = sensorStates.find((sensor) => sensor.device_id === deviceId && sensor.sensor_id === id);
      const status = deviceOffline ? "OFFLINE"
        : hasFreshLive ? (reading?.sensor_status || "OFFLINE") : (state?.status || "OFFLINE");
      // SQL status phản ánh timeout/LWT mới nhất; không dùng số đo trong packet cũ.
      map.set(id, { ...reading, sensor_id: id, sensor_status: status,
        temperature: status === "ONLINE" ? reading?.temperature ?? null : null,
        humidity: status === "ONLINE" ? reading?.humidity ?? null : null });
    }
    return map;
  }, [readings, sensorStates, deviceOffline, hasFreshLive, freshLivePacket, deviceId, tripId]);

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
        .map((p) => ({
          latitude: p.latitude,
          longitude: p.longitude,
          timestamp: p.measured_at,
          vehicleStatus: p.vehicle_status || p.vehicleStatus,
        }))
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
    [packets, tripId, deviceId]
  );

  const currentLocation = hasFreshLive && isValidLocation(latestPacket)
    ? {
        latitude: latestPacket.latitude,
        longitude: latestPacket.longitude,
        timestamp: latestPacket.measured_at,
        vehicleStatus: latestPacket.vehicle_status || latestPacket.vehicleStatus,
      }
    : routeHistory.at(-1) || null;
  const temperatures = [...latestBySensor.values()].map((r) => r.temperature).filter(Number.isFinite);

  /* ── Section navigation ── */
  function navigateTo(sectionId) {
    setActiveSection(sectionId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleEndTrip(result) {
    setTripState("COMPLETED");
    setActiveSection("reports");
    refresh(true);
  }

  function handleTripStarted(result) {
    if (result.tripId) setCurrentTripId(result.tripId);
    if (result.tripState) setTripState(result.tripState);
    if (result.Tmin != null || result.Tmax != null) {
      setLimits({ min: result.Tmin, max: result.Tmax });
    }
    refresh(true);
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
          activeRoute={activeRoute}
          setActiveRoute={setActiveRoute}
          simState={simState}
          setSimState={setSimState}
        />
      )}

      <Sidebar
        health={health}
        activeSection={activeSection}
        onNavigate={navigateTo}
        openAlertsCount={alerts.filter((a) => a.status === "OPEN").length}
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
            activeSection={activeSection}
            onNavigate={navigateTo}
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

          {/* ══════════════════════════════════════════════════
              VIEW ROUTING (TỪNG TRANG RIÊNG BIỆT)
             ══════════════════════════════════════════════════ */}

          {/* 1. Trang Tổng quan */}
          {activeSection === "overview" && (
            <OverviewView
              tripId={tripId}
              deviceId={deviceId}
              tripState={tripState}
              limits={limits}
              vehiclePlate={vehiclePlate}
              latestPacket={latestPacket}
              packets={packets}
              latestBySensor={latestBySensor}
              outOfRange={outOfRange}
              currentLocation={currentLocation}
              alerts={alerts}
              onNavigate={navigateTo}
              activeRoute={activeRoute}
            />
          )}

          {/* 2. Trang Điều khiển */}
          {activeSection === "controls" && (
            <ControlsView
              deviceId={deviceId}
              tripId={tripId}
              deliveryMode={deliveryMode}
              setDeliveryMode={setDeliveryMode}
              limits={limits}
              tripState={tripState}
              setTripState={setTripState}
              setLimits={setLimits}
              vehiclePlate={vehiclePlate}
              health={health}
              latestPacket={latestPacket}
              onRefresh={() => refresh(true)}
              onNavigate={navigateTo}
              onTripStarted={handleTripStarted}
            />
          )}

          {/* 3. Trang Cảm biến */}
          {activeSection === "sensors" && (
            <SensorsView
              latestBySensor={latestBySensor}
              limits={limits}
              packets={packets}
              outOfRange={outOfRange}
            />
          )}

          {/* 4. Trang Cảnh báo */}
          {activeSection === "alerts" && (
            <AlertsView
              alerts={alerts}
              onResolveAlert={handleResolveAlert}
            />
          )}

          {/* 5. Trang Lịch sử */}
          {activeSection === "history" && (
            <HistoryView
              packets={displayPackets}
              lastChecked={lastChecked}
            />
          )}

          {/* 6. Trang Bản đồ GPS */}
          {activeSection === "trip-map" && (
            <TripMapView
              currentLocation={currentLocation}
              routeHistory={routeHistory}
              tripInfo={{
                tripId,
                vehiclePlate,
                currentTemp: temperatures.length ? Math.max(...temperatures) : null,
                doorStatus:  latestPacket?.door_status,
                vehicleStatus: latestPacket?.vehicle_status || latestPacket?.vehicleStatus,
              }}
              activeRoute={activeRoute}
              setActiveRoute={setActiveRoute}
              simState={simState}
              setSimState={setSimState}
            />
          )}

          {/* 7. Trang Báo cáo cuối chuyến */}
          {activeSection === "reports" && (
            <TripReportView
              tripId={tripId}
              deviceId={deviceId}
              tripState={tripState}
              limits={limits}
              vehiclePlate={vehiclePlate}
              packets={displayPackets}
              alerts={alerts}
              onEndTrip={handleEndTrip}
              onNavigate={navigateTo}
            />
          )}

          {/* 8. Trang Quản lý tuyến đường & Điều phối */}
          {activeSection === "routes" && (
            <RouteManagementView
              activeRoute={activeRoute}
              setActiveRoute={setActiveRoute}
              simState={simState}
              setSimState={setSimState}
              tripId={tripId}
              onSelectTrip={(newTripId) => {
                setCurrentTripId(newTripId);
                refresh(true);
              }}
              onNavigate={navigateTo}
            />
          )}

          {/* Footer */}
          <footer className="page-footer">
            <span>Smart Cold Chain IoT</span>
            <span>·</span>
            <span>Nhiệt độ trực tiếp · lịch sử đồng bộ mỗi 5 giây</span>
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

