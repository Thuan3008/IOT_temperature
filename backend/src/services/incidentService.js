const sql = require("mssql");
const poolPromise = require("../db");

// One row represents one continuous incident. Manual acknowledgement changes
// status, but the row remains active until recovery sets recovered_at.
async function openIncident({ tripId, deviceId, sensorId = null, type, message, temperature = null, threshold = null }) {
  const pool = await poolPromise;
  const result = await pool.request()
    .input("tripId", sql.VarChar(30), tripId)
    .input("deviceId", sql.VarChar(50), deviceId)
    .input("sensorId", sql.VarChar(20), sensorId)
    .input("type", sql.VarChar(50), type)
    .input("message", sql.NVarChar(500), message)
    .input("temperature", sql.Float, temperature)
    .input("threshold", sql.Float, threshold)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      DECLARE @alertId BIGINT;
      DECLARE @created BIT = 0;
      SELECT @alertId = alert_id FROM alerts WITH (UPDLOCK, HOLDLOCK)
      WHERE trip_id = @tripId AND device_id = @deviceId AND alert_type = @type
        AND (sensor_id = @sensorId OR (sensor_id IS NULL AND @sensorId IS NULL))
        AND recovered_at IS NULL;
      IF @alertId IS NULL
      BEGIN
        INSERT INTO alerts (trip_id, device_id, sensor_id, alert_type, message, temperature, threshold_value)
        VALUES (@tripId, @deviceId, @sensorId, @type, @message, @temperature, @threshold);
        SET @alertId = SCOPE_IDENTITY();
        SET @created = 1;
      END
      ELSE
        UPDATE alerts SET last_seen_at = SYSDATETIMEOFFSET(), occurrence_count = occurrence_count + 1,
          message = @message, temperature = @temperature, threshold_value = @threshold
        WHERE alert_id = @alertId;
      COMMIT TRANSACTION;
      SELECT @alertId AS alert_id, @created AS created;
    `);
  return result.recordset[0];
}

async function recoverIncident({ deviceId, sensorId = null, tripId = null, type }) {
  const pool = await poolPromise;
  const result = await pool.request()
    .input("deviceId", sql.VarChar(50), deviceId)
    .input("sensorId", sql.VarChar(20), sensorId)
    .input("tripId", sql.VarChar(30), tripId)
    .input("type", sql.VarChar(50), type)
    .query(`UPDATE alerts SET recovered_at = SYSDATETIMEOFFSET(), status = 'RESOLVED',
        resolved_at = COALESCE(resolved_at, SYSDATETIMEOFFSET())
      WHERE device_id = @deviceId AND alert_type = @type AND recovered_at IS NULL
        AND (sensor_id = @sensorId OR (sensor_id IS NULL AND @sensorId IS NULL))
        AND (@tripId IS NULL OR trip_id = @tripId)`);
  return result.rowsAffected[0] || 0;
}

module.exports = { openIncident, recoverIncident };
