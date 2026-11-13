import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
  ZoomControl,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";
import "./TripMap.css";

/* ── DANH SÁCH KHO BÃI & ĐIỂM GIAO TIÊU BIỂU (TP. HỒ CHÍ MINH) ── */
export const LOGISTICS_HUBS = {
  origins: [
    {
      id: "hub-thuduc",
      name: "Kho Lạnh Chợ Đầu Mối Nông Sản Thủ Đức",
      shortName: "Kho Thủ Đức (Phía Đông)",
      address: "Quốc lộ 1A, P. Tam Bình, TP. Thủ Đức",
      latitude: 10.865500,
      longitude: 106.745500,
    },
    {
      id: "hub-catlai",
      name: "Cảng Cát Lái - Kho Container Lạnh Xuất Nhập Khẩu",
      shortName: "Cảng Cát Lái (Cửa khẩu)",
      address: "Đường Nguyễn Thị Định, Cát Lái, TP. Thủ Đức",
      latitude: 10.760000,
      longitude: 106.790000,
    },
    {
      id: "hub-tanbinh",
      name: "Kho Lạnh Trung Tâm Logistics KCN Tân Bình",
      shortName: "Kho KCN Tân Bình (Phía Tây)",
      address: "Đường Tây Thạnh, KCN Tân Bình, Tân Phú",
      latitude: 10.815000,
      longitude: 106.615000,
    },
    {
      id: "hub-binhdien",
      name: "Kho Lạnh Chợ Đầu Mối Bình Điền (Thủy Hải Sản)",
      shortName: "Kho Bình Điền (Phía Nam)",
      address: "Đại lộ Nguyễn Văn Linh, P.7, Q.8",
      latitude: 10.710000,
      longitude: 106.635000,
    },
    {
      id: "hub-songthan",
      name: "Kho Lạnh Phân Phối Sóng Thần",
      shortName: "Kho Tổng Sóng Thần",
      address: "KCN Sóng Thần 1, Dĩ An, Bình Dương",
      latitude: 10.885000,
      longitude: 106.755000,
    },
  ],
  destinations: [
    {
      id: "dest-coopmart",
      name: "Siêu thị Co.opmart Cống Quỳnh, Q.1",
      shortName: "Co.opmart Cống Quỳnh (Q.1)",
      address: "189C Cống Quỳnh, P. Phạm Ngũ Lão, Quận 1",
      latitude: 10.762200,
      longitude: 106.682500,
    },
    {
      id: "dest-choray",
      name: "Bệnh viện Chợ Rẫy - Trung tâm Vaccine & Dược phẩm",
      shortName: "BV Chợ Rẫy (Vaccine / Dược)",
      address: "201B Nguyễn Chí Thanh, Phường 12, Quận 5",
      latitude: 10.757800,
      longitude: 106.659500,
    },
    {
      id: "dest-gigamall",
      name: "TTTM Gigamall - Chuỗi Đại Siêu Thị Thực Phẩm",
      shortName: "Gigamall (Thủ Đức)",
      address: "240-242 Kha Vạn Cân, Hiệp Bình Chánh, TP. Thủ Đức",
      latitude: 10.828500,
      longitude: 106.717000,
    },
    {
      id: "dest-tansonnhat",
      name: "Kho Lạnh Hàng Không - Sân bay Quốc tế Tân Sơn Nhất",
      shortName: "Sân bay Tân Sơn Nhất",
      address: "Đường Trường Sơn, Phường 2, Tân Bình",
      latitude: 10.814000,
      longitude: 106.666000,
    },
    {
      id: "dest-emart",
      name: "Siêu thị Đại Siêu Thị Emart Sala Thủ Thiêm",
      shortName: "Emart Sala (Thủ Thiêm)",
      address: "Khu đô thị Sala, Mai Chí Thọ, TP. Thủ Đức",
      latitude: 10.771000,
      longitude: 106.725000,
    },
  ],
};

export const START_LOCATION = LOGISTICS_HUBS.origins[0];
export const DELIVERY_LOCATION = LOGISTICS_HUBS.destinations[0];

export const PLANNED_ROUTE = [
  [10.865500, 106.745500],
  [10.861200, 106.739800],
  [10.855000, 106.731000],
  [10.849000, 106.722000],
  [10.843000, 106.713500],
  [10.836500, 106.705000],
  [10.830000, 106.697500],
  [10.824000, 106.692500],
  [10.817500, 106.699000],
  [10.811000, 106.706000],
  [10.803500, 106.711000],
  [10.800000, 106.711800],
  [10.795000, 106.706000],
  [10.790000, 106.699500],
  [10.785000, 106.694000],
  [10.781000, 106.691000],
  [10.777000, 106.695500],
  [10.771000, 106.691500],
  [10.768000, 106.688000],
  [10.765000, 106.685000],
  [10.762200, 106.682500],
];

const DEFAULT_CENTER = [10.8138, 106.7140];

/* ── TÍNH TOÁN KHOẢNG CÁCH & LÀM MỊN ĐƯỜNG BỘ ── */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function interpolateRoadPoints(points, targetStepKm = 0.35) {
  if (!points || points.length < 2) return points || [];
  const result = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dist = haversineDistance(p1[0], p1[1], p2[0], p2[1]);
    const steps = Math.max(1, Math.round(dist / targetStepKm));

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const lat = p1[0] + t * (p2[0] - p1[0]);
      const lng = p1[1] + t * (p2[1] - p1[1]);
      result.push([Number(lat.toFixed(6)), Number(lng.toFixed(6))]);
    }
  }

  return result;
}

export function computePathDistance(coords) {
  let dist = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    dist += haversineDistance(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
  }
  return Number(dist.toFixed(1));
}

function rev(arr) {
  return [...arr].reverse();
}

function concatUnique(...arrays) {
  const res = [];
  for (const arr of arrays) {
    if (!arr) continue;
    for (const pt of arr) {
      if (!res.length || res[res.length - 1][0] !== pt[0] || res[res.length - 1][1] !== pt[1]) {
        res.push(pt);
      }
    }
  }
  return res;
}

/* ── MẠNG LƯỚI TUYẾN ĐƯỜNG TRỤC THỰC TẾ TP. HỒ CHÍ MINH (CẦU & ĐƯỜNG ĐÔ THỊ) ── */
export const HCMC_CORRIDORS = {
  THUDUC_QL13_BINHTRIEU: [
    [10.865500, 106.745500],
    [10.861200, 106.739800],
    [10.855000, 106.731000],
    [10.849000, 106.722000],
    [10.843000, 106.713500],
    [10.836500, 106.705000],
    [10.824000, 106.708000],
    [10.818000, 106.711000],
  ],
  BINHTRIEU_DIENBIENPHU_Q1: [
    [10.818000, 106.711000],
    [10.811000, 106.706000],
    [10.803500, 106.711000],
    [10.800000, 106.711800],
    [10.795000, 106.706000],
    [10.790000, 106.699500],
    [10.785000, 106.694000],
    [10.777000, 106.695500],
    [10.771000, 106.691500],
    [10.768000, 106.688000],
    [10.762200, 106.682500],
  ],
  Q1_TO_CHORAY: [
    [10.762200, 106.682500],
    [10.759000, 106.678000],
    [10.757000, 106.672000],
    [10.756000, 106.666000],
    [10.755000, 106.662000],
    [10.757800, 106.659500],
  ],
  THUDUC_PHAMVANDONG_GIGAMALL: [
    [10.865500, 106.745500],
    [10.852000, 106.741000],
    [10.840000, 106.735000],
    [10.834000, 106.726000],
    [10.828500, 106.717000],
  ],
  GIGAMALL_PHAMVANDONG_TSN: [
    [10.828500, 106.717000],
    [10.826000, 106.709000],
    [10.824000, 106.701000],
    [10.821000, 106.691000],
    [10.819000, 106.682000],
    [10.816000, 106.673000],
    [10.814000, 106.666000],
  ],
  TSN_NKKN_Q1: [
    [10.814000, 106.666000],
    [10.806000, 106.669000],
    [10.797000, 106.675000],
    [10.789000, 106.682000],
    [10.781000, 106.687000],
    [10.772000, 106.689000],
    [10.762200, 106.682500],
  ],
  CATLAI_MAICHITHO_SALA: [
    [10.760000, 106.790000],
    [10.765000, 106.785000],
    [10.771000, 106.778000],
    [10.776000, 106.771000],
    [10.783000, 106.761000],
    [10.790000, 106.748000],
    [10.781000, 106.736000],
    [10.771000, 106.725000],
  ],
  SALA_HAMTHUTHIEM_Q1: [
    [10.771000, 106.725000],
    [10.769000, 106.717000],
    [10.767500, 106.711000],
    [10.768000, 106.705000],
    [10.763000, 106.696000],
    [10.759000, 106.687000],
    [10.762200, 106.682500],
  ],
  TANBINH_CONGHOA_TSN: [
    [10.815000, 106.615000],
    [10.811000, 106.623000],
    [10.807000, 106.633000],
    [10.803500, 106.643000],
    [10.801000, 106.652000],
    [10.799500, 106.660000],
    [10.808000, 106.664000],
    [10.814000, 106.666000],
  ],
  TANBINH_LYTHUONGKIET_CHORAY: [
    [10.815000, 106.615000],
    [10.805000, 106.635000],
    [10.795000, 106.651000],
    [10.785000, 106.655000],
    [10.772000, 106.658000],
    [10.762000, 106.659000],
    [10.757800, 106.659500],
  ],
  BINHDIEN_NVL_CHORAY: [
    [10.710000, 106.635000],
    [10.715000, 106.643000],
    [10.722000, 106.654000],
    [10.730000, 106.661000],
    [10.738000, 106.664000],
    [10.745000, 106.665000],
    [10.750000, 106.662000],
    [10.754000, 106.660500],
    [10.757800, 106.659500],
  ],
  BINHDIEN_NVL_Q1: [
    [10.710000, 106.635000],
    [10.718000, 106.648000],
    [10.726000, 106.662000],
    [10.736000, 106.674000],
    [10.746000, 106.682000],
    [10.754000, 106.686000],
    [10.762200, 106.682500],
  ],
  SONGTHAN_THUDUC: [
    [10.885000, 106.755000],
    [10.878000, 106.751000],
    [10.872000, 106.748000],
    [10.865500, 106.745500],
  ],
};

/* ── Tạo tuyến đường thực tế giữa 25 cặp kho tiêu biểu ── */
export function getPresetRoadRoute(originId, destId) {
  const C = HCMC_CORRIDORS;
  let pts = [];
  const o = originId || "hub-thuduc";
  const d = destId || "dest-coopmart";

  const isSongThan = o === "hub-songthan";
  const baseOrigin = isSongThan ? "hub-thuduc" : o;

  if (baseOrigin === "hub-thuduc") {
    if (d === "dest-coopmart") {
      pts = concatUnique(C.THUDUC_QL13_BINHTRIEU, C.BINHTRIEU_DIENBIENPHU_Q1);
    } else if (d === "dest-choray") {
      pts = concatUnique(C.THUDUC_QL13_BINHTRIEU, C.BINHTRIEU_DIENBIENPHU_Q1, C.Q1_TO_CHORAY);
    } else if (d === "dest-gigamall") {
      pts = C.THUDUC_PHAMVANDONG_GIGAMALL;
    } else if (d === "dest-tansonnhat") {
      pts = concatUnique(C.THUDUC_PHAMVANDONG_GIGAMALL, C.GIGAMALL_PHAMVANDONG_TSN);
    } else if (d === "dest-emart") {
      pts = concatUnique(C.THUDUC_QL13_BINHTRIEU, C.BINHTRIEU_DIENBIENPHU_Q1, rev(C.SALA_HAMTHUTHIEM_Q1));
    }
  } else if (baseOrigin === "hub-catlai") {
    if (d === "dest-emart") {
      pts = C.CATLAI_MAICHITHO_SALA;
    } else if (d === "dest-coopmart") {
      pts = concatUnique(C.CATLAI_MAICHITHO_SALA, C.SALA_HAMTHUTHIEM_Q1);
    } else if (d === "dest-choray") {
      pts = concatUnique(C.CATLAI_MAICHITHO_SALA, C.SALA_HAMTHUTHIEM_Q1, C.Q1_TO_CHORAY);
    } else if (d === "dest-tansonnhat") {
      pts = concatUnique(C.CATLAI_MAICHITHO_SALA, C.SALA_HAMTHUTHIEM_Q1, rev(C.TSN_NKKN_Q1));
    } else if (d === "dest-gigamall") {
      pts = concatUnique(C.CATLAI_MAICHITHO_SALA, C.SALA_HAMTHUTHIEM_Q1, rev(C.TSN_NKKN_Q1), C.GIGAMALL_PHAMVANDONG_TSN);
    }
  } else if (baseOrigin === "hub-tanbinh") {
    if (d === "dest-tansonnhat") {
      pts = C.TANBINH_CONGHOA_TSN;
    } else if (d === "dest-choray") {
      pts = C.TANBINH_LYTHUONGKIET_CHORAY;
    } else if (d === "dest-coopmart") {
      pts = concatUnique(C.TANBINH_CONGHOA_TSN, C.TSN_NKKN_Q1);
    } else if (d === "dest-gigamall") {
      pts = concatUnique(C.TANBINH_CONGHOA_TSN, rev(C.GIGAMALL_PHAMVANDONG_TSN));
    } else if (d === "dest-emart") {
      pts = concatUnique(C.TANBINH_CONGHOA_TSN, C.TSN_NKKN_Q1, rev(C.SALA_HAMTHUTHIEM_Q1));
    }
  } else if (baseOrigin === "hub-binhdien") {
    if (d === "dest-choray") {
      pts = C.BINHDIEN_NVL_CHORAY;
    } else if (d === "dest-coopmart") {
      pts = C.BINHDIEN_NVL_Q1;
    } else if (d === "dest-emart") {
      pts = concatUnique(C.BINHDIEN_NVL_Q1, rev(C.SALA_HAMTHUTHIEM_Q1));
    } else if (d === "dest-tansonnhat") {
      pts = concatUnique(C.BINHDIEN_NVL_CHORAY, rev(C.TANBINH_LYTHUONGKIET_CHORAY), C.TANBINH_CONGHOA_TSN);
    } else if (d === "dest-gigamall") {
      pts = concatUnique(C.BINHDIEN_NVL_Q1, rev(C.BINHTRIEU_DIENBIENPHU_Q1), rev(C.THUDUC_QL13_BINHTRIEU), C.THUDUC_PHAMVANDONG_GIGAMALL);
    }
  }

  if (isSongThan) {
    pts = concatUnique(C.SONGTHAN_THUDUC, pts);
  }

  if (!pts.length) {
    pts = concatUnique(C.THUDUC_QL13_BINHTRIEU, C.BINHTRIEU_DIENBIENPHU_Q1);
  }

  const smooth = interpolateRoadPoints(pts, 0.35);
  const distanceKm = computePathDistance(smooth);
  const durationMin = Math.max(12, Math.round((distanceKm / 32) * 60) + 4);

  return { coordinates: smooth, distanceKm, durationMin };
}

/* ── Tìm tuyến đường cho điểm click tự do trên bản đồ theo mạng lưới đường bộ ── */
export function getCustomSnappedRoadRoute(start, end) {
  // Tìm điểm ngã rẽ gần nhất trong mạng lưới để bắt vào
  const allNodes = Object.values(HCMC_CORRIDORS).flat();
  let bestStartNode = allNodes[0];
  let minStartDist = Infinity;
  let bestEndNode = allNodes[allNodes.length - 1];
  let minEndDist = Infinity;

  for (const node of allNodes) {
    const d1 = haversineDistance(start.latitude, start.longitude, node[0], node[1]);
    if (d1 < minStartDist) {
      minStartDist = d1;
      bestStartNode = node;
    }
    const d2 = haversineDistance(end.latitude, end.longitude, node[0], node[1]);
    if (d2 < minEndDist) {
      minEndDist = d2;
      bestEndNode = node;
    }
  }

  const intermediatePts = [
    [start.latitude, start.longitude],
    bestStartNode,
    bestEndNode,
    [end.latitude, end.longitude],
  ];

  const smooth = interpolateRoadPoints(intermediatePts, 0.35);
  const distanceKm = computePathDistance(smooth);
  const durationMin = Math.max(10, Math.round((distanceKm / 30) * 60) + 5);

  return { coordinates: smooth, distanceKm, durationMin };
}

/* ── Fix default leaflet icon ── */
L.Marker.prototype.options.icon = L.icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIconRetinaUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

/* ── Tính góc quay hướng xe (Bearing / Heading 0-360 độ) ── */
export function calculateBearing(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLng = toRad(lng2 - lng1);
  const y = Math.sin(deltaLng) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLng);
  const theta = Math.atan2(y, x);
  return (toDeg(theta) + 360) % 360;
}

/* ── Tạo Icon Ghim Địa Điểm ── */
export function createDepotPin(type, label) {
  const isStart = type === "start";
  return L.divIcon({
    className: "map-depot-marker",
    html: `
      <div class="map-depot-pin ${isStart ? "map-pin-start" : "map-pin-delivery"}">
        <span class="map-pin-icon">${isStart ? "🏁" : "📦"}</span>
        <span class="map-pin-text">${label}</span>
      </div>
    `,
    iconSize: [120, 36],
    iconAnchor: [60, 36],
    popupAnchor: [0, -36],
  });
}

/* ── Tạo Icon Xe Tải Có Xoay Đầu & Nhãn Trạng Thái ── */
export function createTruckIcon(isStopped, bearing = 45, speedText = "") {
  const statusClass = isStopped ? "stopped" : "running";
  const statusLabel = isStopped ? "ĐANG DỪNG" : speedText ? `ĐANG CHẠY · ${speedText}` : "ĐANG CHẠY";

  return L.divIcon({
    className: "trip-truck-icon-container",
    html: `
      <div class="trip-truck-marker-wrap ${statusClass}">
        <div class="truck-live-status-pill ${statusClass}">
          <span class="truck-status-dot ${statusClass}"></span>
          <span class="truck-status-text">${statusLabel}</span>
        </div>
        <div class="trip-truck-pin-outer">
          <div class="trip-truck-pin" style="transform: rotate(${bearing - 45}deg);">
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path d="M3 8h16v15H3zM19 13h6l4 5v5H19z" fill="currentColor"/>
              <path d="M21 15h3l3 4h-6z" fill="#0d9488"/>
              <circle cx="9" cy="24" r="4" fill="#0f2830" stroke="white" stroke-width="2"/>
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

export function isValidLocation(point) {
  return (
    Number.isFinite(point?.latitude) &&
    Number.isFinite(point?.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}

function MapController({ targetPos, fitBoundsTarget, zoomInTrigger, zoomOutTrigger }) {
  const map = useMap();

  useEffect(() => {
    if (fitBoundsTarget && fitBoundsTarget.length >= 2) {
      map.fitBounds(fitBoundsTarget, { padding: [50, 50], maxZoom: 15, animate: true });
    }
  }, [map, fitBoundsTarget]);

  useEffect(() => {
    if (zoomInTrigger) {
      map.zoomIn();
    }
  }, [map, zoomInTrigger]);

  useEffect(() => {
    if (zoomOutTrigger) {
      map.zoomOut();
    }
  }, [map, zoomOutTrigger]);

  useEffect(() => {
    if (targetPos && isValidLocation({ latitude: targetPos[0], longitude: targetPos[1] })) {
      map.panTo(targetPos, { animate: true, duration: 0.6 });
    }
  }, [map, targetPos]);

  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  return null;
}

function MapClickHandler({ pickMode, onMapClick }) {
  useMapEvents({
    click(e) {
      if (pickMode) {
        onMapClick(e.latlng);
      }
    },
  });
  return null;
}

/* ══════════════════════════════════════════════════════════════
   TRIP MAP COMPONENT (ĐỒNG BỘ TUYẾN ĐƯỜNG VỚI DRIVER MODE)
   ══════════════════════════════════════════════════════════════ */
export default function TripMap({
  currentLocation = null,
  routeHistory = [],
  tripInfo = {},
  activeRoute,
  setActiveRoute,
  simState,
  setSimState,
}) {
  const [originId, setOriginId] = useState(LOGISTICS_HUBS.origins[0].id);
  const [destId, setDestId] = useState(LOGISTICS_HUBS.destinations[0].id);
  const [customOrigin, setCustomOrigin] = useState(null);
  const [customDest, setCustomDest] = useState(null);
  const [pickMode, setPickMode] = useState(null);
  const [isRouting, setIsRouting] = useState(false);
  const [fitBoundsTrigger, setFitBoundsTrigger] = useState(null);
  const [zoomInTrigger, setZoomInTrigger] = useState(0);
  const [zoomOutTrigger, setZoomOutTrigger] = useState(0);

  // Điểm bắt đầu và kết thúc
  const currentOrigin = useMemo(() => {
    if (customOrigin) return customOrigin;
    return LOGISTICS_HUBS.origins.find((h) => h.id === originId) || LOGISTICS_HUBS.origins[0];
  }, [originId, customOrigin]);

  const currentDestination = useMemo(() => {
    if (customDest) return customDest;
    return LOGISTICS_HUBS.destinations.find((h) => h.id === destId) || LOGISTICS_HUBS.destinations[0];
  }, [destId, customDest]);

  /* ── Gọi API OSRM tìm đường bộ chính xác (kèm Tuyến đường bộ chuẩn TP.HCM) ── */
  async function calculateRoute(start, end) {
    if (!start || !end) return;
    setIsRouting(true);

    // 1. Áp dụng ngay lập tức tuyến đường bộ thực tế tương ứng để giao diện tức thì, KHÔNG BAO GIỜ là đường chim bay
    const isCustom = Boolean(customOrigin || customDest);
    const roadFallback = isCustom
      ? getCustomSnappedRoadRoute(start, end)
      : getPresetRoadRoute(originId, destId);

    // Cập nhật state chung của toàn hệ thống (cả TripMap lẫn DriverView)
    setActiveRoute((prev) => ({
      ...prev,
      origin: start,
      destination: end,
      coordinates: roadFallback.coordinates,
      distanceKm: roadFallback.distanceKm,
      durationMin: roadFallback.durationMin,
    }));

    setSimState((prev) => ({
      ...prev,
      simIndex: 0,
      isSimulating: false,
      isStopped: false,
      position: roadFallback.coordinates[0] || [start.latitude, start.longitude],
      speedText: "0 km/h",
    }));

    setFitBoundsTrigger([
      [start.latitude, start.longitude],
      [end.latitude, end.longitude],
    ]);

    // 2. Thử truy vấn các máy chủ OSRM online để bổ sung chi tiết khúc cua thời gian thực
    const servers = [
      `https://router.project-osrm.org/route/v1/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson`,
      `https://routing.openstreetmap.de/routed-car/route/v1/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson`,
    ];

    for (const url of servers) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) continue;
        const data = await res.json();

        if (data.code === "Ok" && data.routes?.[0]?.geometry?.coordinates?.length > 1) {
          const route = data.routes[0];
          const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
          const distanceKm = Number((route.distance / 1000).toFixed(1));
          const durationMin = Math.max(1, Math.round(route.duration / 60));

          // Nâng cấp lên dữ liệu OSRM chi tiết từng ngã rẽ
          setActiveRoute((prev) => ({
            ...prev,
            coordinates: coords,
            distanceKm,
            durationMin,
          }));

          setSimState((prev) => ({
            ...prev,
            position: coords[0] || [start.latitude, start.longitude],
          }));
          break; // Thành công thì dừng lại
        }
      } catch (err) {
        // Giữ nguyên tuyến đường bộ chuẩn đã nạp ở bước 1
      }
    }

    setIsRouting(false);
  }

  // Tự động tìm đường khi thay đổi Origin hoặc Destination
  useEffect(() => {
    calculateRoute(currentOrigin, currentDestination);
  }, [currentOrigin.latitude, currentOrigin.longitude, currentDestination.latitude, currentDestination.longitude]);

  // Xử lý click chọn điểm trên bản đồ
  function handleMapClick(latlng) {
    if (pickMode === "origin") {
      setCustomOrigin({
        id: "custom-origin",
        name: `Điểm chọn (${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)})`,
        shortName: "Điểm xuất phát (Tự chọn)",
        address: "Vị trí được chọn trên bản đồ",
        latitude: latlng.lat,
        longitude: latlng.lng,
      });
      setPickMode("dest");
    } else if (pickMode === "dest") {
      setCustomDest({
        id: "custom-dest",
        name: `Điểm giao (${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)})`,
        shortName: "Điểm giao hàng (Tự chọn)",
        address: "Vị trí được chọn trên bản đồ",
        latitude: latlng.lat,
        longitude: latlng.lng,
      });
      setPickMode(null);
    }
  }

  /* ── Xác định vị trí và góc xoay xe ── */
  const activePosition = useMemo(() => {
    if (activeRoute?.controlMode === "live" && isValidLocation(currentLocation)) {
      return [currentLocation.latitude, currentLocation.longitude];
    }
    return simState?.position || [currentOrigin.latitude, currentOrigin.longitude];
  }, [activeRoute?.controlMode, currentLocation, simState?.position, currentOrigin]);

  const truckMarkerIcon = useMemo(
    () => createTruckIcon(simState?.isStopped, simState?.bearing, simState?.speedText),
    [simState?.isStopped, simState?.bearing, simState?.speedText]
  );

  const traveledPath = useMemo(() => {
    if (activeRoute?.controlMode === "custom") {
      return (activeRoute?.coordinates || []).slice(0, (simState?.simIndex || 0) + 1);
    }
    return routeHistory.filter(isValidLocation).map((p) => [p.latitude, p.longitude]);
  }, [activeRoute?.controlMode, activeRoute?.coordinates, simState?.simIndex, routeHistory]);

  return (
    <div className="trip-map-wrapper">
      {/* ── BẢNG ĐIỀU KHIỂN ĐỊNH TUYẾN ── */}
      <div className="route-dispatcher-bar">
        <div className="route-selector-row">
          <div className="mode-pill-toggle">
            <button
              type="button"
              className={`pill-btn ${activeRoute?.controlMode === "custom" ? "active" : ""}`}
              onClick={() => setActiveRoute((prev) => ({ ...prev, controlMode: "custom" }))}
              title="Tự chọn điểm đi, điểm đến và mô phỏng lộ trình"
            >
              🧭 Điều phối tuyến đường
            </button>
            <button
              type="button"
              className={`pill-btn ${activeRoute?.controlMode === "live" ? "active" : ""}`}
              onClick={() => setActiveRoute((prev) => ({ ...prev, controlMode: "live" }))}
              title="Theo dõi vị trí thực tế từ phần cứng ESP32"
            >
              📡 Trực tiếp (ESP32)
            </button>
          </div>

          {activeRoute?.controlMode === "custom" && (
            <>
              {/* Dropdown Kho Xuất Phát */}
              <div className="hub-select-group">
                <span className="hub-icon">🏁</span>
                <select
                  className="hub-select origin"
                  value={customOrigin ? "custom" : originId}
                  onChange={(e) => {
                    if (e.target.value === "custom") {
                      setPickMode("origin");
                    } else {
                      setCustomOrigin(null);
                      setOriginId(e.target.value);
                    }
                  }}
                >
                  <optgroup label="Kho Lạnh & Cảng (TP.HCM)">
                    {LOGISTICS_HUBS.origins.map((hub) => (
                      <option key={hub.id} value={hub.id}>
                        {hub.shortName}
                      </option>
                    ))}
                  </optgroup>
                  {customOrigin && (
                    <option value="custom">📍 {customOrigin.shortName}</option>
                  )}
                </select>
              </div>

              <span className="route-arrow">➔</span>

              {/* Dropdown Điểm Giao Hàng */}
              <div className="hub-select-group">
                <span className="hub-icon">📦</span>
                <select
                  className="hub-select destination"
                  value={customDest ? "custom" : destId}
                  onChange={(e) => {
                    if (e.target.value === "custom") {
                      setPickMode("dest");
                    } else {
                      setCustomDest(null);
                      setDestId(e.target.value);
                    }
                  }}
                >
                  <optgroup label="Điểm Giao & Siêu Thị / BV">
                    {LOGISTICS_HUBS.destinations.map((hub) => (
                      <option key={hub.id} value={hub.id}>
                        {hub.shortName}
                      </option>
                    ))}
                  </optgroup>
                  {customDest && (
                    <option value="custom">📍 {customDest.shortName}</option>
                  )}
                </select>
              </div>

              {/* Nút bấm chọn trên bản đồ */}
              <button
                type="button"
                className={`btn-pick-map ${pickMode ? "picking" : ""}`}
                onClick={() => setPickMode(pickMode ? null : "origin")}
                title="Bấm chuột 2 điểm trên bản đồ để chọn tuyến tự do"
              >
                {pickMode === "origin"
                  ? "🎯 Bấm chọn Điểm Đi trên bản đồ..."
                  : pickMode === "dest"
                  ? "🎯 Bấm chọn Điểm Đến..."
                  : "📍 Bấm chọn bản đồ"}
              </button>
            </>
          )}
        </div>

        {/* Hàng thông tin lộ trình và nút điều khiển mô phỏng */}
        {activeRoute?.controlMode === "custom" && (
          <div className="simulation-control-row">
            <div className="route-meta-badge">
              <span className="meta-item">
                🛣️ <strong>{activeRoute?.distanceKm} km</strong>
              </span>
              <span className="meta-sep">·</span>
              <span className="meta-item">
                ⏱️ Dự kiến: <strong>{activeRoute?.durationMin} phút</strong>
              </span>
              <span className="meta-sep">·</span>
              <span className="meta-item">
                📌 {(activeRoute?.coordinates || []).length} điểm rẽ
              </span>
              {isRouting && <span className="routing-spinner">Đang tìm đường...</span>}
            </div>

            <div className="sim-buttons-group">
              <button
                type="button"
                className={`btn-sim-play ${simState?.isSimulating ? "pause" : "play"}`}
                onClick={() => {
                  setSimState((prev) => {
                    const coords = activeRoute?.coordinates || [];
                    const nextIndex = prev.simIndex >= coords.length - 1 ? 0 : prev.simIndex;
                    return {
                      ...prev,
                      simIndex: nextIndex,
                      isSimulating: !prev.isSimulating,
                    };
                  });
                }}
              >
                {simState?.isSimulating
                  ? "⏸ Tạm dừng"
                  : (simState?.simIndex || 0) > 0 && (simState?.simIndex || 0) < (activeRoute?.coordinates?.length || 1) - 1
                  ? "▶ Tiếp tục"
                  : "▶ Bắt đầu chạy"}
              </button>

              <button
                type="button"
                className="btn-sim-reset"
                onClick={() => {
                  setSimState((prev) => ({
                    ...prev,
                    isSimulating: false,
                    simIndex: 0,
                    isStopped: false,
                    position: (activeRoute?.coordinates || [])[0] || [currentOrigin.latitude, currentOrigin.longitude],
                    speedText: "0 km/h",
                  }));
                }}
                title="Đặt xe về lại điểm xuất phát"
              >
                ↺ Đặt lại
              </button>

              <div className="speed-toggle">
                {[1, 2, 5].map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    className={`btn-spd ${(simState?.simSpeed || 2) === spd ? "active" : ""}`}
                    onClick={() => setSimState((prev) => ({ ...prev, simSpeed: spd }))}
                  >
                    {spd}x
                  </button>
                ))}
              </div>

              <div className="zoom-toggle">
                <button
                  type="button"
                  className="btn-zoom-action"
                  onClick={() => setZoomInTrigger((v) => v + 1)}
                  title="Phóng to bản đồ (Zoom In)"
                  aria-label="Phóng to"
                >
                  ➕ Phóng to
                </button>
                <button
                  type="button"
                  className="btn-zoom-action"
                  onClick={() => setZoomOutTrigger((v) => v + 1)}
                  title="Thu nhỏ bản đồ (Zoom Out)"
                  aria-label="Thu nhỏ"
                >
                  ➖ Thu nhỏ
                </button>
              </div>

              <button
                type="button"
                className="btn-fit-bounds"
                onClick={() =>
                  setFitBoundsTrigger([
                    [currentOrigin.latitude, currentOrigin.longitude],
                    [currentDestination.latitude, currentDestination.longitude],
                  ])
                }
                title="Thu phóng toàn tuyến"
              >
                ⛶ Toàn tuyến
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── BẢN ĐỒ LEAFLET ── */}
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={13}
        scrollWheelZoom={true}
        doubleClickZoom={true}
        touchZoom={true}
        boxZoom={true}
        zoomControl={false}
        className={`trip-map-canvas ${pickMode ? "map-crosshair" : ""}`}
        aria-label="Bản đồ hành trình chuỗi lạnh"
      >
        <ZoomControl position="topright" />
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />

        <MapController
          targetPos={activePosition}
          fitBoundsTarget={fitBoundsTrigger}
          zoomInTrigger={zoomInTrigger}
          zoomOutTrigger={zoomOutTrigger}
        />
        <MapClickHandler pickMode={pickMode} onMapClick={handleMapClick} />

        {/* Tuyến kế hoạch OSRM (đường nét đứt màu xám đá) */}
        <Polyline
          positions={activeRoute?.coordinates || PLANNED_ROUTE}
          pathOptions={{
            color: "#64748b",
            weight: 4,
            dashArray: "6, 8",
            opacity: 0.6,
          }}
        />

        {/* Đoạn đường xe thực tế đã đi qua (màu xanh teal đậm) */}
        {traveledPath.length > 1 && (
          <Polyline
            positions={traveledPath}
            pathOptions={{
              color: "#0d9488",
              weight: 6,
              opacity: 0.95,
            }}
          />
        )}

        {/* Marker Điểm Xuất Phát */}
        <Marker
          position={[currentOrigin.latitude, currentOrigin.longitude]}
          icon={createDepotPin("start", customOrigin ? "Điểm đi (Tự chọn)" : currentOrigin.shortName)}
        >
          <Popup>
            <div className="trip-map-popup">
              <strong>🏁 ĐIỂM XUẤT PHÁT</strong>
              <div className="popup-name">{currentOrigin.name}</div>
              <div className="popup-address">{currentOrigin.address}</div>
              <dl>
                <dt>Tọa độ</dt>
                <dd>{currentOrigin.latitude.toFixed(6)}, {currentOrigin.longitude.toFixed(6)}</dd>
                <dt>Hàng hóa</dt>
                <dd>Thực phẩm lạnh / Vaccine (2°C - 8°C)</dd>
              </dl>
            </div>
          </Popup>
          <Tooltip direction="top" offset={[0, -36]}>
            {currentOrigin.shortName}
          </Tooltip>
        </Marker>

        {/* Marker Điểm Giao Hàng */}
        <Marker
          position={[currentDestination.latitude, currentDestination.longitude]}
          icon={createDepotPin("delivery", customDest ? "Điểm đến (Tự chọn)" : currentDestination.shortName)}
        >
          <Popup>
            <div className="trip-map-popup">
              <strong>📦 ĐIỂM GIAO HÀNG</strong>
              <div className="popup-name">{currentDestination.name}</div>
              <div className="popup-address">{currentDestination.address}</div>
              <dl>
                <dt>Tọa độ</dt>
                <dd>{currentDestination.latitude.toFixed(6)}, {currentDestination.longitude.toFixed(6)}</dd>
                <dt>Quy trình</dt>
                <dd>Bật Delivery Mode trước khi mở cửa</dd>
              </dl>
            </div>
          </Popup>
          <Tooltip direction="top" offset={[0, -36]}>
            {currentDestination.shortName}
          </Tooltip>
        </Marker>

        {/* Marker Xe Tải Lạnh */}
        {activePosition && (
          <Marker position={activePosition} icon={truckMarkerIcon}>
            <Popup>
              <div className="trip-map-popup">
                <strong>🚚 XE TẢI LẠNH · {tripInfo.tripId || "TRIP001"}</strong>
                <dl>
                  <dt>Trạng thái</dt>
                  <dd>
                    <span className={`popup-status-badge ${simState?.isStopped ? "stopped" : "running"}`}>
                      {simState?.isStopped ? "🔴 ĐANG DỪNG" : "🟢 ĐANG CHẠY"}
                    </span>
                  </dd>
                  <dt>Vận tốc</dt>
                  <dd>{simState?.speedText || "0 km/h"}</dd>
                  <dt>Tiến độ</dt>
                  <dd>
                    {activeRoute?.controlMode === "custom"
                      ? `${Math.round(((simState?.simIndex || 0) / Math.max(1, (activeRoute?.coordinates?.length || 1) - 1)) * 100)}% tuyến đường`
                      : "Đang theo dõi live"}
                  </dd>
                  <dt>Cửa khoang</dt>
                  <dd>{tripInfo.doorStatus === "CLOSED" ? "🔒 ĐÓNG" : "🔓 MỞ"}</dd>
                  <dt>Tọa độ</dt>
                  <dd>{activePosition[0].toFixed(5)}, {activePosition[1].toFixed(5)}</dd>
                </dl>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {/* Thông báo chế độ chọn trên bản đồ */}
      {pickMode && (
        <div className="pick-mode-banner" role="status">
          <span>🎯 {pickMode === "origin" ? "Bước 1: Click chuột vào điểm xuất phát trên bản đồ" : "Bước 2: Click chuột vào điểm giao hàng"}</span>
          <button type="button" onClick={() => setPickMode(null)}>✕ Hủy</button>
        </div>
      )}

      {/* Legend chú thích bản đồ */}
      <div className="map-legend-overlay">
        <div className="legend-item">
          <span className="legend-icon">🏁</span>
          <span>{currentOrigin.shortName}</span>
        </div>
        <div className="legend-item">
          <span className="legend-icon">📦</span>
          <span>{currentDestination.shortName}</span>
        </div>
        <div className="legend-item">
          <span className="legend-line actual"></span>
          <span>Đường đã đi</span>
        </div>
        <div className="legend-item">
          <span className="legend-line planned"></span>
          <span>Lộ trình đường bộ (OSRM)</span>
        </div>
      </div>
    </div>
  );
}
