const express = require("express");
const sql = require("mssql");

const poolPromise = require("../db");
const { publishCommand, isMqttConnected } = require("../mqttClient");

const router = express.Router();

router.get("/options", async (req, res) => {
  try {
    const pool = await poolPromise;
    const profiles = await pool.request().query(`SELECT profile_id, profile_name, min_temperature,
      max_temperature, early_warning_minutes, max_door_open_seconds FROM storage_profiles ORDER BY profile_id`);
    const lots = await pool.request().query("SELECT lot_id, profile_id, qr_code FROM lots ORDER BY lot_id");
    res.json({ profiles: profiles.recordset, lots: lots.recordset });
  } catch { res.status(503).json({ message: "Không tải được lô hàng/profile từ database" }); }
});

function validateTemperatureRange(minTemperature, maxTemperature) {
  return Number.isFinite(minTemperature) && Number.isFinite(maxTemperature)
    && minTemperature >= -40 && maxTemperature <= 80 && minTemperature < maxTemperature;
}

router.post("/delivery-mode", async (req, res) => {
  const { deviceId = "ESP32-01", tripId, deliveryMode } = req.body || {};
  if (typeof deliveryMode !== "boolean" || typeof tripId !== "string" || !/^[A-Za-z0-9_-]{1,30}$/.test(tripId) || typeof deviceId !== "string" || !/^[A-Za-z0-9_-]{1,50}$/.test(deviceId)) {
    return res.status(400).json({ message: "Mã thiết bị/chuyến hoặc Delivery Mode không hợp lệ" });
  }

  let ack;
  try {
    if (!isMqttConnected()) return res.status(503).json({ message: "MQTT hoặc kênh ACK chưa kết nối" });
    const pool = await poolPromise;
    const assigned = await pool.request().input("tripId", sql.VarChar(30), tripId)
      .input("deviceId", sql.VarChar(50), deviceId)
      .query(`SELECT t.trip_id FROM trips t INNER JOIN devices d ON d.vehicle_id = t.vehicle_id
        WHERE t.trip_id = @tripId AND d.device_id = @deviceId AND t.trip_state = 'IN_TRANSIT'`);
    if (!assigned.recordset.length) return res.status(409).json({ message: "Cần bắt đầu chuyến đang gắn với thiết bị trước khi giao hàng" });
    const command = { deliveryMode };
    if (tripId) command.tripId = String(tripId);
    ack = await publishCommand(deviceId, command);
    await pool.request()
      .input("tripId", sql.VarChar(30), tripId)
      .input("deliveryMode", sql.Bit, deliveryMode)
      .query("UPDATE trips SET delivery_mode = @deliveryMode WHERE trip_id = @tripId");
    res.json({ ok: true, deliveryMode: ack.applied.deliveryMode, commandId: ack.commandId, acknowledged: true,
      message: `ESP32 đã xác nhận Delivery Mode ${ack.applied.deliveryMode ? "ON" : "OFF"}.` });
  } catch (error) {
    res.status(error.statusCode || 503).json({ message: ack
      ? "ESP32 đã áp dụng Delivery Mode nhưng không lưu được database. Hãy kiểm tra Backend trước khi gửi lệnh khác."
      : error.message || "Không xác nhận được lệnh với ESP32" });
  }
});

router.post("/start-trip", async (req, res) => {
  const {
    deviceId = "ESP32-01",
    tripId = "TRIP001",
    lotId,
    profileId,
    minTemperature,
    maxTemperature,
    deliveryMode = false
  } = req.body || {};
  const min = minTemperature;
  const max = maxTemperature;

  if (!/^[A-Za-z0-9_-]+$/.test(String(deviceId)) || !/^[A-Za-z0-9_-]+$/.test(String(tripId))) {
    return res.status(400).json({ message: "deviceId hoặc tripId không hợp lệ" });
  }
  if (!validateTemperatureRange(min, max)) {
    return res.status(400).json({ message: "Tmin/Tmax phải trong khoảng -40..80 và Tmin < Tmax" });
  }
  if (typeof deliveryMode !== "boolean") {
    return res.status(400).json({ message: "deliveryMode phải là boolean" });
  }

  if (typeof lotId !== "string" || !/^[A-Za-z0-9_-]{1,50}$/.test(lotId) || typeof profileId !== "string" || !/^[A-Za-z0-9_-]{1,47}$/.test(profileId) || String(tripId).length > 30) {
    return res.status(400).json({ message: "Nhập mã lô hàng và Storage Profile hợp lệ" });
  }
  if (!isMqttConnected()) return res.status(503).json({ message: "MQTT hoặc kênh ACK chưa kết nối. Hãy chạy broker và ESP32 trước." });

  let transaction;
  let ack;

  try {
    const pool = await poolPromise;
    const tripResult = await pool.request()
      .input("tripId", sql.VarChar(30), tripId)
      .input("deviceId", sql.VarChar(50), deviceId)
      .query(`
        SELECT t.trip_id FROM trips t INNER JOIN devices d ON d.vehicle_id = t.vehicle_id
        WHERE t.trip_id = @tripId AND d.device_id = @deviceId
      `);
    if (!tripResult.recordset.length) throw new Error("Không tìm thấy chuyến đang gắn với thiết bị");
    const lot = await pool.request().input("lotId", sql.VarChar(50), lotId)
      .query("SELECT lot_id FROM lots WHERE lot_id = @lotId");
    if (!lot.recordset.length) throw new Error("Không tìm thấy lô hàng trong database");
    const profiles = await pool.request().input("profileId", sql.VarChar(50), profileId)
      .query("SELECT early_warning_minutes, max_door_open_seconds FROM storage_profiles WHERE profile_id = @profileId");
    if (!profiles.recordset.length) throw new Error("Không tìm thấy Storage Profile");
    const profile = profiles.recordset[0];

    const command = {
      tripId,
      tripState: "IN_TRANSIT",
      profileId,
      Tmin: min,
      Tmax: max,
      earlyWarningMinutes: profile.early_warning_minutes,
      maxDoorOpenSeconds: profile.max_door_open_seconds,
      deliveryMode: false
    };
    ack = await publishCommand(deviceId, command);

    transaction = new sql.Transaction(pool);
    await transaction.begin();
    const request = () => new sql.Request(transaction);
    await request()
      .input("tripId", sql.VarChar(30), tripId)
      .input("minTemperature", sql.Float, min)
      .input("maxTemperature", sql.Float, max)
      .input("profileId", sql.VarChar(50), profileId)
      .input("warning", sql.Int, profile.early_warning_minutes)
      .input("doorLimit", sql.Int, profile.max_door_open_seconds)
      .query(`
        UPDATE trips SET trip_state = 'IN_TRANSIT', min_temperature = @minTemperature,
          max_temperature = @maxTemperature, delivery_mode = 0, profile_id = @profileId,
          early_warning_minutes = @warning, max_door_open_seconds = @doorLimit,
          start_time = SYSDATETIMEOFFSET(), end_time = NULL
        WHERE trip_id = @tripId
      `);
    await request().input("tripId", sql.VarChar(30), tripId)
      .query("DELETE FROM trip_lots WHERE trip_id = @tripId");
    await request().input("tripId", sql.VarChar(30), tripId).input("lotId", sql.VarChar(50), lotId)
      .query("INSERT INTO trip_lots (trip_id, lot_id) VALUES (@tripId, @lotId)");
    await transaction.commit();
    res.json({ ok: true, tripId, lotId, profileId, tripState: "IN_TRANSIT", Tmin: min, Tmax: max,
      deliveryMode: false, commandId: ack.commandId, acknowledged: true,
      message: "ESP32 đã xác nhận và áp dụng cấu hình chuyến." });
  } catch (error) {
    if (transaction) { try { await transaction.rollback(); } catch {} }
    res.status(error.statusCode || (ack ? 503 : 400)).json({ message: ack
      ? "ESP32 đã áp dụng cấu hình nhưng không lưu được database. Hãy kiểm tra Backend trước khi gửi lệnh khác."
      : error.message || "Không bắt đầu được chuyến" });
  }
});

module.exports = router;
