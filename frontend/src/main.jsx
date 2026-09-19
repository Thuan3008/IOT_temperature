import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";
const SENSOR_IDS = ["S1", "S2", "S3", "S4", "S5"];
const DEFAULT_LIMITS = { min: 3, max: 8 };

function formatTime(value) {
  if (!value) return "Chưa có dữ liệu";
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

function getReadings(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.value)) return payload.value;
  return [];
}

function getPacketGroups(readings) {
  const groups = new Map();
  for (const reading of readings) {
    const key = String(reading.packet_id);
    if (!groups.has(key)) groups.set(key, { ...reading, sensors: [] });
    groups.get(key).sensors.push(reading);
  }
  return [...groups.values()].sort((a, b) => new Date(b.measured_at) - new Date(a.measured_at));
}

function TrendChart({ packets, limits }) {
  const points = [...packets].reverse().slice(-20);
  if (!points.length) return <div className="chart-empty">Đang chờ dữ liệu telemetry…</div>;
  const width = 760, height = 220, pad = { top: 16, right: 16, bottom: 28, left: 42 };
  const values = points.flatMap((packet) => packet.sensors.map((sensor) => sensor.temperature).filter(Number.isFinite));
  const minValue = Math.min(limits.min ?? Math.min(...values), ...values) - 1;
  const maxValue = Math.max(limits.max ?? Math.max(...values), ...values) + 1;
  const x = (i) => pad.left + (points.length === 1 ? 0 : i * (width - pad.left - pad.right) / (points.length - 1));
  const y = (value) => pad.top + (maxValue - value) * (height - pad.top - pad.bottom) / (maxValue - minValue || 1);
  const colors = ["#147d70", "#3478c6", "#e59832", "#cf5b54", "#8a63bf"];
  return <div className="chart-wrap"><svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Biểu đồ nhiệt độ từng cảm biến">
    {[minValue, (minValue + maxValue) / 2, maxValue].map((tick) => <g key={tick}><line x1={pad.left} x2={width-pad.right} y1={y(tick)} y2={y(tick)} className="gridline"/><text x={pad.left-8} y={y(tick)+4} textAnchor="end" className="axis-label">{tick.toFixed(1)}°</text></g>)}
    {[limits.min, limits.max].filter((v) => v != null).map((tick) => <line key={tick} x1={pad.left} x2={width-pad.right} y1={y(tick)} y2={y(tick)} className="limit-line"/>)}
    {SENSOR_IDS.map((id, sensorIndex) => { const coords = points.map((packet,i) => { const r=packet.sensors.find((item)=>item.sensor_id===id); return r && Number.isFinite(r.temperature) ? `${x(i)},${y(r.temperature)}` : null; }).filter(Boolean); return coords.length ? <polyline key={id} points={coords.join(" ")} fill="none" stroke={colors[sensorIndex]} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/> : null; })}
    <text x={pad.left} y={height-5} className="axis-label">Cũ hơn</text><text x={width-pad.right} y={height-5} textAnchor="end" className="axis-label">Mới nhất</text>
  </svg><div className="legend">{SENSOR_IDS.map((id,i)=><span key={id}><i style={{backgroundColor:colors[i]}}/>{id}</span>)}<span><i className="legend-limit"/>Ngưỡng bảo quản</span></div></div>;
}

function App() {
  const [readings, setReadings] = useState([]);
  const [health, setHealth] = useState("checking");
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [tripState, setTripState] = useState("IN_TRANSIT");
  const [error, setError] = useState("");
  const [lastChecked, setLastChecked] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [healthResponse, telemetryResponse] = await Promise.all([fetch(`${API_BASE}/api/health`), fetch(`${API_BASE}/api/telemetry`)]);
      const healthData = await healthResponse.json();
      if (!healthResponse.ok) throw new Error(`Database/API chưa sẵn sàng (${healthResponse.status})`);
      const telemetryData = await telemetryResponse.json();
      if (!telemetryResponse.ok) throw new Error(telemetryData.message || "Không tải được telemetry");
      const next = getReadings(telemetryData);
      setReadings(next);
      setHealth(healthData.database === "SQL Server Connected" ? "online" : "offline");
      setError(""); setLastChecked(new Date());
      const tripId = next[0]?.trip_id;
      if (tripId) { const response = await fetch(`${API_BASE}/api/trips/${encodeURIComponent(tripId)}`); if (response.ok) { const trip = await response.json(); setLimits({min:trip.min_temperature ?? null,max:trip.max_temperature ?? null}); setTripState(trip.trip_state || "UNKNOWN"); } }
    } catch (e) { setHealth("offline"); setError(e.message || "Không kết nối được backend"); }
  }, []);

  useEffect(() => { refresh(); const timer=window.setInterval(refresh,5000); return ()=>window.clearInterval(timer); },[refresh]);
  const packets=useMemo(()=>getPacketGroups(readings),[readings]);
  const latestPacket=packets[0];
  const latestBySensor=useMemo(()=>{const latest=new Map(); for(const reading of readings) if(!latest.has(reading.sensor_id)) latest.set(reading.sensor_id,reading); return latest;},[readings]);
  const tripId=latestPacket?.trip_id || "TRIP001", deviceId=latestPacket?.device_id || "ESP32-01";
  const outOfRange=[...latestBySensor.values()].filter((r)=>r.temperature!=null && ((limits.min!=null&&r.temperature<limits.min)||(limits.max!=null&&r.temperature>limits.max))).length;
  const temperatures=latestPacket?.sensors.map((r)=>r.temperature).filter(Number.isFinite) || [];
  const humidities=latestPacket?.sensors.map((r)=>r.humidity).filter(Number.isFinite) || [];

  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#top"><span className="brand-mark">❄</span><span>ColdChain<span className="brand-light"> IoT</span></span></a><div className="side-label">GIÁM SÁT</div><a className="nav-item active" href="#overview"><span>▦</span>Tổng quan</a><a className="nav-item" href="#sensors"><span>◉</span>Cảm biến</a><a className="nav-item" href="#history"><span>◷</span>Lịch sử</a><div className="sidebar-bottom"><span className={`status-dot ${health}`}/>{health==="online"?"Hệ thống trực tuyến":"Đang kết nối lại"}</div></aside>
    <main className="main-content" id="top">
      <header className="topbar"><div><div className="eyebrow">SMART COLD CHAIN / DASHBOARD</div><h1>Giám sát vận chuyển</h1></div><div className="topbar-right"><span className={`connection-pill ${health}`}><i/>{health==="online"?"Đang hoạt động":health==="checking"?"Đang kiểm tra":"Mất kết nối"}</span><button className="refresh-button" onClick={refresh} aria-label="Làm mới dữ liệu">↻</button></div></header>
      {error&&<div className="error-banner"><strong>Không tải được dữ liệu.</strong> {error}. Kiểm tra backend tại {API_BASE}.</div>}
      <section className="trip-banner" id="overview"><div className="trip-icon">🚚</div><div className="trip-main"><span className="eyebrow light">CHUYẾN ĐANG THEO DÕI</span><h2>{tripId}</h2><span className="trip-sub">Thiết bị {deviceId} <b>·</b> ESP32 5 cảm biến</span></div><div className="trip-state"><span className="state-dot"/>{({IN_TRANSIT:"ĐANG VẬN CHUYỂN",ARMED:"ĐÃ SẴN SÀNG",IDLE:"CHƯA KHỞI HÀNH",COMPLETED:"ĐÃ HOÀN THÀNH"})[tripState]||tripState}</div><div className="trip-threshold"><span>Khoảng nhiệt độ</span><strong>{limits.min==null?"—":`${limits.min}°C`} <em>đến</em> {limits.max==null?"—":`${limits.max}°C`}</strong></div></section>
      <section className="metric-grid"><article className="metric-card"><div className="metric-top"><span>NHIỆT ĐỘ CAO NHẤT</span><span className="metric-symbol warm">↗</span></div><strong>{temperatures.length?`${Math.max(...temperatures).toFixed(1)}°`:"—"}</strong><small>{outOfRange?`${outOfRange} cảm biến ngoài ngưỡng`:"Trong giới hạn bảo quản"}</small></article><article className="metric-card"><div className="metric-top"><span>ĐỘ ẨM TRUNG BÌNH</span><span className="metric-symbol cool">◌</span></div><strong>{humidities.length?`${(humidities.reduce((a,b)=>a+b,0)/humidities.length).toFixed(0)}%`:"—"}</strong><small>Trung bình cảm biến có dữ liệu</small></article><article className="metric-card"><div className="metric-top"><span>TRẠNG THÁI CỬA</span><span className="metric-symbol">⌑</span></div><strong className="metric-word">{latestPacket?.door_status||"—"}</strong><small>{latestPacket?.door_status==="CLOSED"?"Khoang hàng đang đóng kín":"Theo bản tin gần nhất"}</small></article><article className="metric-card"><div className="metric-top"><span>BẢN TIN ĐÃ NHẬN</span><span className="metric-symbol cool">⌁</span></div><strong>{packets.length}</strong><small>{latestPacket?`Mới nhất ${formatTime(latestPacket.received_at)}`:"Chưa nhận bản tin"}</small></article></section>
      <section className="content-grid"><article className="panel chart-panel"><div className="panel-heading"><div><span className="eyebrow">NHIỆT ĐỘ THEO THỜI GIAN</span><h3>Diễn biến nhiệt độ</h3></div><span className="live-label"><i/> LIVE · 5 GIÂY</span></div><TrendChart packets={packets} limits={limits}/></article><article className="panel sensors-panel" id="sensors"><div className="panel-heading"><div><span className="eyebrow">THIẾT BỊ ESP32</span><h3>Cảm biến</h3></div><span className="sensor-count">{[...latestBySensor.values()].filter((r)=>r.sensor_status==="ONLINE").length}/5 online</span></div><div className="sensor-list">{SENSOR_IDS.map((id)=>{const sensor=latestBySensor.get(id),status=sensor?.sensor_status||"NO DATA",temp=sensor?.temperature;const alert=temp!=null&&((limits.min!=null&&temp<limits.min)||(limits.max!=null&&temp>limits.max));return <div className="sensor-row" key={id}><span className={`sensor-icon ${alert?"alert":""}`}>°</span><div className="sensor-name"><strong>{id}</strong><small>{status==="ONLINE"?"Đang hoạt động":status}</small></div><div className="sensor-value"><strong className={alert?"text-alert":""}>{temp==null?"—":`${Number(temp).toFixed(1)}°C`}</strong><small>{sensor?.humidity==null?"—":`${Number(sensor.humidity).toFixed(0)}% RH`}</small></div><span className={`sensor-state ${status==="ONLINE"?"ok":"down"}`} title={status}/></div>})}</div></article></section>
      <section className="panel history-panel" id="history"><div className="panel-heading"><div><span className="eyebrow">TELEMETRY MQTT</span><h3>Bản tin gần đây</h3></div><span className="updated-at">{lastChecked?`Đồng bộ ${formatTime(lastChecked)}`:"Đang đồng bộ…"}</span></div>{packets.length?<div className="table-scroll"><table><thead><tr><th>PACKET</th><th>THỜI GIAN ĐO</th><th>THIẾT BỊ / CHUYẾN</th><th>CẢM BIẾN</th><th>CỬA</th><th>GPS</th><th>NGUỒN</th></tr></thead><tbody>{packets.slice(0,12).map((packet)=><tr key={packet.packet_id}><td className="packet-id">#{packet.packet_id}</td><td>{formatTime(packet.measured_at)}</td><td><strong>{packet.device_id}</strong><small className="table-sub">{packet.trip_id}</small></td><td><span className="reading-count">{packet.sensors.length} / 5</span></td><td><span className={`door-tag ${packet.door_status==="CLOSED"?"closed":"open"}`}>{packet.door_status||"—"}</span></td><td>{packet.latitude==null?"—":`${Number(packet.latitude).toFixed(3)}, ${Number(packet.longitude).toFixed(3)}`}</td><td>{packet.is_buffered?<span className="buffer-tag">BUFFERED</span>:"Trực tiếp"}</td></tr>)}</tbody></table></div>:<div className="empty-state"><span>◷</span><strong>Chưa có bản tin</strong><p>Publish telemetry lên MQTT để bắt đầu giám sát.</p></div>}</section>
      <footer>Smart Cold Chain IoT <span>·</span> Tự động làm mới mỗi 5 giây <span>·</span> API {API_BASE}</footer>
    </main>
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
