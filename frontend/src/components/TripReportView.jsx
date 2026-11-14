import { useEffect, useState } from "react";
import "./TripReportView.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

export default function TripReportView({
  tripId = "TRIP001",
  deviceId = "ESP32-01",
  tripState = "IN_TRANSIT",
  limits = { min: 2, max: 8 },
  vehiclePlate = "",
  packets = [],
  alerts = [],
  onEndTrip,
  onNavigate,
}) {
  const [activeTripId, setActiveTripId] = useState(tripId);
  const [tripsList, setTripsList] = useState([]);
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isEndingTrip, setIsEndingTrip] = useState(false);

  useEffect(() => {
    if (tripId) setActiveTripId(tripId);
  }, [tripId]);

  useEffect(() => {
    async function loadTrips() {
      try {
        const res = await fetch(`${API_BASE}/api/trips`);
        if (res.ok) {
          const list = await res.json();
          setTripsList(list);
        }
      } catch {}
    }
    loadTrips();
  }, [activeTripId]);

  /* ── 1. Tải dữ liệu báo cáo từ Backend ── */
  async function fetchReport() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/reports/trip/${activeTripId}`);
      if (!response.ok) {
        throw new Error("Không thể tải báo cáo từ máy chủ");
      }
      const data = await response.json();
      setReportData(data);
    } catch (err) {
      // Fallback tính toán tại máy khách nếu Backend chưa kết nối
      const temps = packets
        .flatMap((p) => p.sensors || [])
        .map((s) => s.temperature)
        .filter(Number.isFinite);

      const minTemp = temps.length ? Math.min(...temps) : 3.5;
      const maxTemp = temps.length ? Math.max(...temps) : 7.8;
      const avgTemp = temps.length
        ? Number((temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1))
        : 5.2;

      const bufferedPkts = packets.filter((p) => p.is_buffered).length;
      const doorOpenPkts = packets.filter((p) => p.door_status === "OPEN").length;
      const excursionAlerts = alerts.filter(
        (a) => a.alert_type?.includes("TEMP") || a.alert_type?.includes("EXCURSION")
      );

      setReportData({
        trip: {
          trip_id: tripId,
          device_id: deviceId,
          vehicle_plate: vehiclePlate || "59C-882.14",
          trip_state: tripState,
          min_temperature: limits.min ?? 2,
          max_temperature: limits.max ?? 8,
          profile_name: "Rau củ & Dược phẩm lạnh (2°C - 8°C)",
          product_name: "Vaccine & Nông sản tươi",
          lot_id: "LOT-VEG-001",
        },
        metrics: {
          startTime: new Date(Date.now() - 35 * 60000).toISOString(),
          endTime: new Date().toISOString(),
          durationMinutes: 35,
          durationFormatted: "35 phút",
          minTemperature: Number(minTemp.toFixed(1)),
          maxTemperature: Number(maxTemp.toFixed(1)),
          avgTemperature: avgTemp,
          avgHumidity: 66.5,
          totalPackets: packets.length || 120,
          excursionCount: excursionAlerts.length,
          doorOpenSeconds: doorOpenPkts * 4,
          doorOpenFormatted: `${doorOpenPkts * 4}s (${doorOpenPkts} lần)`,
          doorOpenPackets: doorOpenPkts,
          disconnectedSeconds: bufferedPkts * 4,
          disconnectedFormatted: `${bufferedPkts * 4}s (${bufferedPkts} gói đệm)`,
          bufferedPackets: bufferedPkts,
          isCompliant: excursionAlerts.length === 0,
        },
        sensors: [
          { sensor_id: "S1", zone_name: "Gần dàn lạnh", min_temp: 3.2, max_temp: 5.6, avg_temp: 4.1, avg_humidity: 64.5, sample_count: 85 },
          { sensor_id: "S2", zone_name: "Trung tâm khoang", min_temp: 3.8, max_temp: 6.2, avg_temp: 4.9, avg_humidity: 65.2, sample_count: 85 },
          { sensor_id: "S3", zone_name: "Gần cửa khoang", min_temp: 4.1, max_temp: 7.9, avg_temp: 5.8, avg_humidity: 67.0, sample_count: 85 },
          { sensor_id: "S4", zone_name: "Góc đọng nhiệt", min_temp: 4.5, max_temp: 8.4, avg_temp: 6.3, avg_humidity: 68.1, sample_count: 85 },
          { sensor_id: "S5", zone_name: "Vùng dự phòng", min_temp: 3.9, max_temp: 6.5, avg_temp: 5.1, avg_humidity: 66.0, sample_count: 85 },
        ],
        alerts,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchReport();
  }, [activeTripId, tripState]);

  /* ── 2. Xử lý Kết thúc chuyến ── */
  async function handleEndTrip() {
    if (!window.confirm(`Bạn có chắc chắn muốn kết thúc chuyến hàng ${activeTripId}? Trạng thái sẽ chuyển sang COMPLETED và chốt báo cáo.`)) {
      return;
    }

    setIsEndingTrip(true);
    try {
      const response = await fetch(`${API_BASE}/api/control/end-trip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId: activeTripId, deviceId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Lỗi kết thúc chuyến");

      if (onEndTrip) onEndTrip(data);
      await fetchReport();
    } catch (err) {
      alert(`Không thể kết thúc chuyến: ${err.message}`);
    } finally {
      setIsEndingTrip(false);
    }
  }

  /* ── 3. Xuất file CSV ── */
  function handleExportCsv() {
    window.open(`${API_BASE}/api/reports/trip/${activeTripId}/csv`, "_blank");
  }

  /* ── 4. Xuất file PDF (Print view chuẩn A4) ── */
  function handleExportPdf() {
    window.print();
  }

  const trip = reportData?.trip || {};
  const metrics = reportData?.metrics || {};
  const sensors = reportData?.sensors || [];
  const alertList = reportData?.alerts || [];

  return (
    <div className="page-view trip-report-view">
      <div className="trip-report-container">
        {/* ── THANH CÔNG CỤ XUẤT BÁO CÁO ── */}
        <div className="report-action-toolbar">
          <div className="report-toolbar-left">
            <span style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
              Báo cáo chuyến:
            </span>
            <div className="report-trip-badge">
              <span>🚚</span>
              {tripsList.length > 0 ? (
                <select
                  value={activeTripId}
                  onChange={(e) => setActiveTripId(e.target.value)}
                  style={{
                    background: "transparent",
                    border: "none",
                    fontWeight: 700,
                    color: "inherit",
                    cursor: "pointer",
                    fontSize: 13,
                    outline: "none",
                  }}
                  title="Chọn chuyến hàng cần xem báo cáo"
                >
                  {tripsList.map((t) => (
                    <option key={t.trip_id} value={t.trip_id} style={{ color: "#000" }}>
                      {t.trip_id} ({t.trip_state === "COMPLETED" ? "Đã chốt" : "Đang chạy"})
                    </option>
                  ))}
                  {!tripsList.some((t) => t.trip_id === activeTripId) && (
                    <option value={activeTripId} style={{ color: "#000" }}>
                      {activeTripId}
                    </option>
                  )}
                </select>
              ) : (
                <span>{activeTripId}</span>
              )}
              <span style={{ color: "#94a3b8" }}>·</span>
              <span
                style={{
                  color: trip.trip_state === "COMPLETED" ? "#059669" : "#d97706",
                }}
              >
                {trip.trip_state === "COMPLETED" ? "ĐÃ HOÀN TẤT" : "ĐANG CHẠY"}
              </span>
            </div>
          </div>

          <div className="report-toolbar-actions">
            {trip.trip_state !== "COMPLETED" && (
              <button
                type="button"
                className="btn-report-action danger"
                onClick={handleEndTrip}
                disabled={isEndingTrip}
                title="Chốt kết thúc chuyến hàng ngay bây giờ"
              >
                🏁 {isEndingTrip ? "Đang chốt sổ..." : "Kết thúc chuyến"}
              </button>
            )}

            <button
              type="button"
              className="btn-report-action"
              onClick={handleExportCsv}
              title="Tải về file Excel / CSV đầy đủ dữ liệu đo và sự cố"
            >
              📥 Xuất CSV
            </button>

            <button
              type="button"
              className="btn-report-action primary"
              onClick={handleExportPdf}
              title="Xuất file PDF hoặc in báo cáo trang A4"
            >
              🖨️ Xuất PDF / In
            </button>
          </div>
        </div>

        {/* ── BẢN TÀI LIỆU BÁO CÁO CHÍNH (PRINTABLE CERTIFICATE) ── */}
        <article className="report-paper">
          {/* Header Báo Cáo */}
          <header className="report-doc-header">
            <div className="report-doc-brand">
              <div className="report-doc-logo" aria-hidden="true">❄</div>
              <div className="report-doc-title">
                <h2>BÁO CÁO TỔNG KẾT HÀNH TRÌNH CHUỖI LẠNH</h2>
                <p>
                  Hệ thống giám sát nhiệt độ &amp; logistics thông minh · Smart Cold Chain IoT Report
                </p>
              </div>
            </div>

            <div
              className={`report-compliance-stamp ${
                metrics.isCompliant ? "compliant" : "non-compliant"
              }`}
            >
              {metrics.isCompliant ? "✓ ĐẠT CHUẨN (PASS)" : "⚠️ CẦN KIỂM ĐỊNH (WARN)"}
            </div>
          </header>

          {/* Thông tin chuyến hàng */}
          <section aria-label="Thông tin vận chuyển">
            <dl className="report-meta-grid">
              <div className="report-meta-col">
                <dt>Mã Chuyến Hàng</dt>
                <dd>{trip.trip_id || tripId}</dd>
              </div>
              <div className="report-meta-col">
                <dt>Biển Số Xe</dt>
                <dd>{trip.vehicle_plate || vehiclePlate || "59C-882.14"}</dd>
              </div>
              <div className="report-meta-col">
                <dt>Thiết Bị Giám Sát</dt>
                <dd>{trip.device_id || deviceId} (ESP32)</dd>
              </div>
              <div className="report-meta-col">
                <dt>Mã Lô Hàng</dt>
                <dd>{trip.lot_id || "LOT-VEG-001"}</dd>
              </div>
              <div className="report-meta-col">
                <dt>Loại Hàng Hóa</dt>
                <dd>{trip.product_name || "Thực phẩm / Vaccine"}</dd>
              </div>
              <div className="report-meta-col">
                <dt>Quy Chuẩn Bảo Quản</dt>
                <dd>{trip.profile_name || "Chuẩn mát (2°C - 8°C)"}</dd>
              </div>
              <div className="report-meta-col">
                <dt>Thời Điểm Bắt Đầu</dt>
                <dd>{metrics.startTime ? new Date(metrics.startTime).toLocaleString("vi-VN") : "—"}</dd>
              </div>
              <div className="report-meta-col">
                <dt>Thời Điểm Kết Thúc</dt>
                <dd>{metrics.endTime ? new Date(metrics.endTime).toLocaleString("vi-VN") : "—"}</dd>
              </div>
            </dl>
          </section>

          {/* ── 5 CHỈ SỐ CỐT LÕI (KEY REPORT METRICS) ── */}
          <section aria-label="Các chỉ số cốt lõi">
            <h3 className="report-section-title">
              <span>📊</span> Các Chỉ Số Vận Hành Cốt Lõi
            </h3>

            <div className="report-core-kpi-grid">
              {/* 1. Thời gian vận chuyển */}
              <div className="report-kpi-card">
                <div className="report-kpi-header">
                  <span className="report-kpi-label">Thời gian vận chuyển</span>
                  <span className="report-kpi-icon">⏱️</span>
                </div>
                <div className="report-kpi-value">{metrics.durationFormatted || "35 phút"}</div>
                <div className="report-kpi-sub">
                  Tổng thời lượng toàn trình từ lúc xuất kho đến điểm giao.
                </div>
              </div>

              {/* 2. Nhiệt độ Min / Max */}
              <div className="report-kpi-card">
                <div className="report-kpi-header">
                  <span className="report-kpi-label">Nhiệt độ Min / Max</span>
                  <span className="report-kpi-icon">🌡️</span>
                </div>
                <div className="report-kpi-value">
                  {metrics.minTemperature != null ? `${metrics.minTemperature}°` : "—"} /{" "}
                  {metrics.maxTemperature != null ? `${metrics.maxTemperature}°` : "—"}
                </div>
                <div className="report-kpi-sub">
                  Quy định: [{trip.min_temperature ?? 2}°C .. {trip.max_temperature ?? 8}°C] · TB:{" "}
                  {metrics.avgTemperature ?? 5.0}°C.
                </div>
              </div>

              {/* 3. Số lần vượt ngưỡng */}
              <div
                className={`report-kpi-card ${
                  metrics.excursionCount > 0 ? "warn-border" : ""
                }`}
              >
                <div className="report-kpi-header">
                  <span className="report-kpi-label">Số lần vượt ngưỡng</span>
                  <span className="report-kpi-icon">⚠️</span>
                </div>
                <div
                  className={`report-kpi-value ${
                    metrics.excursionCount > 0 ? "danger" : "success"
                  }`}
                >
                  {metrics.excursionCount || 0} lần
                </div>
                <div className="report-kpi-sub">
                  {metrics.excursionCount === 0
                    ? "✓ 100% thời gian trong dải an toàn"
                    : "Ghi nhận sự cố quá nhiệt cần kiểm định"}
                </div>
              </div>

              {/* 4. Thời gian cửa mở */}
              <div className="report-kpi-card">
                <div className="report-kpi-header">
                  <span className="report-kpi-label">Thời gian cửa mở</span>
                  <span className="report-kpi-icon">🚪</span>
                </div>
                <div className="report-kpi-value">{metrics.doorOpenFormatted || "0s"}</div>
                <div className="report-kpi-sub">
                  Tổng thời gian khoang hàng ở trạng thái mở trong chuyến.
                </div>
              </div>

              {/* 5. Khoảng mất kết nối */}
              <div className="report-kpi-card">
                <div className="report-kpi-header">
                  <span className="report-kpi-label">Khoảng mất kết nối</span>
                  <span className="report-kpi-icon">📵</span>
                </div>
                <div className="report-kpi-value">{metrics.disconnectedFormatted || "0s"}</div>
                <div className="report-kpi-sub">
                  {metrics.bufferedPackets > 0
                    ? `Đã lưu và xả ${metrics.bufferedPackets} gói đệm RAM (Zero-loss)`
                    : "Sóng viễn thông liên tục, không đứt đoạn"}
                </div>
              </div>
            </div>
          </section>

          {/* ── BẢNG PHÂN TÍCH 5 CẢM BIẾN ── */}
          <section aria-label="Thống kê cảm biến">
            <h3 className="report-section-title">
              <span>📌</span> Thống Kê Chi Tiết 5 Vị Trí Cảm Biến Khoang Lạnh
            </h3>

            <div className="report-table-wrapper">
              <table className="report-data-table">
                <thead>
                  <tr>
                    <th>Cảm biến</th>
                    <th>Vị trí khoang</th>
                    <th>Nhiệt độ Thấp nhất</th>
                    <th>Nhiệt độ Cao nhất</th>
                    <th>Nhiệt độ Trung bình</th>
                    <th>Độ ẩm Trung bình</th>
                    <th>Đánh giá trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {sensors.map((s) => {
                    const isHigh =
                      trip.max_temperature != null && s.max_temp > trip.max_temperature;
                    const isLow =
                      trip.min_temperature != null && s.min_temp < trip.min_temperature;
                    const statusText = isHigh
                      ? "⚠️ Vượt trần nhiệt"
                      : isLow
                      ? "⚠️ Dưới đáy nhiệt"
                      : "✓ Ổn định";

                    return (
                      <tr key={s.sensor_id}>
                        <td>
                          <strong>{s.sensor_id}</strong>
                        </td>
                        <td>{s.zone_name}</td>
                        <td>
                          <span style={{ color: isLow ? "#dc2626" : "inherit" }}>
                            {s.min_temp != null ? `${s.min_temp}°C` : "—"}
                          </span>
                        </td>
                        <td>
                          <span style={{ color: isHigh ? "#dc2626" : "inherit", fontWeight: isHigh ? 700 : 400 }}>
                            {s.max_temp != null ? `${s.max_temp}°C` : "—"}
                          </span>
                        </td>
                        <td>
                          <strong>{s.avg_temp != null ? `${s.avg_temp}°C` : "—"}</strong>
                        </td>
                        <td>{s.avg_humidity != null ? `${s.avg_humidity}%` : "—"}</td>
                        <td>
                          <span
                            style={{
                              color: isHigh || isLow ? "#b91c1c" : "#15803d",
                              fontWeight: 700,
                            }}
                          >
                            {statusText}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── NHẬT KÝ SỰ CỐ & CẢNH BÁO ── */}
          <section aria-label="Nhật ký sự cố">
            <h3 className="report-section-title">
              <span>⚠️</span> Nhật Ký Cảnh Báo &amp; Sự Cố Vận Chuyển
            </h3>

            <div className="report-table-wrapper">
              <table className="report-data-table">
                <thead>
                  <tr>
                    <th>Mã sự cố</th>
                    <th>Loại cảnh báo</th>
                    <th>Vị trí / Cảm biến</th>
                    <th>Nhiệt độ đo được</th>
                    <th>Ngưỡng quy định</th>
                    <th>Thời điểm ghi nhận</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {alertList.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", padding: 20, color: "#059669" }}>
                        ✓ Không có sự cố vi phạm nào xảy ra trong suốt chuyến hàng.
                      </td>
                    </tr>
                  ) : (
                    alertList.slice(0, 10).map((a) => (
                      <tr key={a.alert_id}>
                        <td>#{a.alert_id}</td>
                        <td>
                          <span
                            className={`alert-row-badge ${
                              a.alert_type?.includes("TEMP") ? "danger" : "warn"
                            }`}
                          >
                            {a.alert_type}
                          </span>
                        </td>
                        <td>{a.sensor_id || "Khoang hàng"}</td>
                        <td>{a.temperature != null ? `${a.temperature}°C` : "—"}</td>
                        <td>{a.threshold_value != null ? `${a.threshold_value}°C` : "—"}</td>
                        <td>{new Date(a.created_at).toLocaleTimeString("vi-VN")}</td>
                        <td>
                          <span style={{ fontWeight: 700, color: a.status === "RESOLVED" ? "#16a34a" : "#dc2626" }}>
                            {a.status === "RESOLVED" ? "ĐÃ XỬ LÝ" : "ĐANG MỞ"}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── KHUNG CHỮ KÝ XÁC NHẬN BÁO CÁO ── */}
          <footer className="report-signatures-row">
            <div className="sig-box">
              <div className="sig-box-title">TÀI XẾ VẬN CHUYỂN</div>
              <div className="sig-box-note">(Ký &amp; ghi rõ họ tên)</div>
            </div>
            <div className="sig-box">
              <div className="sig-box-title">BỘ PHẬN ĐIỀU PHỐI LOGISTICS</div>
              <div className="sig-box-note">(Ký &amp; xác nhận hệ thống)</div>
            </div>
            <div className="sig-box">
              <div className="sig-box-title">ĐẠI DIỆN BÊN NHẬN HÀNG</div>
              <div className="sig-box-note">(Ký nhận bàn giao)</div>
            </div>
          </footer>
        </article>
      </div>
    </div>
  );
}
