/**
 * DriverView.jsx — Chế độ lái xe (Driver Mode)
 *
 * Thiết kế cho tài xế đang ngồi sau vô-lăng:
 *  • Toàn màn hình, ZERO cuộn trang
 *  • Bản đồ GPS chiếm 100% nền
 *  • Panel nhiệt độ 5 vùng ghim góc trái
 *  • Alert bar ghim trên cùng (chỉ hiện khi có cảnh báo)
 *  • Trạng thái cửa + delivery mode góc phải
 *  • Chữ TO LỚN, tương phản cao để nhìn thoáng qua cũng thấy
 */

import React, { useEffect, useMemo } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Popup,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import markerIconUrl       from "leaflet/dist/images/marker-icon.png";
import markerIconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl     from "leaflet/dist/images/marker-shadow.png";
import "./DriverView.css";

/* ── Fix leaflet default icon ── */
L.Marker.prototype.options.icon = L.icon({
  iconUrl:       markerIconUrl,
  iconRetinaUrl: markerIconRetinaUrl,
  shadowUrl:     markerShadowUrl,
  iconSize:   [25, 41],
  iconAnchor: [12, 41],
  popupAnchor:[1, -34],
  shadowSize: [41, 41],
});

/* ── Truck icon ── */
const truckIcon = L.divIcon({
  className: "",
  html: `<div class="dv-truck-pin">
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M3 8h16v15H3z" fill="currentColor"/>
      <path d="M19 13h6l4 5v5H19z" fill="currentColor"/>
      <path d="M21 15h3l3 4h-6z" fill="#0d9488"/>
      <circle cx="9"  cy="24" r="4" fill="#0f2830" stroke="white" stroke-width="2"/>
      <circle cx="24" cy="24" r="4" fill="#0f2830" stroke="white" stroke-width="2"/>
    </svg>
  </div>`,
  iconSize:   [52, 58],
  iconAnchor: [26, 58],
  popupAnchor:[0, -56],
});

const HCM_CENTER = [10.762622, 106.660172];

function isValidLocation(pt) {
  return (
    Number.isFinite(pt?.latitude)  && Math.abs(pt.latitude)  <= 90 &&
    Number.isFinite(pt?.longitude) && Math.abs(pt.longitude) <= 180
  );
}

/* Pan map when GPS updates */
function FollowTruck({ lat, lng }) {
  const map = useMap();
  useEffect(() => {
    map.panTo([lat, lng], { animate: true, duration: 0.7 });
  }, [map, lat, lng]);
  useEffect(() => {
    const obs = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    obs.observe(map.getContainer());
    return () => obs.disconnect();
  }, [map]);
  return null;
}

/* ── Classify temperature vs. limits ── */
function classifyTemp(temp, limits) {
  if (temp == null || !Number.isFinite(temp)) return "offline";
  if (
    (limits.min != null && temp < limits.min) ||
    (limits.max != null && temp > limits.max)
  ) return "danger";
  if (
    (limits.min != null && temp < limits.min + 1) ||
    (limits.max != null && temp > limits.max - 1)
  ) return "warn";
  return "ok";
}

const SENSOR_NAMES = {
  S1: "Dàn lạnh",
  S2: "Trung tâm",
  S3: "Gần cửa",
  S4: "Góc nhiệt",
  S5: "Dự phòng",
};

/* ════════════════════════════════════════════════
   DRIVER VIEW — default export
   ════════════════════════════════════════════════ */
export default function DriverView({
  currentLocation,
  routeHistory = [],
  latestBySensor,
  limits,
  latestPacket,
  deliveryMode,
  tripId,
  vehiclePlate,
  onExitDriverMode,
}) {
  const hasLocation = isValidLocation(currentLocation);
  const position    = hasLocation
    ? [currentLocation.latitude, currentLocation.longitude]
    : HCM_CENTER;

  /* Route polyline — deduplicated */
  const route = useMemo(() => {
    const pts = [...routeHistory]
      .filter(isValidLocation)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    return pts.reduce((acc, pt) => {
      const prev = acc.at(-1);
      if (!prev || prev[0] !== pt.latitude || prev[1] !== pt.longitude)
        acc.push([pt.latitude, pt.longitude]);
      return acc;
    }, []);
  }, [routeHistory]);

  /* Sensor data */
  const SENSOR_IDS = ["S1", "S2", "S3", "S4", "S5"];
  const sensors = SENSOR_IDS.map((id) => ({
    id,
    name: SENSOR_NAMES[id],
    data: latestBySensor?.get(id),
  }));

  /* Alerts */
  const alertSensors = sensors.filter(({ data }) => {
    const cls = classifyTemp(data?.temperature, limits);
    return cls === "danger" || cls === "warn";
  });

  const doorStatus  = latestPacket?.door_status;
  const isDoorAlert = doorStatus === "OPEN" && !deliveryMode;

  const totalAlerts = alertSensors.length + (isDoorAlert ? 1 : 0);

  /* Format time */
  function fmtTime(v) {
    if (!v) return "—";
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(new Date(v));
  }

  return (
    <div className="dv-shell" role="main" aria-label="Chế độ lái xe">

      {/* ── Alert bar (sticky top, visible only when alerts exist) ── */}
      {totalAlerts > 0 && (
        <div className="dv-alert-bar" role="alert" aria-live="assertive">
          <span className="dv-alert-icon">⚠</span>
          <span className="dv-alert-text">
            {alertSensors.length > 0 &&
              `CẢNH BÁO NHIỆT ĐỘ: ${alertSensors.map((s) => s.id).join(", ")}`}
            {isDoorAlert && (alertSensors.length > 0 ? " · " : "") + "CỬA MỞ TRÁI PHÉP!"}
          </span>
          <span className="dv-alert-blink" aria-hidden="true">●</span>
        </div>
      )}

      {/* ── Exit button ── */}
      <button
        className="dv-exit-btn"
        onClick={onExitDriverMode}
        aria-label="Thoát chế độ lái xe"
        title="Thoát chế độ lái xe"
      >
        ✕ Thoát
      </button>

      {/* ── Full-screen map ── */}
      <MapContainer
        center={position}
        zoom={14}
        scrollWheelZoom={false}
        zoomControl={false}
        className="dv-map"
        aria-label="Bản đồ hành trình"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        <FollowTruck lat={position[0]} lng={position[1]} />
        {route.length > 1 && (
          <Polyline
            positions={route}
            pathOptions={{ color: "#0d9488", weight: 6, opacity: 0.9 }}
          />
        )}
        {hasLocation && (
          <Marker position={position} icon={truckIcon}>
            <Popup>
              <strong>🚚 {tripId || "—"}</strong>
              <br />
              {vehiclePlate && <span>Biển số: {vehiclePlate}</span>}
            </Popup>
          </Marker>
        )}
        {!hasLocation && (
          <div className="dv-no-gps" role="status">📍 Chưa có GPS</div>
        )}
      </MapContainer>

      {/* ── Left panel: 5 sensor temperatures ── */}
      <aside className="dv-sensor-panel" aria-label="Nhiệt độ cảm biến">
        <div className="dv-panel-label">NHIỆT ĐỘ KHOANG</div>
        {sensors.map(({ id, name, data }) => {
          const temp = data?.temperature;
          const hum  = data?.humidity;
          const cls  = classifyTemp(temp, limits);
          const online = data?.sensor_status === "ONLINE";
          return (
            <div key={id} className={`dv-sensor-row dv-sensor-${cls}`}>
              <div className="dv-sensor-badge">{id}</div>
              <div className="dv-sensor-body">
                <div className="dv-sensor-name">{name}</div>
                <div className="dv-sensor-temp">
                  {temp != null ? `${Number(temp).toFixed(1)}°C` : "N/A"}
                </div>
                {hum != null && (
                  <div className="dv-sensor-hum">{Number(hum).toFixed(0)}% RH</div>
                )}
              </div>
              <div className={`dv-sensor-status-dot ${online ? "online" : "offline"}`}
                   aria-label={online ? "Online" : "Offline"} />
            </div>
          );
        })}

        {/* Threshold reference */}
        <div className="dv-threshold">
          <span className="dv-threshold-label">Ngưỡng cho phép</span>
          <span className="dv-threshold-value">
            {limits.min ?? "—"}°C – {limits.max ?? "—"}°C
          </span>
        </div>
      </aside>

      {/* ── Right panel: door + delivery + trip info ── */}
      <aside className="dv-status-panel" aria-label="Trạng thái xe">

        {/* Door status */}
        <div className={`dv-door-card ${isDoorAlert ? "danger" : doorStatus === "OPEN" ? "warn" : "ok"}`}>
          <div className="dv-door-icon" aria-hidden="true">
            {doorStatus === "CLOSED" ? "🔒" : "🔓"}
          </div>
          <div className="dv-door-info">
            <div className="dv-door-label">CỬA KHOANG</div>
            <div className="dv-door-value">
              {doorStatus === "CLOSED" ? "ĐÓNG" : doorStatus === "OPEN" ? "MỞ" : "—"}
            </div>
            {isDoorAlert && (
              <div className="dv-door-alert">⚠ Chưa vào điểm giao!</div>
            )}
          </div>
        </div>

        {/* Delivery mode */}
        <div className={`dv-mode-card ${deliveryMode ? "delivery-on" : "delivery-off"}`}>
          <div className="dv-mode-icon" aria-hidden="true">
            {deliveryMode ? "📦" : "🚛"}
          </div>
          <div className="dv-mode-info">
            <div className="dv-mode-label">CHẾ ĐỘ</div>
            <div className="dv-mode-value">
              {deliveryMode ? "GIAO HÀNG" : "VẬN CHUYỂN"}
            </div>
          </div>
        </div>

        {/* Trip ID */}
        <div className="dv-trip-card">
          <div className="dv-trip-label">CHUYẾN</div>
          <div className="dv-trip-value">{tripId || "—"}</div>
          {vehiclePlate && <div className="dv-plate">{vehiclePlate}</div>}
        </div>

        {/* GPS update time */}
        <div className="dv-gps-card">
          <div className="dv-gps-label">📍 GPS cập nhật</div>
          <div className="dv-gps-time">
            {fmtTime(currentLocation?.timestamp)}
          </div>
          {!hasLocation && (
            <div className="dv-gps-none">Đang chờ tín hiệu…</div>
          )}
        </div>
      </aside>

      {/* ── Bottom bar: refresh ticker ── */}
      <div className="dv-bottom-bar" aria-label="Tự động làm mới">
        <span className="dv-ticker-dot" aria-hidden="true" />
        Tự động cập nhật mỗi 5 giây
      </div>
    </div>
  );
}
