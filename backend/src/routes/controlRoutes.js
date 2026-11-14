const express = require("express");
const sql = require("mssql");
const net = require("net");

const poolPromise = require("../db");
const { publishCommand, isMqttConnected } = require("../mqttClient");

/* Phụ trợ gửi lệnh Serial tới Wokwi RFC2217 (port 4000) nếu đang mở */
function sendSerialToWokwi(cmd, port = 4000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(`${cmd}\n`, () => {
        setTimeout(() => {
          socket.end();
          resolve(true);
        }, 80);
      });
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(400, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

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
  if (typeof deliveryMode !== "boolean" || typeof deviceId !== "string" || !/^[A-Za-z0-9_-]{1,50}$/.test(deviceId)) {
    return res.status(400).json({ message: "Mã thiết bị hoặc Delivery Mode không hợp lệ" });
  }

  let ack;
  try {
    if (!isMqttConnected()) return res.status(503).json({ message: "MQTT hoặc kênh ACK chưa kết nối" });
    const pool = await poolPromise;
    const assigned = await pool.request()
      .input("tripId", sql.VarChar(30), tripId || null)
      .input("deviceId", sql.VarChar(50), deviceId)
      .query(`
        SELECT TOP 1 t.trip_id
        FROM trips t
        INNER JOIN devices d ON d.vehicle_id = t.vehicle_id
        WHERE d.device_id = @deviceId
          AND (@tripId IS NULL OR t.trip_id = @tripId)
          AND t.trip_state = 'IN_TRANSIT'
        ORDER BY t.start_time DESC
      `);
    if (!assigned.recordset.length) return res.status(409).json({ message: "Cần bắt đầu chuyến đang gắn với thiết bị trước khi giao hàng" });
    const activeTripId = assigned.recordset[0].trip_id;
    const command = { deliveryMode, tripId: activeTripId };
    ack = await publishCommand(deviceId, command);
    await pool.request()
      .input("tripId", sql.VarChar(30), activeTripId)
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
    lotId = "LOT-VEG-001",
    profileId,
    minTemperature,
    maxTemperature,
    deliveryMode = false
  } = req.body || {};
  const min = minTemperature;
  const max = maxTemperature;
  const cleanTripId = String(tripId).trim();
  const cleanDeviceId = String(deviceId).trim();

  if (!/^[A-Za-z0-9_-]+$/.test(cleanDeviceId) || !/^[A-Za-z0-9_-]+$/.test(cleanTripId)) {
    return res.status(400).json({ message: "deviceId hoặc tripId không hợp lệ" });
  }
  if (!validateTemperatureRange(min, max)) {
    return res.status(400).json({ message: "Tmin/Tmax phải trong khoảng -40..80 và Tmin < Tmax" });
  }
  if (typeof deliveryMode !== "boolean") {
    return res.status(400).json({ message: "deliveryMode phải là boolean" });
  }

  if (typeof lotId !== "string" || !/^[A-Za-z0-9_-]{1,50}$/.test(lotId) || typeof profileId !== "string" || !/^[A-Za-z0-9_-]{1,47}$/.test(profileId) || cleanTripId.length > 30) {
    return res.status(400).json({ message: "Nhập mã lô hàng và Storage Profile hợp lệ" });
  }
  if (!isMqttConnected()) return res.status(503).json({ message: "MQTT hoặc kênh ACK chưa kết nối. Hãy chạy broker và ESP32 trước." });

  let transaction;
  let ack;

  try {
    const pool = await poolPromise;

    // 1. Kiểm tra thiết bị và tìm xe gán với thiết bị
    const deviceResult = await pool.request()
      .input("deviceId", sql.VarChar(50), cleanDeviceId)
      .query(`
        SELECT d.device_id, d.vehicle_id, v.license_plate
        FROM devices d
        LEFT JOIN vehicles v ON v.vehicle_id = d.vehicle_id
        WHERE d.device_id = @deviceId
      `);
    if (!deviceResult.recordset.length) {
      throw new Error(`Không tìm thấy thiết bị ${cleanDeviceId} trong hệ thống`);
    }
    const vehicleId = deviceResult.recordset[0].vehicle_id;
    if (!vehicleId) {
      throw new Error(`Thiết bị ${cleanDeviceId} chưa được gán cho phương tiện xe`);
    }

    // 2. Kiểm tra lô hàng (tự động tạo lô nếu chưa có)
    const lotRes = await pool.request().input("lotId", sql.VarChar(50), lotId)
      .query("SELECT lot_id FROM lots WHERE lot_id = @lotId");
    if (!lotRes.recordset.length) {
      const prodRes = await pool.request().query("SELECT TOP 1 product_id FROM products");
      const defaultProductId = prodRes.recordset[0]?.product_id || "VEG001";
      await pool.request()
        .input("lotId", sql.VarChar(50), lotId)
        .input("productId", sql.VarChar(30), defaultProductId)
        .input("profileId", sql.VarChar(50), profileId)
        .query(`
          INSERT INTO lots (lot_id, product_id, profile_id, quantity, qr_code)
          VALUES (@lotId, @productId, @profileId, 100, @lotId)
        `);
    }

    // 3. Kiểm tra profile
    const profiles = await pool.request().input("profileId", sql.VarChar(50), profileId)
      .query("SELECT early_warning_minutes, max_door_open_seconds FROM storage_profiles WHERE profile_id = @profileId");
    if (!profiles.recordset.length) throw new Error("Không tìm thấy Storage Profile");
    const profile = profiles.recordset[0];

    // 4. Kiểm tra xem chuyến đã tồn tại trong database chưa
    const existingTripRes = await pool.request()
      .input("tripId", sql.VarChar(30), cleanTripId)
      .query("SELECT trip_id, vehicle_id, trip_state FROM trips WHERE trip_id = @tripId");
    const tripExists = existingTripRes.recordset.length > 0;

    // 5. Gửi cấu hình chuyến sang ESP32 qua MQTT và chờ ACK
    const command = {
      tripId: cleanTripId,
      tripState: "IN_TRANSIT",
      profileId,
      Tmin: min,
      Tmax: max,
      earlyWarningMinutes: profile.early_warning_minutes,
      maxDoorOpenSeconds: profile.max_door_open_seconds,
      deliveryMode: false
    };
    ack = await publishCommand(cleanDeviceId, command);

    // 6. Cập nhật database trong transaction
    transaction = new sql.Transaction(pool);
    await transaction.begin();
    const request = () => new sql.Request(transaction);

    // Đóng bất kỳ chuyến IN_TRANSIT cũ nào của xe này
    await request()
      .input("vehicleId", sql.Int, vehicleId)
      .input("tripId", sql.VarChar(30), cleanTripId)
      .query(`
        UPDATE trips
        SET trip_state = 'COMPLETED',
            end_time = COALESCE(end_time, SYSDATETIMEOFFSET()),
            delivery_mode = 0
        WHERE vehicle_id = @vehicleId
          AND trip_id <> @tripId
          AND trip_state = 'IN_TRANSIT'
      `);

    if (tripExists) {
      // Cập nhật chuyến đã có
      await request()
        .input("tripId", sql.VarChar(30), cleanTripId)
        .input("vehicleId", sql.Int, vehicleId)
        .input("minTemperature", sql.Float, min)
        .input("maxTemperature", sql.Float, max)
        .input("profileId", sql.VarChar(50), profileId)
        .input("warning", sql.Int, profile.early_warning_minutes)
        .input("doorLimit", sql.Int, profile.max_door_open_seconds)
        .query(`
          UPDATE trips
          SET vehicle_id = @vehicleId,
              trip_state = 'IN_TRANSIT',
              min_temperature = @minTemperature,
              max_temperature = @maxTemperature,
              delivery_mode = 0,
              profile_id = @profileId,
              early_warning_minutes = @warning,
              max_door_open_seconds = @doorLimit,
              start_time = SYSDATETIMEOFFSET(),
              end_time = NULL
          WHERE trip_id = @tripId
        `);
    } else {
      // Tạo mới chuyến hàng (INSERT)
      await request()
        .input("tripId", sql.VarChar(30), cleanTripId)
        .input("vehicleId", sql.Int, vehicleId)
        .input("minTemperature", sql.Float, min)
        .input("maxTemperature", sql.Float, max)
        .input("profileId", sql.VarChar(50), profileId)
        .input("warning", sql.Int, profile.early_warning_minutes)
        .input("doorLimit", sql.Int, profile.max_door_open_seconds)
        .query(`
          INSERT INTO trips (
            trip_id,
            vehicle_id,
            profile_id,
            min_temperature,
            max_temperature,
            early_warning_minutes,
            max_door_open_seconds,
            trip_state,
            delivery_mode,
            start_time,
            end_time
          ) VALUES (
            @tripId,
            @vehicleId,
            @profileId,
            @minTemperature,
            @maxTemperature,
            @warning,
            @doorLimit,
            'IN_TRANSIT',
            0,
            SYSDATETIMEOFFSET(),
            NULL
          )
        `);
    }

    // Gán lô hàng
    await request()
      .input("tripId", sql.VarChar(30), cleanTripId)
      .query("DELETE FROM trip_lots WHERE trip_id = @tripId");
    await request()
      .input("tripId", sql.VarChar(30), cleanTripId)
      .input("lotId", sql.VarChar(50), lotId)
      .query("INSERT INTO trip_lots (trip_id, lot_id) VALUES (@tripId, @lotId)");

    await transaction.commit();

    res.json({
      ok: true,
      tripId: cleanTripId,
      lotId,
      profileId,
      tripState: "IN_TRANSIT",
      Tmin: min,
      Tmax: max,
      deliveryMode: false,
      commandId: ack.commandId,
      acknowledged: true,
      isNewTrip: !tripExists,
      message: `ESP32 đã xác nhận và bắt đầu chuyến ${cleanTripId}.`,
    });
  } catch (error) {
    if (transaction) { try { await transaction.rollback(); } catch {} }
    res.status(error.statusCode || (ack ? 503 : 400)).json({
      message: ack
        ? "ESP32 đã áp dụng cấu hình nhưng không lưu được database. Hãy kiểm tra Backend trước khi gửi lệnh khác."
        : error.message || "Không bắt đầu được chuyến",
    });
  }
});

/* ── Kịch bản Demo Một Nút Bấm (ESP32 → MQTT → Backend → Dashboard) ── */
router.post("/demo-scenario", async (req, res) => {
  const {
    deviceId = "ESP32-01",
    scenario = "NETWORK_OUTAGE",
    durationSeconds = 16,
  } = req.body || {};

  if (typeof deviceId !== "string" || !/^[A-Za-z0-9_-]{1,50}$/.test(deviceId)) {
    return res.status(400).json({ message: "Mã thiết bị không hợp lệ" });
  }

  if (!isMqttConnected()) {
    return res.status(503).json({
      message: "MQTT broker chưa kết nối. Hãy khởi động Mosquitto trước (port 1883) để gửi lệnh tới ESP32.",
    });
  }

  const duration = Math.min(120, Math.max(5, Number(durationSeconds) || 16));

  try {
    let command;
    if (scenario === "NETWORK_OUTAGE") {
      command = {
        action: "SIMULATE_OUTAGE",
        durationSeconds: duration,
      };
    } else if (scenario === "RECONNECT_NOW") {
      command = {
        action: "RECONNECT_NOW",
      };
    } else {
      return res.status(400).json({ message: `Kịch bản '${scenario}' không được hỗ trợ.` });
    }

    const ack = await publishCommand(deviceId, command);

    // Bổ trợ Serial Wokwi (nếu đang chạy Wokwi với cổng RFC2217 port 4000)
    if (scenario === "NETWORK_OUTAGE") {
      void sendSerialToWokwi("WIFI_OFF");
      setTimeout(() => void sendSerialToWokwi("WIFI_ON"), duration * 1000);
    } else if (scenario === "RECONNECT_NOW") {
      void sendSerialToWokwi("WIFI_ON");
    }

    res.json({
      ok: true,
      acknowledged: true,
      commandId: ack.commandId,
      scenario,
      durationSeconds: duration,
      message: `ESP32 (${deviceId}) đã xác nhận ACK và bắt đầu kịch bản ${scenario} (${duration}s).`,
    });
  } catch (error) {
    res.status(error.statusCode || 503).json({
      message: error.message || "Không thể gửi lệnh kịch bản tới ESP32 qua MQTT.",
    });
  }
});

/* ── Kết thúc chuyến hàng & Chốt sổ báo cáo ── */
router.post("/end-trip", async (req, res) => {
  const { deviceId = "ESP32-01", tripId = "TRIP001" } = req.body || {};

  try {
    const pool = await poolPromise;
    await pool.request()
      .input("tripId", sql.VarChar(30), tripId)
      .query(`
        UPDATE trips
        SET trip_state = 'COMPLETED',
            end_time = SYSDATETIMEOFFSET(),
            delivery_mode = 0
        WHERE trip_id = @tripId
      `);

    if (isMqttConnected()) {
      try {
        await publishCommand(deviceId, {
          tripId,
          tripState: "COMPLETED",
          deliveryMode: false,
        });
      } catch (mqttErr) {
        console.warn("ESP32 MQTT notification on trip complete:", mqttErr.message);
      }
    }

    res.json({
      ok: true,
      tripId,
      tripState: "COMPLETED",
      endTime: new Date().toISOString(),
      message: `Chuyến hàng ${tripId} đã được kết thúc thành công. Báo cáo cuối chuyến đã sẵn sàng.`,
    });
  } catch (err) {
    res.status(500).json({ message: err.message || "Không thể kết thúc chuyến hàng." });
  }
});

module.exports = router;
