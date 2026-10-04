const sql = require("mssql");
const poolPromise = require("../db");

async function listTelemetry(tripId) {
  const pool = await poolPromise;
  const request = pool.request();
  let query = `SELECT TOP 1000 p.packet_id, p.device_id, p.trip_id, p.message_id, p.door_status,
    p.latitude, p.longitude, p.measured_at, p.received_at, p.is_buffered,
    p.message_type, r.reading_id, r.sensor_id, r.temperature, r.humidity, r.sensor_status
    FROM telemetry_packets p INNER JOIN sensor_readings r ON r.packet_id = p.packet_id`;
  if (tripId) { request.input("tripId", sql.VarChar(30), tripId); query += " WHERE p.trip_id = @tripId"; }
  query += " ORDER BY p.measured_at DESC, r.sensor_id ASC";
  return (await request.query(query)).recordset;
}

async function listSensors() {
  const pool = await poolPromise;
  return (await pool.request().query("SELECT device_id, sensor_id, zone_name, sensor_type, status, last_seen FROM sensors ORDER BY device_id, sensor_id")).recordset;
}

async function listDevices() {
  const pool = await poolPromise;
  return (await pool.request().query("SELECT device_id, status, last_seen FROM devices ORDER BY device_id")).recordset;
}

async function getTrip(tripId) {
  const pool = await poolPromise;
  const request = pool.request().input("tripId", sql.VarChar(30), tripId);
  const result = await request.query(`
    SELECT t.trip_id, t.trip_state, t.delivery_mode, t.min_temperature,
      t.max_temperature, t.early_warning_minutes, t.max_door_open_seconds,
      t.profile_id, d.device_id, v.license_plate AS vehicle_plate
    FROM trips t
    LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
    LEFT JOIN devices d ON d.vehicle_id = t.vehicle_id
    WHERE t.trip_id = @tripId
  `);
  return result.recordset[0] || null;
}

async function listAlerts(tripId, status = "OPEN") {
  const pool = await poolPromise;
  const request = pool.request();
  let query = `SELECT TOP 500 alert_id, trip_id, device_id, sensor_id, packet_id,
      alert_type, temperature, threshold_value, message, created_at, last_seen_at,
      occurrence_count, status, resolved_at, recovered_at
    FROM alerts`;
  const filters = [];
  if (tripId) {
    request.input("tripId", sql.VarChar(30), tripId);
    filters.push("trip_id = @tripId");
  }
  if (status !== "ALL") {
    request.input("status", sql.VarChar(20), status);
    filters.push("status = @status");
  }
  if (filters.length) query += ` WHERE ${filters.join(" AND ")}`;
  query += " ORDER BY CASE WHEN status = 'OPEN' THEN last_seen_at ELSE COALESCE(recovered_at, resolved_at, created_at) END DESC, alert_id DESC";
  return (await request.query(query)).recordset;
}

async function resolveAlert(alertId) {
  const pool = await poolPromise;
  const result = await pool.request()
    .input("alertId", sql.BigInt, alertId)
    .query(`UPDATE alerts SET status = 'RESOLVED', resolved_at = SYSDATETIMEOFFSET()
      OUTPUT INSERTED.alert_id, INSERTED.status, INSERTED.resolved_at, INSERTED.recovered_at
      WHERE alert_id = @alertId AND status = 'OPEN'`);
  if (result.recordset[0]) return result.recordset[0];
  const existing = await pool.request().input("alertId", sql.BigInt, alertId)
    .query("SELECT alert_id, status, resolved_at, recovered_at FROM alerts WHERE alert_id = @alertId");
  return existing.recordset[0] || null;
}

module.exports = { listTelemetry, listSensors, listDevices, getTrip, listAlerts, resolveAlert };
