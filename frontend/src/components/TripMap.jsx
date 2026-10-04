import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
// CSS bắt buộc: Leaflet dùng các lớp này để đặt tile, marker và popup đúng vị trí.
import "leaflet/dist/leaflet.css";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";
import "./TripMap.css";

const HCM_CENTER = [10.762622, 106.660172];

// Import ảnh qua Vite để URL vẫn đúng khi build và khi deploy ở subpath.
// Thay icon mặc định bằng một instance mới, tránh cơ chế tự suy đoán imagePath.
L.Marker.prototype.options.icon = L.icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIconRetinaUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Xe tải dùng SVG nội tuyến nên không phụ thuộc đường dẫn ảnh hoặc font emoji.
const truckIcon = L.divIcon({
  className: "trip-truck-icon",
  html: '<div class="trip-truck-pin"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 8h16v15H3zM19 13h6l4 5v5H19z" fill="currentColor"/><path d="M21 15h3l3 4h-6z" fill="#147d70"/><circle cx="9" cy="24" r="4" fill="#173c45" stroke="white" stroke-width="2"/><circle cx="24" cy="24" r="4" fill="#173c45" stroke="white" stroke-width="2"/></svg></div>',
  iconSize: [48, 54],
  iconAnchor: [24, 54],
  popupAnchor: [0, -52],
});

// Loại null, NaN và tọa độ ngoài phạm vi; không biến null thành tọa độ 0.
export function isValidLocation(point) {
  return Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
}

function FollowTruck({ latitude, longitude }) {
  const map = useMap();
  useEffect(() => {
    // center của MapContainer chỉ dùng lúc khởi tạo; panTo xử lý telemetry mới.
    map.panTo([latitude, longitude], { animate: true, duration: 0.8 });
  }, [map, latitude, longitude]);

  useEffect(() => {
    // Khi panel đổi kích thước, tính lại khung bản đồ để không bị khoảng tile trắng.
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/**
 * currentLocation: { latitude, longitude } hoặc null.
 * routeHistory: [{ latitude, longitude, timestamp }], timestamp ISO từ telemetry.
 * tripInfo: { tripId, vehiclePlate, currentTemp, doorStatus }.
 */
export default function TripMap({ currentLocation = null, routeHistory = [], tripInfo = {} }) {
  const hasLocation = isValidLocation(currentLocation);
  const position = hasLocation
    ? [currentLocation.latitude, currentLocation.longitude]
    : HCM_CENTER;

  const route = useMemo(() => {
    const validPoints = (Array.isArray(routeHistory) ? routeHistory : [])
      .filter(isValidLocation)
      .slice()
      .sort((a, b) => {
        const first = Date.parse(a.timestamp), second = Date.parse(b.timestamp);
        return Number.isFinite(first) && Number.isFinite(second) ? first - second : 0;
      });
    // Bỏ điểm đứng yên trùng nhau để đường đi gọn hơn, không sửa mảng props.
    return validPoints.reduce((result, point) => {
      const previous = result.at(-1);
      if (!previous || previous[0] !== point.latitude || previous[1] !== point.longitude) {
        result.push([point.latitude, point.longitude]);
      }
      return result;
    }, []);
  }, [routeHistory]);

  return <div className="trip-map-wrapper">
    <MapContainer center={position} zoom={13} scrollWheelZoom={false} className="trip-map-canvas" aria-label="Bản đồ hành trình xe tải">
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      <FollowTruck latitude={position[0]} longitude={position[1]} />
      {route.length > 1 && <Polyline positions={route} pathOptions={{ color: "#1677e8", weight: 5, opacity: 0.85 }} />}
      {/* Chưa có GPS: chỉ hiện tâm TP.HCM, không tạo vị trí xe giả. */}
      {hasLocation && <Marker position={position} icon={truckIcon}>
        <Popup><div className="trip-map-popup">
          <strong>🚚 {tripInfo.tripId || "Chưa có chuyến"}</strong>
          <dl>
            <dt>Biển số</dt><dd>{tripInfo.vehiclePlate || "Chưa có dữ liệu"}</dd>
            <dt>Nhiệt độ</dt><dd>{Number.isFinite(tripInfo.currentTemp) ? `${tripInfo.currentTemp.toFixed(1)}°C` : "Chưa có dữ liệu"}</dd>
            <dt>Cửa</dt><dd>{tripInfo.doorStatus === "CLOSED" ? "Đóng" : tripInfo.doorStatus === "OPEN" ? "Mở" : "Chưa có dữ liệu"}</dd>
            <dt>Tọa độ</dt><dd>{position[0].toFixed(6)}, {position[1].toFixed(6)}</dd>
          </dl>
        </div></Popup>
      </Marker>}
    </MapContainer>
    {!hasLocation && <div className="trip-map-placeholder" role="status">Chưa có GPS · hiển thị trung tâm TP.HCM</div>}
  </div>;
}
