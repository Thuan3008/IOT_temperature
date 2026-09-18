const mqtt = require("mqtt");
const sql = require("mssql");

const poolPromise = require("./db");

const TOPIC =
  "coldchain/v1/devices/+/telemetry";

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

    // Luu thong tin chung cua ban tin
    const packetResult = await new sql.Request(transaction)
      .input("deviceId", sql.VarChar(50), data.deviceId)
      .input("tripId", sql.VarChar(30), data.tripId)
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

    await transaction.commit();

    console.log(
      `Saved packet ${packetId}: ${data.sensors.length} sensors`
    );

  } catch (error) {
    await transaction.rollback();
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

  client.on("connect", () => {
    console.log("MQTT connected!");

    client.subscribe(TOPIC, (error) => {
      if (error) {
        console.error("Subscribe failed:", error.message);
      } else {
        console.log("Subscribed:", TOPIC);
      }
    });
  });

  // Xu ly theo thu tu, tranh ghi dong thoi
  let queue = Promise.resolve();

  client.on("message", (topic, message) => {
    queue = queue
      .then(async () => {
        let data;
        try { data = JSON.parse(message.toString("utf8")); }
        catch { throw new Error("Payload is not valid JSON"); }

        console.log(`Received telemetry from ${data.deviceId || "unknown"}`);

        await saveTelemetry(data, topic);
      })
      .catch((error) => {
        console.error(
          "Telemetry processing failed:",
          error.message
        );
      });
  });

  client.on("error", (error) => {
    console.error("MQTT error:", error.message);
  });
}

module.exports = startMqtt;
