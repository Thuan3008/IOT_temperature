/**
 * DriverView.jsx — Chế độ lái xe (Driver Mode)
 *
 * Đồng bộ 100% với Bảng điều phối tuyến đường (Option C):
 *  • Toàn màn hình, ZERO cuộn trang, chữ TO LỚN tương phản cao
 *  • Bản đồ GPS 100% nền hiển thị đúng Điểm xuất phát, Điểm giao & Tuyến OSRM đã chọn
 *  • Mũi xe tải tự động xoay góc (Bearing) theo từng khúc cua của đường
 *  • Trạng thái "ĐANG CHẠY" (kèm tốc độ) và "ĐANG DỪNG" đồng bộ tức thì
 *  • Bảng điều khiển HUD mini trực tiếp trên màn hình lái xe
 */

import React, { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Popup,
  Tooltip,
  useMap,
  ZoomControl,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import markerIconUrl       from "leaflet/dist/images/marker-icon.png";
import markerIconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl     from "leaflet/dist/images/marker-shadow.png";
import {
  START_LOCATION,
  DELIVERY_LOCATION,
  PLANNED_ROUTE,
  isValidLocation,
} from "./TripMap";
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

/* ── Custom Pins for Driver View ── */
function createDriverDepotPin(type, label) {
  const isStart = type === "start";
  return L.divIcon({
    className: "map-depot-marker",
    html: `
      <div class="dv-depot-pin ${isStart ? "dv-pin-start" : "dv-pin-delivery"}">
        <span>${isStart ? "🏁" : "📦"} ${label}</span>
      </div>
    `,
    iconSize: [120, 32],
    iconAnchor: [60, 32],
    popupAnchor: [0, -32],
  });
}

function createDriverTruckIcon(isStopped, bearing = 45, speedText = "") {
  const statusClass = isStopped ? "stopped" : "running";
  const statusLabel = isStopped ? "ĐANG DỪNG" : speedText ? `ĐANG CHẠY · ${speedText}` : "ĐANG CHẠY";

  return L.divIcon({
    className: "dv-truck-icon-container",
    html: `
      <div class="dv-truck-wrap ${statusClass}">
        <div class="dv-status-pill ${statusClass}">
          <span class="dv-status-dot ${statusClass}"></span>
          <span>${statusLabel}</span>
        </div>
        <div class="dv-truck-pin-outer">
          <div class="dv-truck-pin" style="transform: rotate(${bearing - 45}deg);">
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path d="M3 8h16v15H3zM19 13h6l4 5v5H19z" fill="currentColor"/>
              <path d="M21 15h3l3 4h-6z" fill="#0d9488"/>
              <circle cx="9"  cy="24" r="4" fill="#0f2830" stroke="white" stroke-width="2"/>
              <circle cx="24" cy="24" r="4" fill="#0f2830" stroke="white" stroke-width="2"/>
            </svg>
          </div>
        </div>
      </div>
    `,
    iconSize: [140, 84],
    iconAnchor: [70, 78],
    popupAnchor: [0, -78],
  });
}

const DEFAULT_CENTER = [10.8138, 106.7140];

/* Pan map when GPS updates */
function FollowTruck({ lat, lng, zoomInTrigger, zoomOutTrigger }) {
  const map = useMap();
  useEffect(() => {
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      map.panTo([lat, lng], { animate: true, duration: 0.6 });
    }
  }, [map, lat, lng]);

  useEffect(() => {
    if (zoomInTrigger) map.zoomIn();
  }, [map, zoomInTrigger]);

  useEffect(() => {
    if (zoomOutTrigger) map.zoomOut();
  }, [map, zoomOutTrigger]);

  useEffect(() => {
    const obs = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    obs.observe(map.getContainer());
    return () => obs.disconnect();
  }, [map]);
  return null;
}

/* ── Phân loại nhiệt độ ── */
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
  activeRoute,
  setActiveRoute,
  simState,
  setSimState,
}) {
  const origin = activeRoute?.origin || START_LOCATION;
  const destination = activeRoute?.destination || DELIVERY_LOCATION;
  const coordinates = activeRoute?.coordinates || PLANNED_ROUTE;

  const [zoomInTrigger, setZoomInTrigger] = useState(0);
  const [zoomOutTrigger, setZoomOutTrigger] = useState(0);

  /* Vị trí hiện tại của xe tải */
  const currentPos = useMemo(() => {
    if (activeRoute?.controlMode === "live" && isValidLocation(currentLocation)) {
      return [currentLocation.latitude, currentLocation.longitude];
    }
    if (simState?.position) {
      return simState.position;
    }
    return [origin.latitude, origin.longitude];
  }, [activeRoute?.controlMode, currentLocation, simState?.position, origin]);

  /* Tuyến xe thực tế đã chạy */
  const traveledRoute = useMemo(() => {
    if (activeRoute?.controlMode === "custom") {
      return coordinates.slice(0, (simState?.simIndex || 0) + 1);
    }
    return routeHistory.filter(isValidLocation).map((p) => [p.latitude, p.longitude]);
  }, [activeRoute?.controlMode, coordinates, simState?.simIndex, routeHistory]);

  const truckIcon = useMemo(
    () => createDriverTruckIcon(simState?.isStopped, simState?.bearing, simState?.speedText),
    [simState?.isStopped, simState?.bearing, simState?.speedText]
  );

  /* Cảm biến */
  const SENSOR_IDS = ["S1", "S2", "S3", "S4", "S5"];
  const sensors = SENSOR_IDS.map((id) => ({
    id,
    name: SENSOR_NAMES[id],
    data: latestBySensor?.get(id),
  }));

  /* Cảnh báo */
  const alertSensors = sensors.filter(({ data }) => {
    const cls = classifyTemp(data?.temperature, limits);
    return cls === "danger" || cls === "warn";
  });

  const doorStatus  = latestPacket?.door_status;
  const isDoorAlert = doorStatus === "OPEN" && !deliveryMode;
  const totalAlerts = alertSensors.length + (isDoorAlert ? 1 : 0);

  function fmtTime(v) {
    if (!v) return "—";
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(new Date(v));
  }

  return (
    <div className="dv-shell" role="main" aria-label="Chế độ lái xe">

      {/* ── Alert bar (chỉ hiện khi có cảnh báo khẩn cấp) ── */}
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

      {/* ── Nút Thoát ── */}
      <button
        className="dv-exit-btn"
        onClick={onExitDriverMode}
        aria-label="Thoát chế độ lái xe"
        title="Quay lại giao diện quản lý"
      >
        ✕ Thoát HUD
      </button>

      {/* ── HUD Mini Điều Khiển Mô Phỏng Trên Xe ── */}
      {activeRoute?.controlMode === "custom" && (
        <div className="dv-sim-hud">
          <button
            type="button"
            className={`dv-hud-btn ${simState?.isSimulating ? "pause" : "play"}`}
            onClick={() => {
              setSimState((prev) => {
                const nextIdx = prev.simIndex >= coordinates.length - 1 ? 0 : prev.simIndex;
                return {
                  ...prev,
                  simIndex: nextIdx,
                  isSimulating: !prev.isSimulating,
                };
              });
            }}
          >
            {simState?.isSimulating ? "⏸ Tạm dừng" : "▶ Chạy xe"}
          </button>

          <button
            type="button"
            className="dv-hud-btn reset"
            onClick={() => {
              setSimState((prev) => ({
                ...prev,
                isSimulating: false,
                simIndex: 0,
                isStopped: false,
                position: coordinates[0] || [origin.latitude, origin.longitude],
                speedText: "0 km/h",
              }));
            }}
          >
            ↺ Đặt lại
          </button>

          <div className="dv-hud-speed">
            {[1, 2, 5].map((spd) => (
              <button
                key={spd}
                type="button"
                className={`dv-hud-spd ${(simState?.simSpeed || 2) === spd ? "active" : ""}`}
                onClick={() => setSimState((prev) => ({ ...prev, simSpeed: spd }))}
              >
                {spd}x
              </button>
            ))}
          </div>
          <div className="dv-hud-zoom">
            <button
              type="button"
              className="dv-hud-btn"
              onClick={() => setZoomInTrigger((v) => v + 1)}
              title="Phóng to bản đồ (Zoom In)"
            >
              ➕
            </button>
            <button
              type="button"
              className="dv-hud-btn"
              onClick={() => setZoomOutTrigger((v) => v + 1)}
              title="Thu nhỏ bản đồ (Zoom Out)"
            >
              ➖
            </button>
          </div>
        </div>
      )}

      {/* ── Bản đồ toàn màn hình ── */}
      <MapContainer
        center={currentPos || DEFAULT_CENTER}
        zoom={14}
        scrollWheelZoom={true}
        doubleClickZoom={true}
        touchZoom={true}
        boxZoom={true}
        zoomControl={false}
        className="dv-map"
        aria-label="Bản đồ hành trình lái xe"
      >
        <ZoomControl position="bottomright" />
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        <FollowTruck
          lat={currentPos[0]}
          lng={currentPos[1]}
          zoomInTrigger={zoomInTrigger}
          zoomOutTrigger={zoomOutTrigger}
        />

        {/* Lộ trình OSRM kế hoạch (nét đứt) */}
        <Polyline
          positions={coordinates}
          pathOptions={{ color: "#94a3b8", weight: 4.5, dashArray: "6, 8", opacity: 0.65 }}
        />

        {/* Tuyến xe thực tế đã chạy (màu xanh teal phát sáng) */}
        {traveledRoute.length > 1 && (
          <Polyline
            positions={traveledRoute}
            pathOptions={{ color: "#0d9488", weight: 7.5, opacity: 0.98 }}
          />
        )}

        {/* Điểm xuất phát */}
        <Marker
          position={[origin.latitude, origin.longitude]}
          icon={createDriverDepotPin("start", origin.shortName)}
        >
          <Popup>
            <strong>🏁 ĐIỂM XUẤT PHÁT</strong>
            <div>{origin.name}</div>
            <small>{origin.address}</small>
          </Popup>
        </Marker>

        {/* Điểm giao hàng */}
        <Marker
          position={[destination.latitude, destination.longitude]}
          icon={createDriverDepotPin("delivery", destination.shortName)}
        >
          <Popup>
            <strong>📦 ĐIỂM GIAO HÀNG</strong>
            <div>{destination.name}</div>
            <small>{destination.address}</small>
          </Popup>
        </Marker>

        {/* Marker Xe Tải Lạnh Xoay Góc Hướng Chạy */}
        {currentPos && (
          <Marker position={currentPos} icon={truckIcon}>
            <Popup>
              <strong>🚚 XE TẢI LẠNH · {tripId || "TRIP001"}</strong>
              <br />
              <span>Trạng thái: {simState?.isStopped ? "🔴 ĐANG DỪNG" : "🟢 ĐANG CHẠY"}</span>
              <br />
              <span>Vận tốc: {simState?.speedText}</span>
              <br />
              {vehiclePlate && <span>Biển số: {vehiclePlate}</span>}
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {/* ── Panel trái: 5 cảm biến nhiệt độ ── */}
      <aside className="dv-sensor-panel" aria-label="Nhiệt độ cảm biến">
        <div className="dv-panel-label">NHIỆT ĐỘ KHOANG LẠNH</div>
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

        {/* Ngưỡng cho phép */}
        <div className="dv-threshold">
          <span className="dv-threshold-label">Ngưỡng cho phép</span>
          <span className="dv-threshold-value">
            {limits.min ?? "—"}°C – {limits.max ?? "—"}°C
          </span>
        </div>
      </aside>

      {/* ── Panel phải: Trạng thái Vận hành + Tuyến đường + Cửa ── */}
      <aside className="dv-status-panel" aria-label="Trạng thái xe">

        {/* Thẻ Trạng thái xe */}
        <div className={`dv-vehicle-card ${simState?.isStopped ? "stopped" : "running"}`}>
          <div className="dv-vehicle-icon" aria-hidden="true">
            {simState?.isStopped ? "⏸️" : "🚚"}
          </div>
          <div className="dv-vehicle-info">
            <div className="dv-vehicle-label">VẬN HÀNH</div>
            <div className="dv-vehicle-value">
              {simState?.isStopped ? "ĐANG DỪNG" : "ĐANG CHẠY"}
            </div>
            <div className="dv-vehicle-sub">
              {simState?.isStopped ? "Đỗ tại điểm giao trả hàng" : `Vận tốc: ${simState?.speedText || "38 km/h"}`}
            </div>
          </div>
        </div>

        {/* Thẻ Tuyến Đường Đang Chạy (ĐỒNG BỘ 100%) */}
        <div className="dv-route-card">
          <div className="dv-route-label">LỘ TRÌNH ĐIỀU PHỐI</div>
          <div className="dv-route-endpoints">
            <span className="ep-start">{origin.shortName}</span>
            <span className="ep-arrow">➔</span>
            <span className="ep-end">{destination.shortName}</span>
          </div>
          <div className="dv-route-meta">
            <span>🛣️ {activeRoute?.distanceKm} km</span>
            <span>·</span>
            <span>⏱️ {activeRoute?.durationMin} phút</span>
          </div>
        </div>

        {/* Trạng thái cửa */}
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
              <div className="dv-door-alert">⚠ Chưa bật Giao Hàng!</div>
            )}
          </div>
        </div>

        {/* Chế độ giao hàng */}
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

        {/* Mã chuyến */}
        <div className="dv-trip-card">
          <div className="dv-trip-label">CHUYẾN ĐI</div>
          <div className="dv-trip-value">{tripId || "TRIP001"}</div>
          {vehiclePlate && <div className="dv-plate">{vehiclePlate}</div>}
        </div>
      </aside>

      {/* ── Thanh thông tin đáy ── */}
      <div className="dv-bottom-bar" aria-label="Tự động làm mới">
        <span className="dv-ticker-dot" aria-hidden="true" />
        Tuyến đường: <strong>{origin.name}</strong> ➔ <strong>{destination.name}</strong> · Cự ly: {activeRoute?.distanceKm} km (OSRM Road Network)
      </div>
    </div>
  );
}
