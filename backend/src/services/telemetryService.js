const sql = require("mssql");
const poolPromise = require("../db");

async function listTelemetry(tripId) {
  const pool = await poolPromise;
  const request = pool.request();
  let query = `SELECT TOP 1000 p.packet_id, p.device_id, p.trip_id, p.door_status,
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

module.exports = { listTelemetry, listSensors };
