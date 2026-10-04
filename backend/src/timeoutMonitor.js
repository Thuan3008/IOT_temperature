const sql = require("mssql");

const poolPromise = require("./db");
const { notifyTelegramAlerts } = require("./telegramNotifier");

const SENSOR_TIMEOUT_MS = Number(process.env.SENSOR_TIMEOUT_SECONDS || 30) * 1000;
const DEVICE_TIMEOUT_MS = Number(process.env.DEVICE_TIMEOUT_SECONDS || 30) * 1000;
const SCAN_INTERVAL_MS = Number(process.env.OFFLINE_SCAN_INTERVAL_SECONDS || 15) * 1000;

const lastSeenDevices = new Map();
const lastSeenSensors = new Map();
const offlineDevices = new Set();
const offlineSensors = new Set();
let scanRunning = false;

async function recordTelemetrySeen(data) {
  const now = Date.now();
  lastSeenDevices.set(data.deviceId, { at: now, tripId: data.tripId });
  offlineDevices.delete(data.deviceId);
  const updates = [markDeviceOnline(data.deviceId).catch((error) => {
    console.error(`Cannot update device last_seen: ${error.message}`);
  })];

  for (const sensor of data.sensors) {
    const key = `${data.deviceId}:${sensor.sensorId}`;
    const hasValidReading = sensor.status === "ONLINE" && Number.isFinite(sensor.temperature);
    if (hasValidReading) {
      lastSeenSensors.set(key, { at: now, tripId: data.tripId });
      offlineSensors.delete(key);
    } else if (!lastSeenSensors.has(key)) {
      // Cảm biến chưa từng ONLINE vẫn cần mốc bắt đầu để phát hiện 7B.
      lastSeenSensors.set(key, { at: now, tripId: data.tripId });
    }
    // Khi đã timeout, gói FAULT tiếp theo không được ghi đè OFFLINE.
    const status = !hasValidReading && offlineSensors.has(key) ? "OFFLINE"
      : hasValidReading ? "ONLINE" : "FAULT";
    updates.push(markSensorStatus(data.deviceId, sensor.sensorId, status, hasValidReading).catch((error) => {
      console.error(`Cannot update sensor last_seen: ${error.message}`);
    }));
  }
  await Promise.all(updates);
}

async function markDeviceOnline(deviceId) {
  const pool = await poolPromise;
  await pool.request()
    .input("deviceId", sql.VarChar(50), deviceId)
    .query("UPDATE devices SET status = 'ONLINE', last_seen = SYSDATETIMEOFFSET() WHERE device_id = @deviceId");
}

async function markSensorStatus(deviceId, sensorId, status, updateLastSeen) {
  const pool = await poolPromise;
  await pool.request()
    .input("deviceId", sql.VarChar(50), deviceId)
    .input("sensorId", sql.VarChar(20), sensorId)
    .input("status", sql.VarChar(20), status)
    .input("updateLastSeen", sql.Bit, updateLastSeen)
    .query("UPDATE sensors SET status = @status, last_seen = CASE WHEN @updateLastSeen = 1 THEN SYSDATETIMEOFFSET() ELSE last_seen END WHERE device_id = @deviceId AND sensor_id = @sensorId");
}

async function findDeviceContext(deviceId) {
  const pool = await poolPromise;
  const result = await pool.request()
    .input("deviceId", sql.VarChar(50), deviceId)
    .query(`SELECT TOP 1 d.status, t.trip_id
      FROM devices d
      LEFT JOIN trips t ON t.vehicle_id = d.vehicle_id
        AND t.trip_state IN ('IN_TRANSIT', 'ARMED')
      WHERE d.device_id = @deviceId
      ORDER BY CASE WHEN t.trip_state = 'IN_TRANSIT' THEN 0 ELSE 1 END, t.start_time DESC`);
  return result.recordset[0] || null;
}

// Nhận ONLINE/OFFLINE từ topic status, bao gồm LWT retained của broker.
async function recordDeviceStatus(deviceId, status) {
  if (status === "ONLINE") {
    const context = await findDeviceContext(deviceId);
    if (!context) return;
    const now = Date.now();
    lastSeenDevices.set(deviceId, { at: now, tripId: context.trip_id });
    offlineDevices.delete(deviceId);
    for (const [key, state] of lastSeenSensors) {
      if (key.startsWith(`${deviceId}:`)) {
        lastSeenSensors.set(key, { at: now, tripId: state.tripId || context.trip_id });
        offlineSensors.delete(key);
      }
    }
    await markDeviceOnline(deviceId);
    console.log(`Device ${deviceId} ONLINE (MQTT status)`);
    return;
  }
  if (status !== "OFFLINE") return;
  const context = await findDeviceContext(deviceId);
  if (!context) return;
  const previous = lastSeenDevices.get(deviceId);
  const state = { at: previous?.at || Date.now(), tripId: previous?.tripId || context.trip_id };
  await markDeviceOffline(deviceId, state, "MQTT Last Will / status OFFLINE",
    context.status === "ONLINE" || Boolean(previous && !offlineDevices.has(deviceId)));
}

async function createTimeoutAlert({ deviceId, sensorId, tripId, type, message }) {
  const pool = await poolPromise;
  await pool.request()
    .input("tripId", sql.VarChar(30), tripId)
    .input("deviceId", sql.VarChar(50), deviceId)
    .input("sensorId", sql.VarChar(20), sensorId || null)
    .input("alertType", sql.VarChar(50), type)
    .input("message", sql.NVarChar(500), message)
    .query(`
      INSERT INTO alerts (trip_id, device_id, sensor_id, packet_id, alert_type, temperature, threshold_value, message)
      VALUES (@tripId, @deviceId, @sensorId, NULL, @alertType, NULL, NULL, @message)
    `);
}

async function markDeviceOffline(deviceId, state, reason, wasOnline = true) {
  if (offlineDevices.has(deviceId)) return;
  offlineDevices.add(deviceId);
  try {
    const message = `Thiết bị ${deviceId} mất kết nối: ${reason}`;
    const pool = await poolPromise;
    await pool.request().input("deviceId", sql.VarChar(50), deviceId)
      .query("UPDATE devices SET status = 'OFFLINE' WHERE device_id = @deviceId");
    await pool.request().input("deviceId", sql.VarChar(50), deviceId)
      .query("UPDATE sensors SET status = 'OFFLINE' WHERE device_id = @deviceId");
    for (const key of lastSeenSensors.keys()) {
      if (key.startsWith(`${deviceId}:`)) offlineSensors.add(key);
    }
    // Retained LWT có thể được phát lại khi backend restart; không tạo alert trùng.
    if (wasOnline && state.tripId) {
      await createTimeoutAlert({ deviceId, tripId: state.tripId, type: "DEVICE_OFFLINE", message });
      void notifyTelegramAlerts(
        { deviceId, tripId: state.tripId, door: "UNKNOWN", latitude: null, longitude: null, timestamp: new Date().toISOString() },
        [{ type: "DEVICE_OFFLINE", sensorId: null, temperature: null, threshold: null, message }]
      );
      console.warn(`DEVICE_OFFLINE: ${message}`);
    }
  } catch (error) {
    offlineDevices.delete(deviceId);
    throw error;
  }
}

async function handleSensorTimeout(deviceId, sensorId, state, ageSeconds) {
  const key = `${deviceId}:${sensorId}`;
  if (offlineSensors.has(key) || offlineDevices.has(deviceId)) return;
  offlineSensors.add(key);
  try {
    const message = `Cảm biến ${sensorId} của ${deviceId} không cập nhật trong ${ageSeconds} giây`;
    await markSensorStatus(deviceId, sensorId, "OFFLINE", false);
    if (state.tripId) {
      await createTimeoutAlert({ deviceId, sensorId, tripId: state.tripId, type: "SENSOR_OFFLINE", message });
      void notifyTelegramAlerts(
        { deviceId, tripId: state.tripId, door: "UNKNOWN", latitude: null, longitude: null, timestamp: new Date().toISOString() },
        [{ type: "SENSOR_OFFLINE", sensorId, temperature: null, threshold: null, message }]
      );
    }
    console.warn(`SENSOR_OFFLINE: ${message}`);
  } catch (error) {
    offlineSensors.delete(key);
    throw error;
  }
}

async function scanTimeouts() {
  if (scanRunning) return;
  scanRunning = true;
  try {
    const now = Date.now();
    for (const [deviceId, state] of lastSeenDevices) {
      const ageMs = now - state.at;
      if (ageMs > DEVICE_TIMEOUT_MS) {
        await markDeviceOffline(deviceId, state, `không nhận telemetry ${Math.floor(ageMs / 1000)} giây`);
      }
    }
    for (const [key, state] of lastSeenSensors) {
      const ageMs = now - state.at;
      if (ageMs > SENSOR_TIMEOUT_MS) {
        const separator = key.indexOf(":");
        await handleSensorTimeout(key.slice(0, separator), key.slice(separator + 1), state, Math.floor(ageMs / 1000));
      }
    }
  } catch (error) {
    console.error(`Timeout scan failed: ${error.message}`);
  } finally {
    scanRunning = false;
  }
}

function startTimeoutMonitor() {
  console.log(`Timeout monitor started: scan=${SCAN_INTERVAL_MS / 1000}s, device=${DEVICE_TIMEOUT_MS / 1000}s, sensor=${SENSOR_TIMEOUT_MS / 1000}s`);
  return setInterval(() => { void scanTimeouts(); }, SCAN_INTERVAL_MS);
}

module.exports = { recordTelemetrySeen, recordDeviceStatus, startTimeoutMonitor, scanTimeouts };
