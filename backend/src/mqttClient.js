const mqtt = require("mqtt");
const sql = require("mssql");
const { randomUUID } = require("crypto");

const poolPromise = require("./db");
const { evaluateTemperatureAlerts } = require("./services/temperatureAlertService");
const { notifyTelegramAlerts } = require("./telegramNotifier");
const { noteTelemetryArrival, recordTelemetrySeen, recordDeviceStatus } = require("./timeoutMonitor");
const { publishLiveTelemetry } = require("./liveTelemetry");
const { openIncident, recoverIncident } = require("./services/incidentService");

const TOPIC =
  "coldchain/v1/devices/+/telemetry";
const STATUS_TOPIC = "coldchain/v1/devices/+/status";
const ALERT_TOPIC = "coldchain/v1/devices/+/alert";
const ACK_TOPIC = "coldchain/v1/devices/+/ack";
const COMMAND_ACK_TIMEOUT_MS = 25000;
let activeClient = null;
let ackSubscriptionReady = false;
const pendingCommands = new Map();

function commandError(message, statusCode = 503) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function settleCommand(commandId, error, ack) {
  const pending = pendingCommands.get(commandId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingCommands.delete(commandId);
  if (error) pending.reject(error);
  else pending.resolve(ack);
}

function handleCommandAck(data, topic) {
  const match = /^coldchain\/v1\/devices\/([A-Za-z0-9_-]+)\/ack$/.exec(topic);
  if (!match || !data || typeof data !== "object" || data.type !== "COMMAND_ACK" || typeof data.commandId !== "string") return;
  const pending = pendingCommands.get(data.commandId);
  if (!pending || pending.deviceId !== match[1] || data.deviceId !== match[1]) return;
  if (data.status === "REJECTED") {
    console.warn(`Command ACK REJECTED: ${pending.deviceId}/${data.commandId}: ${String(data.reason || "unknown")}`);
    settleCommand(data.commandId, commandError(`ESP32 từ chối lệnh: ${String(data.reason || "cấu hình không hợp lệ")}`, 409));
    return;
  }
  if (data.status !== "APPLIED" || !data.applied || typeof data.applied !== "object") return;
  const matches = Object.entries(pending.command).every(([key, value]) => {
    if (key === "commandId") return true;
    const actual = data.applied[key];
    return typeof value === "number"
      ? typeof actual === "number" && Math.abs(actual - value) < 0.001
      : actual === value;
  });
  if (!matches) {
    settleCommand(data.commandId, commandError("ACK từ ESP32 không khớp cấu hình đã gửi; trạng thái chưa xác nhận", 409));
    return;
  }
  console.log(`Command ACK APPLIED: ${pending.deviceId}/${data.commandId}`);
  settleCommand(data.commandId, null, data);
}

async function saveDeviceAlert(data, topic) {
  const match = /^coldchain\/v1\/devices\/([A-Za-z0-9_-]+)\/alert$/.exec(topic);
  if (!match || data.deviceId !== match[1] || typeof data.tripId !== "string" ||
      !["DOOR_BREACH", "DOOR_OPEN_TOO_LONG"].includes(data.type) || typeof data.active !== "boolean") {
    throw new Error("Invalid device alert payload");
  }
  if (!data.active) {
    await recoverIncident({ deviceId: data.deviceId, tripId: data.tripId, type: data.type });
    return;
  }

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
  const incident = await openIncident({ tripId: data.tripId, deviceId: data.deviceId,
    type: data.type, message });
  if (!incident.created) return;

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
    if (!data.messageId) {
      console.warn(`Telemetry from ${data.deviceId} has no messageId; duplicate detection unavailable`);
    }

    // One round trip returns deduplication, trip settings, registered sensors
    // and the recent temperature history needed for early warning.
    const context = await new sql.Request(transaction)
      .input("deviceId", sql.VarChar(50), data.deviceId)
      .input("tripId", sql.VarChar(30), data.tripId)
      .input("messageId", sql.NVarChar(100), data.messageId || null)
      .input("measuredAt", sql.DateTimeOffset, new Date(data.timestamp))
      .query(`
        SELECT TOP 1 packet_id FROM telemetry_packets
        WHERE @messageId IS NOT NULL AND device_id = @deviceId AND message_id = @messageId;

        SELECT t.min_temperature, t.max_temperature, t.early_warning_minutes
        FROM devices d
        INNER JOIN trips t ON t.vehicle_id = d.vehicle_id
        WHERE d.device_id = @deviceId AND t.trip_id = @tripId;

        SELECT sensor_id FROM sensors WHERE device_id = @deviceId;

        SELECT s.sensor_id, h.temperature, h.measured_at
        FROM sensors s
        CROSS APPLY (
          SELECT TOP 5 r.temperature, p.measured_at
          FROM sensor_readings r
          INNER JOIN telemetry_packets p ON p.packet_id = r.packet_id
          WHERE r.device_id = @deviceId AND r.sensor_id = s.sensor_id
            AND p.trip_id = @tripId AND p.measured_at < @measuredAt
            AND r.temperature IS NOT NULL AND r.sensor_status = 'ONLINE'
          ORDER BY p.measured_at DESC
        ) h
        WHERE s.device_id = @deviceId
      `);
    const [duplicates, tripRows, registeredSensors, historyRows] = context.recordsets;
    if (duplicates.length) {
      await transaction.rollback();
      console.log(`Duplicate telemetry ignored: ${data.deviceId}/${data.messageId}`);
      return { duplicate: true, packetId: duplicates[0].packet_id };
    }
    if (tripRows.length !== 1) throw new Error("Device is not assigned to this trip");
    const trip = tripRows[0];
    const sensorIds = new Set(registeredSensors.map((row) => row.sensor_id));
    if (data.sensors.some((sensor) => !sensorIds.has(sensor.sensorId))) {
      throw new Error("Telemetry contains an unknown sensor");
    }
    const historyBySensor = Object.fromEntries(data.sensors.map((sensor) => [sensor.sensorId, []]));
    for (const row of historyRows) {
      if (!historyBySensor[row.sensor_id]) continue;
      historyBySensor[row.sensor_id].push({
        temperature: row.temperature,
        time: new Date(row.measured_at).getTime()
      });
    }

    const alerts = evaluateTemperatureAlerts({
      sensors: data.sensors,
      minTemperature: trip.min_temperature,
      maxTemperature: trip.max_temperature,
      earlyWarningMinutes: trip.early_warning_minutes,
      historyBySensor,
      measuredAt: data.timestamp
    });

    // Save the packet, five readings and any alerts in one SQL round trip.
    const writeRequest = new sql.Request(transaction)
      .input("deviceId", sql.VarChar(50), data.deviceId)
      .input("tripId", sql.VarChar(30), data.tripId)
      .input("messageId", sql.NVarChar(100), data.messageId || null)
      .input("door", sql.VarChar(10), data.door)
      .input("latitude", sql.Float, data.latitude)
      .input("longitude", sql.Float, data.longitude)
      .input("timestamp", sql.DateTimeOffset, new Date(data.timestamp))
      .input("isBuffered", sql.Bit, data.isBuffered);
    const readingValues = data.sensors.map((sensor, index) => {
      writeRequest
        .input(`sensorId${index}`, sql.VarChar(20), sensor.sensorId)
        .input(`temperature${index}`, sql.Float, sensor.temperature)
        .input(`humidity${index}`, sql.Float, sensor.humidity)
        .input(`status${index}`, sql.VarChar(20), sensor.status);
      return `(@sensorId${index}, @temperature${index}, @humidity${index}, @status${index})`;
    });
    const alertValues = alerts.map((alert, index) => {
      writeRequest
        .input(`alertSensor${index}`, sql.VarChar(20), alert.sensorId)
        .input(`alertType${index}`, sql.VarChar(50), alert.type)
        .input(`alertTemperature${index}`, sql.Float, alert.temperature)
        .input(`alertThreshold${index}`, sql.Float, alert.threshold)
        .input(`alertMessage${index}`, sql.NVarChar(500), alert.message);
      return `(@alertSensor${index}, @alertType${index}, @alertTemperature${index}, @alertThreshold${index}, @alertMessage${index})`;
    });
    const onlineSensors = data.sensors.filter((sensor) => sensor.status === "ONLINE" && Number.isFinite(sensor.temperature));
    const onlineValues = onlineSensors.map((sensor, index) => {
      writeRequest.input(`onlineSensor${index}`, sql.VarChar(20), sensor.sensorId);
      return `(@onlineSensor${index})`;
    });
    const writeResult = await writeRequest.query(`
      DECLARE @inserted TABLE (packet_id BIGINT);
      DECLARE @activeAlerts TABLE (sensor_id VARCHAR(20), alert_type VARCHAR(50),
        temperature FLOAT, threshold_value FLOAT, message NVARCHAR(500));
      DECLARE @onlineSensors TABLE (sensor_id VARCHAR(20));
      DECLARE @newAlerts TABLE (sensor_id VARCHAR(20), alert_type VARCHAR(50));
      ${alertValues.length ? `INSERT INTO @activeAlerts VALUES ${alertValues.join(", ")};` : ""}
      ${onlineValues.length ? `INSERT INTO @onlineSensors VALUES ${onlineValues.join(", ")};` : ""}
      INSERT INTO telemetry_packets (device_id, trip_id, message_id, door_status,
        latitude, longitude, measured_at, is_buffered, message_type)
      OUTPUT INSERTED.packet_id INTO @inserted(packet_id)
      VALUES (@deviceId, @tripId, @messageId, @door, @latitude, @longitude,
        @timestamp, @isBuffered, 'TELEMETRY');

      INSERT INTO sensor_readings (packet_id, device_id, sensor_id, temperature, humidity, sensor_status)
      SELECT p.packet_id, @deviceId, v.sensor_id, v.temperature, v.humidity, v.sensor_status
      FROM @inserted p CROSS JOIN (VALUES ${readingValues.join(", ")})
        AS v(sensor_id, temperature, humidity, sensor_status);

      -- An active incident is updated in place, including one manually resolved
      -- while the physical condition is still present.
      UPDATE a SET last_seen_at = SYSDATETIMEOFFSET(), occurrence_count = a.occurrence_count + 1,
        temperature = v.temperature, threshold_value = v.threshold_value, message = v.message
      FROM alerts a INNER JOIN @activeAlerts v
        ON a.sensor_id = v.sensor_id AND a.alert_type = v.alert_type
      WHERE a.trip_id = @tripId AND a.device_id = @deviceId AND a.recovered_at IS NULL;

      -- Only a valid ONLINE sample can establish recovery. FAULT/OFFLINE is unknown.
      UPDATE a SET recovered_at = SYSDATETIMEOFFSET(), status = 'RESOLVED',
        resolved_at = COALESCE(a.resolved_at, SYSDATETIMEOFFSET())
      FROM alerts a INNER JOIN @onlineSensors s ON s.sensor_id = a.sensor_id
      WHERE a.trip_id = @tripId AND a.device_id = @deviceId AND a.recovered_at IS NULL
        AND a.alert_type IN ('EARLY_WARNING', 'TEMPERATURE_EXCURSION')
        AND NOT EXISTS (SELECT 1 FROM @activeAlerts v
          WHERE v.sensor_id = a.sensor_id AND v.alert_type = a.alert_type);

      INSERT INTO alerts (trip_id, device_id, sensor_id, packet_id, alert_type,
        temperature, threshold_value, message)
      OUTPUT INSERTED.sensor_id, INSERTED.alert_type INTO @newAlerts(sensor_id, alert_type)
      SELECT @tripId, @deviceId, v.sensor_id, p.packet_id, v.alert_type,
        v.temperature, v.threshold_value, v.message
      FROM @activeAlerts v CROSS JOIN @inserted p
      WHERE NOT EXISTS (SELECT 1 FROM alerts a WITH (UPDLOCK, HOLDLOCK)
        WHERE a.trip_id = @tripId AND a.device_id = @deviceId AND a.sensor_id = v.sensor_id
          AND a.alert_type = v.alert_type AND a.recovered_at IS NULL);
      SELECT packet_id FROM @inserted;
      SELECT sensor_id, alert_type FROM @newAlerts;
    `);
    const packetId = writeResult.recordsets[0][0].packet_id;
    const createdAlertKeys = new Set(writeResult.recordsets[1].map((row) => `${row.sensor_id}:${row.alert_type}`));
    const newAlerts = alerts.filter((alert) => createdAlertKeys.has(`${alert.sensorId}:${alert.type}`));

    await transaction.commit();

    console.log(
      `Saved packet ${packetId}: ${data.sensors.length} sensors, ${newAlerts.length} new alert(s)`
    );

    // Gửi sau khi transaction đã commit để Telegram không báo một bản ghi chưa lưu.
    if (newAlerts.length) void notifyTelegramAlerts(data, newAlerts);
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
    ackSubscriptionReady = false;

    client.subscribe([TOPIC, STATUS_TOPIC, ALERT_TOPIC, ACK_TOPIC], (error, granted) => {
      if (error) {
        console.error("Subscribe failed:", error.message);
      } else {
        ackSubscriptionReady = granted?.some((entry) => entry.topic === ACK_TOPIC && entry.qos < 128) || false;
        console.log("Subscribed:", TOPIC, STATUS_TOPIC, ALERT_TOPIC, ACK_TOPIC);
      }
    });
  });

  client.on("close", () => {
    ackSubscriptionReady = false;
    for (const commandId of pendingCommands.keys()) {
      settleCommand(commandId, commandError("Mất kết nối MQTT trước khi nhận ACK; trạng thái ESP32 chưa xác định"));
    }
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

    if (topic.endsWith("/ack")) {
      handleCommandAck(data, topic);
      return;
    }

    // The dashboard can show a live sample immediately. Database persistence
    // continues in the ordered queue for history, alerts and replay.
    if (topic.endsWith("/telemetry") && !data.isBuffered) {
      try {
        validateTelemetry(data, topic);
        noteTelemetryArrival(data);
        publishLiveTelemetry(data);
      } catch (error) {
        console.error("MQTT live telemetry rejected:", error.message);
        return;
      }
    }

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
  if (!activeClient?.connected || !ackSubscriptionReady) {
    return Promise.reject(commandError("MQTT hoặc kênh ACK chưa kết nối"));
  }

  if ([...pendingCommands.values()].some((pending) => pending.deviceId === deviceId)) {
    return Promise.reject(commandError("Thiết bị đang xử lý một lệnh khác", 409));
  }

  const topic = `coldchain/v1/devices/${deviceId}/command`;
  const commandId = randomUUID();
  const payload = { ...command, commandId };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      settleCommand(commandId, commandError("Hết thời gian chờ ACK từ ESP32; lệnh có thể đã tới nhưng chưa được xác nhận", 504));
    }, COMMAND_ACK_TIMEOUT_MS);
    pendingCommands.set(commandId, { deviceId, command, timer, resolve, reject });
    activeClient.publish(topic, JSON.stringify(payload), { qos: 0 }, (error) => {
      if (error) settleCommand(commandId, commandError(`Không gửi được lệnh MQTT: ${error.message}`));
    });
  });
}

module.exports = startMqtt;
module.exports.publishCommand = publishCommand;
module.exports.isMqttConnected = () => Boolean(activeClient?.connected && ackSubscriptionReady);
