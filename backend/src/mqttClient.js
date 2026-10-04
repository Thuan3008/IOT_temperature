const mqtt = require("mqtt");
const sql = require("mssql");

const poolPromise = require("./db");
const { evaluateTemperatureAlerts } = require("./services/temperatureAlertService");
const { notifyTelegramAlerts } = require("./telegramNotifier");
const { recordTelemetrySeen, recordDeviceStatus } = require("./timeoutMonitor");

const TOPIC =
  "coldchain/v1/devices/+/telemetry";
const STATUS_TOPIC = "coldchain/v1/devices/+/status";
const ALERT_TOPIC = "coldchain/v1/devices/+/alert";
let activeClient = null;

async function saveDeviceAlert(data, topic) {
  const match = /^coldchain\/v1\/devices\/([A-Za-z0-9_-]+)\/alert$/.exec(topic);
  if (!match || data.deviceId !== match[1] || typeof data.tripId !== "string" ||
      !["DOOR_BREACH", "DOOR_OPEN_TOO_LONG"].includes(data.type) || typeof data.active !== "boolean") {
    throw new Error("Invalid device alert payload");
  }
  if (!data.active) return; // Firmware emits a second event when the condition clears.

  const pool = await poolPromise;
  const context = await pool.request()
    .input("deviceId", sql.VarChar(50), data.deviceId)
    .input("tripId", sql.VarChar(30), data.tripId)
    .query(`SELECT TOP 1 p.door_status, p.latitude, p.longitude
      FROM devices d INNER JOIN trips t ON t.vehicle_id = d.vehicle_id
      LEFT JOIN telemetry_packets p ON p.device_id = d.device_id AND p.trip_id = t.trip_id
      WHERE d.device_id = @deviceId AND t.trip_id = @tripId
      ORDER BY p.packet_id DESC`);
  if (!context.recordset.length) throw new Error("Alert device is not assigned to trip");

  const message = data.type === "DOOR_BREACH"
    ? "Cửa mở trái phép khi xe đang vận chuyển"
    : "Cửa mở quá thời gian cho phép";
  await pool.request()
    .input("tripId", sql.VarChar(30), data.tripId)
    .input("deviceId", sql.VarChar(50), data.deviceId)
    .input("alertType", sql.VarChar(50), data.type)
    .input("message", sql.NVarChar(500), message)
    .query(`INSERT INTO alerts (trip_id, device_id, alert_type, message)
      VALUES (@tripId, @deviceId, @alertType, @message)`);

  const lastPacket = context.recordset[0];
  console.warn(`${data.type}: ${message}`);
  await notifyTelegramAlerts({
    deviceId: data.deviceId, tripId: data.tripId,
    door: "OPEN", latitude: lastPacket.latitude, longitude: lastPacket.longitude,
    timestamp: new Date().toISOString()
  }, [{ type: data.type, sensorId: null, temperature: null, threshold: null, message }]);
}

function validateTelemetry(data, topic) {
  if (
    !data ||
    data.type !== "TELEMETRY" ||
    typeof data.deviceId !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(data.deviceId) ||
    typeof data.tripId !== "string" ||
    !Array.isArray(data.sensors) ||
    data.sensors.length !== 5 ||
    !Number.isFinite(Date.parse(data.timestamp)) ||
    typeof data.isBuffered !== "boolean" ||
    !["OPEN", "CLOSED"].includes(data.door)
  ) {
    throw new Error("Invalid telemetry payload");
  }

  if (
    data.messageId !== undefined &&
    (typeof data.messageId !== "string" ||
      !/^[A-Za-z0-9._:-]{1,100}$/.test(data.messageId))
  ) {
    throw new Error("Invalid messageId");
  }

  if (
    topic !==
    `coldchain/v1/devices/${data.deviceId}/telemetry`
  ) {
    throw new Error("Device ID does not match topic");
  }

  for (const coordinate of ["latitude", "longitude"]) {
    if (
      data[coordinate] !== null &&
      (
        typeof data[coordinate] !== "number" ||
        !Number.isFinite(data[coordinate])
      )
    ) {
      throw new Error(`Invalid ${coordinate}`);
    }
  }

  if (
    (data.latitude !== null &&
      Math.abs(data.latitude) > 90) ||
    (data.longitude !== null &&
      Math.abs(data.longitude) > 180)
  ) {
    throw new Error("Invalid GPS coordinates");
  }

  const ids = new Set();

  for (const sensor of data.sensors) {
    if (
      typeof sensor.sensorId !== "string" ||
      !/^S[1-5]$/.test(sensor.sensorId) ||
      ids.has(sensor.sensorId) ||
      !["ONLINE", "OFFLINE", "FAULT"].includes(
        sensor.status
      ) ||
      (
        sensor.temperature !== null &&
        (
          typeof sensor.temperature !== "number" ||
          !Number.isFinite(sensor.temperature)
        )
      ) ||
      (
        sensor.humidity !== null &&
        (
          typeof sensor.humidity !== "number" ||
          !Number.isFinite(sensor.humidity) ||
          sensor.humidity < 0 ||
          sensor.humidity > 100
        )
      )
    ) {
      throw new Error("Invalid sensor data");
    }

    ids.add(sensor.sensorId);
  }
}

async function saveTelemetry(data, topic) {
  validateTelemetry(data, topic);

  const pool = await poolPromise;

  const transaction = new sql.Transaction(pool);

  await transaction.begin();

  try {
    if (data.messageId) {
      const existing = await new sql.Request(transaction)
        .input("deviceId", sql.VarChar(50), data.deviceId)
        .input("messageId", sql.NVarChar(100), data.messageId)
        .query(`
          SELECT TOP 1 packet_id
          FROM telemetry_packets
          WHERE device_id = @deviceId AND message_id = @messageId
        `);
      if (existing.recordset.length) {
        await transaction.rollback();
        console.log(`Duplicate telemetry ignored: ${data.deviceId}/${data.messageId}`);
        return { duplicate: true, packetId: existing.recordset[0].packet_id };
      }
    } else {
      console.warn(`Telemetry from ${data.deviceId} has no messageId; duplicate detection unavailable`);
    }

    const sensorIds = data.sensors.map((sensor) => sensor.sensorId);
    const relationResult = await new sql.Request(transaction)
      .input("deviceId", sql.VarChar(50), data.deviceId)
      .input("tripId", sql.VarChar(30), data.tripId)
      .query(`
        SELECT d.device_id
        FROM devices d
        INNER JOIN trips t ON t.vehicle_id = d.vehicle_id
        WHERE d.device_id = @deviceId AND t.trip_id = @tripId
      `);
    if (relationResult.recordset.length !== 1) {
      throw new Error("Device is not assigned to this trip");
    }

    const tripResult = await new sql.Request(transaction)
      .input("tripId", sql.VarChar(30), data.tripId)
      .query(`
        SELECT min_temperature, max_temperature, early_warning_minutes
        FROM trips
        WHERE trip_id = @tripId
      `);
    const trip = tripResult.recordset[0];

    const sensorRequest = new sql.Request(transaction)
      .input("deviceId", sql.VarChar(50), data.deviceId);
    sensorIds.forEach((sensorId, index) => sensorRequest.input(`sensor${index}`, sql.VarChar(20), sensorId));
    const placeholders = sensorIds.map((_, index) => `@sensor${index}`).join(",");
    const sensorResult = await sensorRequest.query(`
      SELECT sensor_id FROM sensors
      WHERE device_id = @deviceId AND sensor_id IN (${placeholders})
    `);
    if (sensorResult.recordset.length !== data.sensors.length) {
      throw new Error("Telemetry contains an unknown sensor");
    }

    const historyBySensor = {};
    for (const sensor of data.sensors) {
      const history = await new sql.Request(transaction)
        .input("deviceId", sql.VarChar(50), data.deviceId)
        .input("tripId", sql.VarChar(30), data.tripId)
        .input("sensorId", sql.VarChar(20), sensor.sensorId)
        .input("measuredAt", sql.DateTimeOffset, new Date(data.timestamp))
        .query(`
          SELECT TOP 5 r.temperature, p.measured_at
          FROM sensor_readings r
          INNER JOIN telemetry_packets p ON p.packet_id = r.packet_id
          WHERE r.device_id = @deviceId AND p.trip_id = @tripId
            AND r.sensor_id = @sensorId AND r.temperature IS NOT NULL
            AND r.sensor_status = 'ONLINE' AND p.measured_at < @measuredAt
          ORDER BY p.measured_at DESC
        `);
      historyBySensor[sensor.sensorId] = history.recordset.map((row) => ({
        temperature: row.temperature,
        time: new Date(row.measured_at).getTime()
      }));
    }

    // Luu thong tin chung cua ban tin
    const packetResult = await new sql.Request(transaction)
      .input("deviceId", sql.VarChar(50), data.deviceId)
      .input("tripId", sql.VarChar(30), data.tripId)
      .input("messageId", sql.NVarChar(100), data.messageId || null)
      .input("door", sql.VarChar(10), data.door)
      .input("latitude", sql.Float, data.latitude)
      .input("longitude", sql.Float, data.longitude)
      .input(
        "timestamp",
        sql.DateTimeOffset,
        new Date(data.timestamp)
      )
      .input("isBuffered", sql.Bit, data.isBuffered)
      .query(`
        INSERT INTO telemetry_packets (
          device_id,
          trip_id,
          message_id,
          door_status,
          latitude,
          longitude,
          measured_at,
          is_buffered,
          message_type
        )
        OUTPUT INSERTED.packet_id
        VALUES (
          @deviceId,
          @tripId,
          @messageId,
          @door,
          @latitude,
          @longitude,
          @timestamp,
          @isBuffered,
          'TELEMETRY'
        )
      `);

    const packetId =
      packetResult.recordset[0].packet_id;

    // Luu tung cam bien
    for (const sensor of data.sensors) {
      await new sql.Request(transaction)
        .input("packetId", sql.BigInt, packetId)
        .input("deviceId", sql.VarChar(50), data.deviceId)
        .input("sensorId", sql.VarChar(20), sensor.sensorId)
        .input("temperature", sql.Float, sensor.temperature)
        .input("humidity", sql.Float, sensor.humidity)
        .input("status", sql.VarChar(20), sensor.status)
        .query(`
          INSERT INTO sensor_readings (
            packet_id,
            device_id,
            sensor_id,
            temperature,
            humidity,
            sensor_status
          )
          VALUES (
            @packetId,
            @deviceId,
            @sensorId,
            @temperature,
            @humidity,
            @status
          )
        `);
    }

    const alerts = evaluateTemperatureAlerts({
      sensors: data.sensors,
      minTemperature: trip.min_temperature,
      maxTemperature: trip.max_temperature,
      earlyWarningMinutes: trip.early_warning_minutes,
      historyBySensor,
      measuredAt: data.timestamp
    });
    for (const alert of alerts) {
      await new sql.Request(transaction)
        .input("tripId", sql.VarChar(30), data.tripId)
        .input("deviceId", sql.VarChar(50), data.deviceId)
        .input("sensorId", sql.VarChar(20), alert.sensorId)
        .input("packetId", sql.BigInt, packetId)
        .input("alertType", sql.VarChar(50), alert.type)
        .input("temperature", sql.Float, alert.temperature)
        .input("threshold", sql.Float, alert.threshold)
        .input("message", sql.NVarChar(500), alert.message)
        .query(`
          INSERT INTO alerts (trip_id, device_id, sensor_id, packet_id, alert_type, temperature, threshold_value, message)
          VALUES (@tripId, @deviceId, @sensorId, @packetId, @alertType, @temperature, @threshold, @message)
        `);
    }

    await transaction.commit();

    console.log(
      `Saved packet ${packetId}: ${data.sensors.length} sensors, ${alerts.length} alerts`
    );

    // Gửi sau khi transaction đã commit để Telegram không báo một bản ghi chưa lưu.
    void notifyTelegramAlerts(data, alerts);
    await recordTelemetrySeen(data);

  } catch (error) {
    try { await transaction.rollback(); } catch { /* transaction may already be rolled back by SQL Server */ }
    const errorNumber = error.number || error.originalError?.info?.number;
    const errorText = `${error.message || ""} ${error.originalError?.info?.message || ""}`;
    if ([2601, 2627].includes(errorNumber) && errorText.includes("UX_telemetry_device_message_id")) {
      console.log(`Duplicate telemetry ignored: ${data.deviceId}/${data.messageId}`);
      return { duplicate: true };
    }
    throw error;
  }
}

function startMqtt() {
  const client = mqtt.connect(
    process.env.MQTT_HOST,
    {
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
      reconnectPeriod: 3000
    }
  );
  activeClient = client;

  client.on("connect", () => {
    console.log("MQTT connected!");

    client.subscribe([TOPIC, STATUS_TOPIC, ALERT_TOPIC], (error) => {
      if (error) {
        console.error("Subscribe failed:", error.message);
      } else {
        console.log("Subscribed:", TOPIC, STATUS_TOPIC, ALERT_TOPIC);
      }
    });
  });

  // Keep telemetry ordered. Process each device/alert type independently, so
  // one slow category does not block other alerts or MQTT status updates.
  let telemetryQueue = Promise.resolve();
  let statusQueue = Promise.resolve();
  const alertQueues = new Map();

  client.on("message", (topic, message) => {
    let data;
    try { data = JSON.parse(message.toString("utf8")); }
    catch { console.error("MQTT message processing failed: Payload is not valid JSON"); return; }

    const handleMessage = async () => {
      if (topic.endsWith("/status")) {
        const match = /^coldchain\/v1\/devices\/([A-Za-z0-9_-]+)\/status$/.exec(topic);
        if (!match || data.deviceId !== match[1] || !["ONLINE", "OFFLINE"].includes(data.status)) {
          throw new Error("Invalid device status payload");
        }
        await recordDeviceStatus(data.deviceId, data.status);
        return;
      }

      if (topic.endsWith("/alert")) {
        await saveDeviceAlert(data, topic);
        return;
      }

      console.log(`Received telemetry from ${data.deviceId || "unknown"}`);

      await saveTelemetry(data, topic);
    };
    const logError = (error) => console.error("MQTT message processing failed:", error.message);
    if (topic.endsWith("/alert")) {
      const key = `${topic}:${data.type || "UNKNOWN"}`;
      const previous = alertQueues.get(key) || Promise.resolve();
      const pending = previous.then(handleMessage).catch(logError);
      alertQueues.set(key, pending);
      void pending.then(() => {
        if (alertQueues.get(key) === pending) alertQueues.delete(key);
      });
    } else if (topic.endsWith("/status")) {
      statusQueue = statusQueue.then(handleMessage).catch(logError);
    } else {
      telemetryQueue = telemetryQueue.then(handleMessage).catch(logError);
    }
  });

  client.on("error", (error) => {
    console.error("MQTT error:", error.message);
  });
}

function publishCommand(deviceId, command) {
  if (!/^[A-Za-z0-9_-]+$/.test(deviceId)) {
    return Promise.reject(new Error("Invalid device ID"));
  }
  if (!activeClient || !activeClient.connected) {
    return Promise.reject(new Error("MQTT is not connected"));
  }

  const topic = `coldchain/v1/devices/${deviceId}/command`;
  return new Promise((resolve, reject) => {
    activeClient.publish(topic, JSON.stringify(command), { qos: 0 }, (error) => {
      if (error) return reject(error);
      resolve({ topic, command });
    });
  });
}

module.exports = startMqtt;
module.exports.publishCommand = publishCommand;
module.exports.isMqttConnected = () => Boolean(activeClient?.connected);
