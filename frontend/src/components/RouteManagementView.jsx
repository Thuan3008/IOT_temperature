import { useMemo, useState } from "react";
import {
  LOGISTICS_HUBS,
  getPresetRoadRoute,
  computePathDistance,
} from "./TripMap";
import "./RouteManagementView.css";

const INITIAL_ROUTES = [
  {
    id: "R-HCM-01",
    tripId: "TRIP001",
    name: "Tuyến Thủ Đức ➔ Co.opmart Cống Quỳnh",
    originId: "hub-thuduc",
    destId: "dest-coopmart",
    cargo: "Rau củ quả sạch Đà Lạt (2°C - 8°C)",
    vehiclePlate: "59C-12345",
    deviceId: "ESP32-01",
    status: "IN_TRANSIT",
    distanceKm: 14.8,
    durationMin: 28,
  },
  {
    id: "R-HCM-02",
    tripId: "trip002",
    name: "Tuyến Sóng Thần ➔ BV Chợ Rẫy (Vaccine)",
    originId: "hub-songthan",
    destId: "dest-choray",
    cargo: "Vaccine & Sinh phẩm y tế (2°C - 8°C)",
    vehiclePlate: "59C-882.14",
    deviceId: "ESP32-01",
    status: "IN_TRANSIT",
    distanceKm: 18.6,
    durationMin: 35,
  },
  {
    id: "R-HCM-03",
    tripId: "TRIP003",
    name: "Tuyến Cảng Cát Lái ➔ Emart Sala Thủ Thiêm",
    originId: "hub-catlai",
    destId: "dest-emart",
    cargo: "Thịt bò đông lạnh nhập khẩu (-18°C)",
    vehiclePlate: "59C-554.21",
    deviceId: "ESP32-02",
    status: "IDLE",
    distanceKm: 11.2,
    durationMin: 22,
  },
  {
    id: "R-HCM-04",
    tripId: "TRIP004",
    name: "Tuyến Chợ Bình Điền ➔ Đại Siêu Thị Gigamall",
    originId: "hub-binhdien",
    destId: "dest-gigamall",
    cargo: "Thủy hải sản tươi sống (0°C - 4°C)",
    vehiclePlate: "59C-338.99",
    deviceId: "ESP32-03",
    status: "IDLE",
    distanceKm: 21.5,
    durationMin: 40,
  },
  {
    id: "R-HCM-05",
    tripId: "TRIP005",
    name: "Tuyến KCN Tân Bình ➔ Sân Bay Tân Sơn Nhất",
    originId: "hub-tanbinh",
    destId: "dest-tansonnhat",
    cargo: "Mẫu xét nghiệm & Dược phẩm bay (2°C - 8°C)",
    vehiclePlate: "59C-771.65",
    deviceId: "ESP32-04",
    status: "COMPLETED",
    distanceKm: 6.5,
    durationMin: 15,
  },
];

export default function RouteManagementView({
  activeRoute,
  setActiveRoute,
  simState,
  setSimState,
  tripId,
  onSelectTrip,
  onNavigate,
}) {
  const [routes, setRoutes] = useState(INITIAL_ROUTES);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [showAddModal, setShowAddModal] = useState(false);

  // Form tạo tuyến mới
  const [newRouteForm, setNewRouteForm] = useState({
    originId: LOGISTICS_HUBS.origins[0]?.id || "hub-thuduc",
    destId: LOGISTICS_HUBS.destinations[0]?.id || "dest-coopmart",
    tripId: `TRIP00${routes.length + 1}`,
    vehiclePlate: "59C-998.88",
    cargo: "Thực phẩm mát bảo quản (2°C - 8°C)",
  });

  // Tìm kiếm & Lọc tuyến
  const filteredRoutes = useMemo(() => {
    return routes.filter((r) => {
      const matchSearch =
        search.trim() === "" ||
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.id.toLowerCase().includes(search.toLowerCase()) ||
        r.tripId.toLowerCase().includes(search.toLowerCase()) ||
        r.vehiclePlate.toLowerCase().includes(search.toLowerCase());

      const matchFilter =
        filterStatus === "ALL" || r.status === filterStatus;

      return matchSearch && matchFilter;
    });
  }, [routes, search, filterStatus]);

  // Thống kê tổng quan
  const stats = useMemo(() => {
    const total = routes.length;
    const inTransit = routes.filter((r) => r.status === "IN_TRANSIT").length;
    const completed = routes.filter((r) => r.status === "COMPLETED").length;
    const totalDistance = routes.reduce((acc, r) => acc + (r.distanceKm || 0), 0);

    return {
      total,
      inTransit,
      completed,
      totalDistance: totalDistance.toFixed(1),
    };
  }, [routes]);

  // Kích hoạt & Điều phối tuyến đường được chọn
  function handleDispatchRoute(routeItem, thenNavigateMap = false) {
    const origin =
      LOGISTICS_HUBS.origins.find((h) => h.id === routeItem.originId) ||
      LOGISTICS_HUBS.origins[0];
    const destination =
      LOGISTICS_HUBS.destinations.find((h) => h.id === routeItem.destId) ||
      LOGISTICS_HUBS.destinations[0];

    const coords = getPresetRoadRoute(routeItem.originId, routeItem.destId);

    if (setActiveRoute) {
      setActiveRoute({
        controlMode: "custom",
        origin,
        destination,
        coordinates: coords,
        distanceKm: routeItem.distanceKm,
        durationMin: routeItem.durationMin,
      });
    }

    if (setSimState) {
      setSimState((prev) => ({
        ...prev,
        simIndex: 0,
        position: coords[0] || [origin.latitude, origin.longitude],
        bearing: 45,
        isStopped: false,
        isSimulating: true,
        speedText: "35 km/h",
      }));
    }

    if (onSelectTrip && routeItem.tripId) {
      onSelectTrip(routeItem.tripId);
    }

    // Cập nhật trạng thái tuyến trong danh sách
    setRoutes((curr) =>
      curr.map((r) =>
        r.id === routeItem.id ? { ...r, status: "IN_TRANSIT" } : r
      )
    );

    if (thenNavigateMap && onNavigate) {
      onNavigate("trip-map");
    }
  }

  // Thêm tuyến mới
  function handleAddRouteSubmit(e) {
    e.preventDefault();
    const origin = LOGISTICS_HUBS.origins.find((h) => h.id === newRouteForm.originId);
    const dest = LOGISTICS_HUBS.destinations.find((h) => h.id === newRouteForm.destId);

    const coords = getPresetRoadRoute(newRouteForm.originId, newRouteForm.destId);
    const dist = computePathDistance(coords) || 12.5;
    const dur = Math.max(15, Math.round(dist * 2.2));

    const newId = `R-HCM-0${routes.length + 1}`;
    const newRoute = {
      id: newId,
      tripId: newRouteForm.tripId,
      name: `Tuyến ${origin?.shortName || "Kho"} ➔ ${dest?.shortName || "Điểm giao"}`,
      originId: newRouteForm.originId,
      destId: newRouteForm.destId,
      cargo: newRouteForm.cargo,
      vehiclePlate: newRouteForm.vehiclePlate,
      deviceId: "ESP32-01",
      status: "IN_TRANSIT",
      distanceKm: dist,
      durationMin: dur,
    };

    setRoutes((prev) => [newRoute, ...prev]);
    setShowAddModal(false);

    // Tự động kích hoạt tuyến mới vừa tạo
    handleDispatchRoute(newRoute, true);
  }

  return (
    <div className="page-view route-management-view">
      {/* ── 1. THẺ THỐNG KÊ MẠNG LƯỚI TUYẾN ── */}
      <section className="rm-stats-grid" aria-label="Thống kê mạng lưới tuyến">
        <div className="rm-stat-card">
          <div className="rm-stat-icon">🛣️</div>
          <div className="rm-stat-info">
            <span className="rm-stat-value">{stats.total}</span>
            <span className="rm-stat-label">Tổng số tuyến phân bổ</span>
          </div>
        </div>

        <div className="rm-stat-card">
          <div className="rm-stat-icon" style={{ color: "#2dd4bf", background: "rgba(45, 212, 191, 0.15)" }}>
            🚚
          </div>
          <div className="rm-stat-info">
            <span className="rm-stat-value" style={{ color: "#2dd4bf" }}>
              {stats.inTransit}
            </span>
            <span className="rm-stat-label">Tuyến đang chạy (Live)</span>
          </div>
        </div>

        <div className="rm-stat-card">
          <div className="rm-stat-icon" style={{ color: "#4ade80", background: "rgba(74, 222, 128, 0.15)" }}>
            ✓
          </div>
          <div className="rm-stat-info">
            <span className="rm-stat-value">{stats.completed}</span>
            <span className="rm-stat-label">Tuyến đã hoàn tất</span>
          </div>
        </div>

        <div className="rm-stat-card">
          <div className="rm-stat-icon" style={{ color: "#38bdf8", background: "rgba(56, 189, 248, 0.15)" }}>
            📍
          </div>
          <div className="rm-stat-info">
            <span className="rm-stat-value">{stats.totalDistance} km</span>
            <span className="rm-stat-label">Tổng cự ly mạng lưới</span>
          </div>
        </div>
      </section>

      {/* ── 2. THANH CÔNG CỤ TÌM KIẾM, LỌC & NÚT THÊM TUYẾN ── */}
      <div className="rm-toolbar">
        <div className="rm-search-box">
          <span>🔍</span>
          <input
            type="text"
            className="rm-search-input"
            placeholder="Tìm theo mã tuyến, mã chuyến, kho bãi hoặc biển số..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer" }}
            >
              ✕
            </button>
          )}
        </div>

        <div className="rm-filters">
          <button
            className={`rm-filter-btn ${filterStatus === "ALL" ? "active" : ""}`}
            onClick={() => setFilterStatus("ALL")}
          >
            Tất cả ({routes.length})
          </button>
          <button
            className={`rm-filter-btn ${filterStatus === "IN_TRANSIT" ? "active" : ""}`}
            onClick={() => setFilterStatus("IN_TRANSIT")}
          >
            Đang chạy ({stats.inTransit})
          </button>
          <button
            className={`rm-filter-btn ${filterStatus === "IDLE" ? "active" : ""}`}
            onClick={() => setFilterStatus("IDLE")}
          >
            Chờ xuất phát ({routes.filter((r) => r.status === "IDLE").length})
          </button>
          <button
            className={`rm-filter-btn ${filterStatus === "COMPLETED" ? "active" : ""}`}
            onClick={() => setFilterStatus("COMPLETED")}
          >
            Đã xong ({stats.completed})
          </button>
        </div>

        <button
          className="btn-add-route"
          type="button"
          onClick={() => setShowAddModal(true)}
        >
          <span>＋</span> Phân bổ tuyến mới
        </button>
      </div>

      {/* ── 3. DANH SÁCH CÁC TUYẾN VẬN CHUYỂN ── */}
      <section className="rm-routes-grid" aria-label="Danh sách các tuyến vận chuyển">
        {filteredRoutes.map((route) => {
          const origin = LOGISTICS_HUBS.origins.find((h) => h.id === route.originId);
          const dest = LOGISTICS_HUBS.destinations.find((h) => h.id === route.destId);
          const isCurrentActive =
            activeRoute?.origin?.id === route.originId &&
            activeRoute?.destination?.id === route.destId;

          return (
            <article
              key={route.id}
              className={`rm-route-card ${isCurrentActive ? "is-active" : ""}`}
            >
              <div className="rm-route-card-header">
                <div className="rm-route-id-group">
                  <span className="rm-route-id">{route.id}</span>
                  <span className="rm-route-trip-tag">📦 {route.tripId}</span>
                </div>

                <div
                  className={`rm-route-status-tag ${
                    route.status === "IN_TRANSIT"
                      ? "in-transit"
                      : route.status === "COMPLETED"
                      ? "completed"
                      : "idle"
                  }`}
                >
                  {route.status === "IN_TRANSIT" && <span className="rm-pulse-dot" />}
                  {route.status === "IN_TRANSIT"
                    ? "ĐANG CHẠY"
                    : route.status === "COMPLETED"
                    ? "HOÀN TẤT"
                    : "CHỜ XUẤT PHÁT"}
                </div>
              </div>

              <div className="rm-route-card-body">
                {/* Lộ trình điểm đi ➔ điểm đến */}
                <div className="rm-route-path">
                  <div className="rm-path-point origin">
                    <span className="rm-point-label">Điểm xuất phát</span>
                    <span className="rm-point-name">{origin?.name || "Kho hàng xuất phát"}</span>
                    <span className="rm-point-addr">{origin?.address}</span>
                  </div>

                  <div className="rm-path-point destination">
                    <span className="rm-point-label">Điểm nhận hàng</span>
                    <span className="rm-point-name">{dest?.name || "Điểm giao nhận"}</span>
                    <span className="rm-point-addr">{dest?.address}</span>
                  </div>
                </div>

                {/* Thông số cự ly, thời gian, số điểm */}
                <div className="rm-route-metrics-bar">
                  <div className="rm-metric-item">
                    <span className="rm-metric-val">{route.distanceKm} km</span>
                    <span className="rm-metric-lbl">Quãng đường</span>
                  </div>
                  <div className="rm-metric-item">
                    <span className="rm-metric-val">~{route.durationMin} phút</span>
                    <span className="rm-metric-lbl">Thời gian dự kiến</span>
                  </div>
                  <div className="rm-metric-item">
                    <span className="rm-metric-val">35-50 km/h</span>
                    <span className="rm-metric-lbl">Tốc độ tiêu chuẩn</span>
                  </div>
                </div>

                {/* Thông tin phụ xe & hàng hóa */}
                <div className="rm-route-card-meta">
                  <span className="rm-meta-pill">🚚 Xe: <strong>{route.vehiclePlate}</strong></span>
                  <span className="rm-meta-pill">📟 Thiết bị: <strong>{route.deviceId}</strong></span>
                  <span className="rm-meta-pill">❄️ Hàng: {route.cargo}</span>
                </div>
              </div>

              {/* Nút thao tác điều phối */}
              <div className="rm-route-card-actions">
                <button
                  type="button"
                  className={`btn-route-action ${isCurrentActive ? "primary" : ""}`}
                  onClick={() => handleDispatchRoute(route, false)}
                  title="Chọn tuyến này làm tuyến điều phối chính cho hệ thống"
                >
                  {isCurrentActive ? "✓ Tuyến đang kích hoạt" : "🚀 Điều phối tuyến này"}
                </button>

                <button
                  type="button"
                  className="btn-route-action"
                  onClick={() => handleDispatchRoute(route, true)}
                  title="Chuyển đến bản đồ GPS để xem lộ trình thời gian thực"
                >
                  🗺️ Bản đồ GPS
                </button>

                <button
                  type="button"
                  className="btn-route-action"
                  onClick={() => {
                    if (onSelectTrip) onSelectTrip(route.tripId);
                    if (onNavigate) onNavigate("reports");
                  }}
                  title="Xem chứng nhận và báo cáo chất lượng chuyến của tuyến này"
                >
                  📋 Báo cáo
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {/* ── MODAL: TẠO / PHÂN BỔ TUYẾN MỚI ── */}
      {showAddModal && (
        <div className="rm-modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="rm-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="rm-modal-header">
              <div className="rm-modal-title">Phân bổ &amp; Khởi tạo Tuyến Vận Chuyển Mới</div>
              <button
                type="button"
                className="rm-modal-close"
                onClick={() => setShowAddModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddRouteSubmit} className="rm-modal-form">
              <div className="rm-form-group">
                <label className="rm-form-label">Kho lạnh xuất phát (Origin Hub)</label>
                <select
                  className="rm-form-select"
                  value={newRouteForm.originId}
                  onChange={(e) =>
                    setNewRouteForm({ ...newRouteForm, originId: e.target.value })
                  }
                  required
                >
                  {LOGISTICS_HUBS.origins.map((hub) => (
                    <option key={hub.id} value={hub.id}>
                      {hub.name} ({hub.shortName})
                    </option>
                  ))}
                </select>
              </div>

              <div className="rm-form-group">
                <label className="rm-form-label">Điểm nhận hàng (Destination)</label>
                <select
                  className="rm-form-select"
                  value={newRouteForm.destId}
                  onChange={(e) =>
                    setNewRouteForm({ ...newRouteForm, destId: e.target.value })
                  }
                  required
                >
                  {LOGISTICS_HUBS.destinations.map((hub) => (
                    <option key={hub.id} value={hub.id}>
                      {hub.name} ({hub.shortName})
                    </option>
                  ))}
                </select>
              </div>

              <div className="rm-form-row">
                <div className="rm-form-group">
                  <label className="rm-form-label">Mã chuyến gán (Trip ID)</label>
                  <input
                    type="text"
                    className="rm-form-input"
                    value={newRouteForm.tripId}
                    onChange={(e) =>
                      setNewRouteForm({ ...newRouteForm, tripId: e.target.value })
                    }
                    placeholder="VD: TRIP006, trip007"
                    required
                  />
                </div>

                <div className="rm-form-group">
                  <label className="rm-form-label">Biển số xe phụ trách</label>
                  <input
                    type="text"
                    className="rm-form-input"
                    value={newRouteForm.vehiclePlate}
                    onChange={(e) =>
                      setNewRouteForm({ ...newRouteForm, vehiclePlate: e.target.value })
                    }
                    placeholder="VD: 59C-998.88"
                    required
                  />
                </div>
              </div>

              <div className="rm-form-group">
                <label className="rm-form-label">Loại hàng hóa &amp; Quy chuẩn nhiệt độ</label>
                <input
                  type="text"
                  className="rm-form-input"
                  value={newRouteForm.cargo}
                  onChange={(e) =>
                    setNewRouteForm({ ...newRouteForm, cargo: e.target.value })
                  }
                  placeholder="VD: Vaccine & Dược phẩm lạnh (2°C - 8°C)"
                  required
                />
              </div>

              <div className="rm-modal-footer">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={() => setShowAddModal(false)}
                >
                  Hủy bỏ
                </button>
                <button type="submit" className="btn-add-route">
                  ✓ Lưu &amp; Bắt đầu điều phối
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
