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

  let saved = false;
  try {
    if (!isMqttConnected()) return res.status(503).json({ message: "MQTT chưa kết nối" });
    const pool = await poolPromise;
    const assigned = await pool.request().input("tripId", sql.VarChar(30), tripId)
      .input("deviceId", sql.VarChar(50), deviceId)
      .query(`SELECT t.trip_id FROM trips t INNER JOIN devices d ON d.vehicle_id = t.vehicle_id
        WHERE t.trip_id = @tripId AND d.device_id = @deviceId AND t.trip_state = 'IN_TRANSIT'`);
    if (!assigned.recordset.length) return res.status(409).json({ message: "Cần bắt đầu chuyến đang gắn với thiết bị trước khi giao hàng" });
    const command = { deliveryMode };
    if (tripId) command.tripId = String(tripId);
    if (tripId) {
      const pool = await poolPromise;
      await pool.request()
        .input("tripId", sql.VarChar(30), tripId)
        .input("deliveryMode", sql.Bit, deliveryMode)
        .query("UPDATE trips SET delivery_mode = @deliveryMode WHERE trip_id = @tripId");
    }
    saved = true;
    await publishCommand(deviceId, command);
    res.json({ ok: true, deliveryMode });
  } catch (error) {
    res.status(503).json({ message: saved ? "Đã lưu Delivery Mode nhưng chưa gửi được MQTT. Kết nối lại và thử lại." : error.message || "Không gửi được lệnh MQTT" });
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
  if (!isMqttConnected()) return res.status(503).json({ message: "MQTT chưa kết nối. Hãy chạy broker trước." });

  let transaction;
  let committed = false;

  try {
    const pool = await poolPromise;
    transaction = new sql.Transaction(pool);
    await transaction.begin();
    const request = () => new sql.Request(transaction);
    const tripResult = await request()
      .input("tripId", sql.VarChar(30), tripId)
      .input("deviceId", sql.VarChar(50), deviceId)
      .query(`
        SELECT t.trip_id FROM trips t INNER JOIN devices d ON d.vehicle_id = t.vehicle_id
        WHERE t.trip_id = @tripId AND d.device_id = @deviceId
      `);
    if (!tripResult.recordset.length) throw new Error("Không tìm thấy chuyến đang gắn với thiết bị");
    const lot = await request().input("lotId", sql.VarChar(50), lotId)
      .query("SELECT lot_id FROM lots WHERE lot_id = @lotId");
    if (!lot.recordset.length) throw new Error("Không tìm thấy lô hàng trong database");
    const profiles = await request().input("profileId", sql.VarChar(50), profileId)
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
    committed = true;
    await publishCommand(deviceId, command);
    res.json({ ok: true, tripId, lotId, profileId, tripState: "IN_TRANSIT", Tmin: min, Tmax: max, deliveryMode: false });
  } catch (error) {
    if (transaction && !committed) { try { await transaction.rollback(); } catch {} }
    res.status(committed ? 503 : 400).json({ message: committed
      ? "Đã lưu chuyến nhưng chưa gửi được lệnh MQTT. Kết nối lại và bấm Bắt đầu chuyến để gửi lại."
      : error.message || "Không bắt đầu được chuyến" });
  }
});

module.exports = router;
