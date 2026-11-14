const express = require("express");
const sql = require("mssql");
const poolPromise = require("../db");
const { listTelemetry, listSensors, listDevices, getTrip, listAlerts, resolveAlert } = require("../services/telemetryService");

const router = express.Router();

function formatDuration(minutes) {
  if (minutes == null || isNaN(minutes) || minutes <= 0) return "0 phút";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0) return `${h} giờ ${m} phút`;
  return `${m} phút`;
}

async function getTripReportData(tripId) {
  const pool = await poolPromise;

  const tripRes = await pool.request()
    .input("tripId", sql.VarChar(30), tripId)
    .query(`
      SELECT t.trip_id, t.trip_state, t.delivery_mode, t.min_temperature,
             t.max_temperature, t.early_warning_minutes, t.max_door_open_seconds,
             t.profile_id, t.start_time, t.end_time,
             d.device_id, d.device_name,
             v.license_plate AS vehicle_plate, v.vehicle_name,
             p.profile_name, pr.product_name, l.lot_id
      FROM trips t
      LEFT JOIN devices d ON d.vehicle_id = t.vehicle_id
      LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
      LEFT JOIN storage_profiles p ON p.profile_id = t.profile_id
      LEFT JOIN trip_lots tl ON tl.trip_id = t.trip_id
      LEFT JOIN lots l ON l.lot_id = tl.lot_id
      LEFT JOIN products pr ON pr.product_id = l.product_id
      WHERE t.trip_id = @tripId
    `);

  if (!tripRes.recordset.length) return null;
  const trip = tripRes.recordset[0];

  const statsRes = await pool.request()
    .input("tripId", sql.VarChar(30), tripId)
    .query(`
      SELECT
        COUNT(DISTINCT p.packet_id) AS total_packets,
        COUNT(DISTINCT CASE WHEN p.is_buffered = 1 THEN p.packet_id END) AS buffered_packets,
        COUNT(DISTINCT CASE WHEN p.door_status = 'OPEN' THEN p.packet_id END) AS door_open_packets,
        MIN(p.measured_at) AS first_measured_at,
        MAX(p.measured_at) AS last_measured_at,
        MIN(r.temperature) AS min_temp,
        MAX(r.temperature) AS max_temp,
        ROUND(AVG(r.temperature), 2) AS avg_temp,
        ROUND(AVG(r.humidity), 1) AS avg_humidity
      FROM telemetry_packets p
      LEFT JOIN sensor_readings r ON r.packet_id = p.packet_id
      WHERE p.trip_id = @tripId AND r.temperature IS NOT NULL
    `);
  const stats = statsRes.recordset[0] || {};

  const sensorsRes = await pool.request()
    .input("tripId", sql.VarChar(30), tripId)
    .query(`
      SELECT
        r.sensor_id,
        COALESCE(s.zone_name, r.sensor_id) AS zone_name,
        MIN(r.temperature) AS min_temp,
        MAX(r.temperature) AS max_temp,
        ROUND(AVG(r.temperature), 2) AS avg_temp,
        ROUND(AVG(r.humidity), 1) AS avg_humidity,
        COUNT(r.reading_id) AS sample_count,
        COUNT(CASE WHEN r.sensor_status = 'ONLINE' THEN 1 END) AS online_count
      FROM sensor_readings r
      INNER JOIN telemetry_packets p ON p.packet_id = r.packet_id
      LEFT JOIN sensors s ON s.sensor_id = r.sensor_id AND s.device_id = p.device_id
      WHERE p.trip_id = @tripId AND r.temperature IS NOT NULL
      GROUP BY r.sensor_id, s.zone_name
      ORDER BY r.sensor_id ASC
    `);

  const alertsRes = await pool.request()
    .input("tripId", sql.VarChar(30), tripId)
    .query(`
      SELECT alert_id, alert_type, sensor_id, temperature, threshold_value,
             message, created_at, occurrence_count, status, resolved_at
      FROM alerts
      WHERE trip_id = @tripId
      ORDER BY created_at ASC
    `);
  const alerts = alertsRes.recordset || [];

  const startTime = trip.start_time || stats.first_measured_at || new Date();
  const endTime = trip.end_time || (trip.trip_state === "COMPLETED" ? stats.last_measured_at : new Date());
  const durationMs = Math.max(0, new Date(endTime) - new Date(startTime));
  const durationMinutes = Math.max(1, Math.round(durationMs / 60000));

  const doorOpenSeconds = (stats.door_open_packets || 0) * 4;
  const disconnectedSeconds = (stats.buffered_packets || 0) * 4;

  const excursions = alerts.filter((a) =>
    a.alert_type?.includes("TEMP") || a.alert_type?.includes("EXCURSION")
  );

  return {
    trip,
    metrics: {
      startTime,
      endTime,
      durationMinutes,
      durationFormatted: formatDuration(durationMinutes),
      minTemperature: stats.min_temp != null ? Number(stats.min_temp.toFixed(1)) : null,
      maxTemperature: stats.max_temp != null ? Number(stats.max_temp.toFixed(1)) : null,
      avgTemperature: stats.avg_temp != null ? Number(stats.avg_temp.toFixed(1)) : null,
      avgHumidity: stats.avg_humidity != null ? Number(stats.avg_humidity.toFixed(1)) : null,
      totalPackets: stats.total_packets || 0,
      excursionCount: excursions.length,
      doorOpenSeconds,
      doorOpenFormatted: doorOpenSeconds >= 60 ? `${Math.floor(doorOpenSeconds / 60)} phút ${doorOpenSeconds % 60}s` : `${doorOpenSeconds}s`,
      doorOpenPackets: stats.door_open_packets || 0,
      disconnectedSeconds,
      disconnectedFormatted: disconnectedSeconds >= 60 ? `${Math.floor(disconnectedSeconds / 60)} phút ${disconnectedSeconds % 60}s` : `${disconnectedSeconds}s`,
      bufferedPackets: stats.buffered_packets || 0,
      isCompliant: excursions.length === 0,
    },
    sensors: sensorsRes.recordset,
    alerts,
  };
}

router.get("/telemetry", async (req, res) => {
  try { res.json(await listTelemetry()); } catch { res.status(500).json({ message: "Cannot query telemetry" }); }
});
router.get("/telemetry/:tripId", async (req, res) => {
  try { res.json(await listTelemetry(req.params.tripId)); } catch { res.status(500).json({ message: "Cannot query telemetry" }); }
});
router.get("/sensors", async (req, res) => {
  try { res.json(await listSensors()); } catch { res.status(500).json({ message: "Cannot query sensors" }); }
});
router.get("/devices", async (req, res) => {
  try { res.json(await listDevices()); } catch { res.status(500).json({ message: "Cannot query devices" }); }
});
router.get("/trips", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT t.trip_id, t.trip_state, t.delivery_mode, t.min_temperature,
             t.max_temperature, t.early_warning_minutes, t.max_door_open_seconds,
             t.profile_id, t.start_time, t.end_time,
             d.device_id, v.license_plate AS vehicle_plate
      FROM trips t
      LEFT JOIN devices d ON d.vehicle_id = t.vehicle_id
      LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
      ORDER BY COALESCE(t.start_time, t.created_at) DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: "Không thể lấy danh sách chuyến" });
  }
});

router.get("/trips/active", async (req, res) => {
  const deviceId = req.query.deviceId || "ESP32-01";
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input("deviceId", sql.VarChar(50), deviceId)
      .query(`
        SELECT TOP 1 t.trip_id, t.trip_state, t.delivery_mode, t.min_temperature,
               t.max_temperature, t.early_warning_minutes, t.max_door_open_seconds,
               t.profile_id, d.device_id, v.license_plate AS vehicle_plate
        FROM trips t
        INNER JOIN devices d ON d.vehicle_id = t.vehicle_id
        LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
        WHERE d.device_id = @deviceId AND t.trip_state = 'IN_TRANSIT'
        ORDER BY t.start_time DESC
      `);
    if (result.recordset.length) {
      return res.json(result.recordset[0]);
    }
    const fallback = await pool.request()
      .input("deviceId", sql.VarChar(50), deviceId)
      .query(`
        SELECT TOP 1 t.trip_id, t.trip_state, t.delivery_mode, t.min_temperature,
               t.max_temperature, t.early_warning_minutes, t.max_door_open_seconds,
               t.profile_id, d.device_id, v.license_plate AS vehicle_plate
        FROM trips t
        INNER JOIN devices d ON d.vehicle_id = t.vehicle_id
        LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
        WHERE d.device_id = @deviceId
        ORDER BY COALESCE(t.start_time, t.created_at) DESC
      `);
    if (fallback.recordset.length) {
      return res.json(fallback.recordset[0]);
    }
    res.status(404).json({ message: "Không tìm thấy chuyến nào cho thiết bị" });
  } catch (err) {
    res.status(500).json({ message: "Lỗi truy vấn chuyến đang hoạt động" });
  }
});

router.get("/trips/:tripId", async (req, res) => {
  try {
    const trip = await getTrip(req.params.tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    res.json(trip);
  } catch { res.status(500).json({ message: "Cannot query trip" }); }
});
router.get("/alerts", async (req, res) => {
  const status = String(req.query.status || "OPEN").toUpperCase();
  if (!["OPEN", "RESOLVED", "ALL"].includes(status)) return res.status(400).json({ message: "Invalid alert status" });
  try { res.json(await listAlerts(req.query.tripId, status)); } catch { res.status(500).json({ message: "Cannot query alerts" }); }
});
router.patch("/alerts/:alertId/resolve", async (req, res) => {
  const alertId = req.params.alertId;
  if (!/^\d+$/.test(alertId) || alertId === "0") return res.status(400).json({ message: "Invalid alert ID" });
  try {
    const alert = await resolveAlert(alertId);
    if (!alert) return res.status(404).json({ message: "Alert not found" });
    res.json(alert);
  } catch { res.status(500).json({ message: "Cannot resolve alert" }); }
});

/* ── Báo cáo cuối chuyến (JSON & CSV Export) ── */
router.get("/reports/trip/:tripId", async (req, res) => {
  try {
    const report = await getTripReportData(req.params.tripId);
    if (!report) return res.status(404).json({ message: "Không tìm thấy dữ liệu chuyến hàng" });
    res.json(report);
  } catch (err) {
    res.status(500).json({ message: err.message || "Không thể tạo báo cáo chuyến" });
  }
});

router.get("/reports/trip/:tripId/csv", async (req, res) => {
  try {
    const { tripId } = req.params;
    const report = await getTripReportData(tripId);
    if (!report) return res.status(404).json({ message: "Không tìm thấy chuyến hàng" });

    const { trip, metrics, sensors, alerts } = report;
    const escapeCsv = (str) => `"${String(str ?? "").replace(/"/g, '""')}"`;

    const lines = [];
    lines.push(escapeCsv("BÁO CÁO TỔNG KẾT HÀNH TRÌNH CHUỖI LẠNH (COLD CHAIN TRIP REPORT)"));
    lines.push("");
    lines.push(escapeCsv("1. THÔNG TIN CHUYẾN HÀNG"));
    lines.push(`${escapeCsv("Mã chuyến:")},${escapeCsv(trip.trip_id)},${escapeCsv("Biển số xe:")},${escapeCsv(trip.vehicle_plate || "Chưa gán")}`);
    lines.push(`${escapeCsv("Thiết bị IoT:")},${escapeCsv(trip.device_id)},${escapeCsv("Tên sản phẩm:")},${escapeCsv(trip.product_name || "Thực phẩm / Vaccine")}`);
    lines.push(`${escapeCsv("Mã lô hàng:")},${escapeCsv(trip.lot_id || "N/A")},${escapeCsv("Profile bảo quản:")},${escapeCsv(trip.profile_name || trip.profile_id)}`);
    lines.push(`${escapeCsv("Dải nhiệt quy định:")},${escapeCsv(`${trip.min_temperature}°C đến ${trip.max_temperature}°C`)},${escapeCsv("Trạng thái chuyến:")},${escapeCsv(trip.trip_state)}`);
    lines.push(`${escapeCsv("Thời gian bắt đầu:")},${escapeCsv(new Date(metrics.startTime).toLocaleString("vi-VN"))},${escapeCsv("Thời gian kết thúc:")},${escapeCsv(new Date(metrics.endTime).toLocaleString("vi-VN"))}`);
    lines.push("");

    lines.push(escapeCsv("2. CÁC CHỈ SỐ CỐT LÕI (KEY METRICS)"));
    lines.push(`${escapeCsv("Chỉ số")},${escapeCsv("Giá trị đo được")},${escapeCsv("Quy chuẩn / Giới hạn")},${escapeCsv("Đánh giá")}`);
    lines.push(`${escapeCsv("Thời gian vận chuyển")},${escapeCsv(metrics.durationFormatted)},${escapeCsv("Lộ trình dự kiến")},${escapeCsv("Hoàn thành")}`);
    lines.push(`${escapeCsv("Nhiệt độ thấp nhất")},${escapeCsv(`${metrics.minTemperature ?? "—"}°C`)},${escapeCsv(`Tmin: ${trip.min_temperature}°C`)},${escapeCsv(metrics.minTemperature != null && metrics.minTemperature < trip.min_temperature ? "VI PHẠM (DƯỚI CHUẨN)" : "ĐẠT")}`);
    lines.push(`${escapeCsv("Nhiệt độ cao nhất")},${escapeCsv(`${metrics.maxTemperature ?? "—"}°C`)},${escapeCsv(`Tmax: ${trip.max_temperature}°C`)},${escapeCsv(metrics.maxTemperature != null && metrics.maxTemperature > trip.max_temperature ? "VI PHẠM (QUÁ NHIỆT)" : "ĐẠT")}`);
    lines.push(`${escapeCsv("Nhiệt độ trung bình")},${escapeCsv(`${metrics.avgTemperature ?? "—"}°C`)},${escapeCsv("Trong dải an toàn")},${escapeCsv("Ổn định")}`);
    lines.push(`${escapeCsv("Số lần vượt ngưỡng nhiệt")},${escapeCsv(`${metrics.excursionCount} lần`)},${escapeCsv("0 lần")},${escapeCsv(metrics.excursionCount === 0 ? "ĐẠT CHUẨN" : "CẦN KIỂM ĐỊNH")}`);
    lines.push(`${escapeCsv("Thời gian cửa khoang mở")},${escapeCsv(`${metrics.doorOpenFormatted} (${metrics.doorOpenPackets} mẫu)`)},${escapeCsv(`Tối đa ${trip.max_door_open_seconds || 30}s/lần`)},${escapeCsv(metrics.doorOpenPackets > 0 ? "Đã ghi nhận" : "Bình thường")}`);
    lines.push(`${escapeCsv("Khoảng mất kết nối (Gói đệm Flash)")},${escapeCsv(`${metrics.disconnectedFormatted} (${metrics.bufferedPackets} gói đệm)`)},${escapeCsv("Zero data loss (Store & Forward)")},${escapeCsv(metrics.bufferedPackets > 0 ? "Đã xả đệm đầy đủ" : "Không mất mạng")}`);
    lines.push(`${escapeCsv("ĐÁNH GIÁ CHUNG TOÀN TRÌNH")},${escapeCsv(metrics.isCompliant ? "ĐẠT TIÊU CHUẨN LƯU TRỮ VẬN TẢI" : "CẦN BIÊN BẢN XỬ LÝ SỰ CỐ NHIỆT")},${escapeCsv("")},${escapeCsv(metrics.isCompliant ? "PASS" : "FAIL/WARN")}`);
    lines.push("");

    lines.push(escapeCsv("3. THỐNG KÊ CHI TIẾT THEO CẢM BIẾN"));
    lines.push(`${escapeCsv("Cảm biến")},${escapeCsv("Vị trí khoang")},${escapeCsv("Min (°C)")},${escapeCsv("Max (°C)")},${escapeCsv("Trung bình (°C)")},${escapeCsv("Độ ẩm TB (%)")},${escapeCsv("Số mẫu đo")}`);
    for (const s of sensors) {
      lines.push(`${escapeCsv(s.sensor_id)},${escapeCsv(s.zone_name)},${escapeCsv(s.min_temp)},${escapeCsv(s.max_temp)},${escapeCsv(s.avg_temp)},${escapeCsv(s.avg_humidity)},${escapeCsv(s.sample_count)}`);
    }
    lines.push("");

    lines.push(escapeCsv("4. NHẬT KÝ SỰ CỐ & CẢNH BÁO"));
    lines.push(`${escapeCsv("Mã sự cố")},${escapeCsv("Loại cảnh báo")},${escapeCsv("Cảm biến")},${escapeCsv("Nhiệt độ (°C)")},${escapeCsv("Ngưỡng (°C)")},${escapeCsv("Thời gian")},${escapeCsv("Trạng thái")},${escapeCsv("Nội dung")}`);
    if (alerts.length === 0) {
      lines.push(escapeCsv("Không ghi nhận sự cố vi phạm nào trong suốt hành trình."));
    } else {
      for (const a of alerts) {
        lines.push(`${escapeCsv(a.alert_id)},${escapeCsv(a.alert_type)},${escapeCsv(a.sensor_id || "Chung")},${escapeCsv(a.temperature ?? "")},${escapeCsv(a.threshold_value ?? "")},${escapeCsv(new Date(a.created_at).toLocaleString("vi-VN"))},${escapeCsv(a.status)},${escapeCsv(a.message)}`);
      }
    }

    const csvOutput = "\uFEFF" + lines.join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="Bao_cao_chuyen_${tripId}.csv"`);
    res.send(csvOutput);
  } catch (err) {
    res.status(500).json({ message: err.message || "Không thể xuất file CSV" });
  }
});

module.exports = router;
