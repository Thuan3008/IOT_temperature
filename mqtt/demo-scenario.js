/**
 * demo-scenario.js — Công cụ CLI kiểm thử Kịch bản Demo Mất Mạng (Store & Forward)
 *
 * Cách chạy:
 *   node mqtt/demo-scenario.js --help
 *   node mqtt/demo-scenario.js --trigger   (Gửi lệnh ngắt mạng tới ESP32 đang chạy)
 *   node mqtt/demo-scenario.js --emulate   (Giả lập luồng ESP32 thực hiện ngắt mạng và xả đệm qua MQTT)
 */

const mqtt = require("mqtt");
const fs = require("fs");
const path = require("path");

const BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://127.0.0.1:1883";
const DEVICE_ID = process.env.DEVICE_ID || "ESP32-01";
const TRIP_ID = process.env.TRIP_ID || "TRIP001";
const DURATION_SEC = parseInt(process.argv.find((a) => a.startsWith("--duration="))?.split("=")[1] || "16", 10);

const isEmulate = process.argv.includes("--emulate");
const isTrigger = process.argv.includes("--trigger") || !isEmulate;

console.log("==================================================================");
console.log("   SMART COLD CHAIN IoT — KỊCH BẢN DEMO MẤT MẠNG & XẢ ĐỆM");
console.log("==================================================================");
console.log(`Broker:   ${BROKER_URL}`);
console.log(`Thiết bị: ${DEVICE_ID} | Chuyến: ${TRIP_ID}`);
console.log(`Thời gian ngắt sóng: ${DURATION_SEC} giây`);
console.log(`Chế độ:   ${isEmulate ? "GIẢ LẬP ESP32 PHÁT LẠI ĐỆM" : "GỬI LỆNH TỚI ESP32 (HARDWARE/WOKWI)"}\n`);

if (isTrigger) {
  // Chế độ Trigger: Đăng nhập bằng user 'backend' hoặc 'tester' và gửi MQTT command tới ESP32
  const client = mqtt.connect(BROKER_URL, {
    username: process.env.MQTT_USER || "tester",
    password: process.env.MQTT_PASSWORD || "tester",
    clientId: `demo-trigger-${Date.now()}`,
  });

  const commandTopic = `coldchain/v1/devices/${DEVICE_ID}/command`;
  const ackTopic = `coldchain/v1/devices/${DEVICE_ID}/ack`;
  const statusTopic = `coldchain/v1/devices/${DEVICE_ID}/status`;
  const commandId = `cmd-demo-${Date.now()}`;

  client.on("connect", () => {
    console.log("✓ Đã kết nối tới Mosquitto MQTT Broker.");
    client.subscribe([ackTopic, statusTopic], () => {
      console.log(`✓ Đã đăng ký lắng nghe: ${ackTopic} & ${statusTopic}`);
      console.log(`➔ Đang phát lệnh ngắt mạng tới ${commandTopic}...`);

      const payload = {
        commandId,
        action: "SIMULATE_OUTAGE",
        durationSeconds: DURATION_SEC,
      };

      client.publish(commandTopic, JSON.stringify(payload), { qos: 0 }, (err) => {
        if (err) {
          console.error("✗ Lỗi gửi lệnh:", err.message);
          client.end();
        } else {
          console.log(`✓ Lệnh ${commandId} đã gửi đi thành công.`);
          console.log("Đang chờ ESP32 phản hồi ACK và chuyển OFFLINE...\n");
        }
      });
    });
  });

  client.on("message", (topic, message) => {
    try {
      const data = JSON.parse(message.toString());
      if (topic === ackTopic && data.commandId === commandId) {
        console.log(`[ACK NHẬN ĐƯỢC] Trạng thái: ${data.status} | Lệnh: ${data.applied?.action || "APPLIED"}`);
      } else if (topic === statusTopic) {
        console.log(`[TRẠNG THÁI THIẾT BỊ] ${data.deviceId} -> ${data.status === "ONLINE" ? "🟢 ONLINE" : "🔴 OFFLINE"}`);
        if (data.status === "ONLINE") {
          console.log("\n✓ Kịch bản hoàn tất: Thiết bị đã kết nối lại thành công!");
          setTimeout(() => client.end(), 2000);
        }
      }
    } catch {}
  });

  client.on("error", (err) => {
    console.error("✗ Lỗi kết nối MQTT:", err.message);
    client.end();
  });
} else {
  // Chế độ Emulate: Tự đóng vai ESP32 để kiểm thử toàn bộ luồng Backend & Dashboard
  const client = mqtt.connect(BROKER_URL, {
    username: "esp32",
    password: process.env.MQTT_PASSWORD || "esp32",
    clientId: `${DEVICE_ID}-emulator`,
    will: {
      topic: `coldchain/v1/devices/${DEVICE_ID}/status`,
      payload: JSON.stringify({ deviceId: DEVICE_ID, status: "OFFLINE" }),
      qos: 0,
      retain: true,
    },
  });

  const telemetryTopic = `coldchain/v1/devices/${DEVICE_ID}/telemetry`;
  const statusTopic = `coldchain/v1/devices/${DEVICE_ID}/status`;

  function makeReading(isBuffered = false, offsetSec = 0) {
    const time = new Date(Date.now() - offsetSec * 1000).toISOString();
    return {
      type: "TELEMETRY",
      deviceId: DEVICE_ID,
      tripId: TRIP_ID,
      timestamp: time,
      messageId: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      door: "CLOSED",
      latitude: 10.7622,
      longitude: 106.6825,
      isBuffered: Boolean(isBuffered),
      sensors: [
        { sensorId: "S1", status: "ONLINE", temperature: 4.2, humidity: 65.0 },
        { sensorId: "S2", status: "ONLINE", temperature: 4.8, humidity: 66.0 },
        { sensorId: "S3", status: "ONLINE", temperature: 5.1, humidity: 66.5 },
        { sensorId: "S4", status: "ONLINE", temperature: 5.8, humidity: 67.0 },
        { sensorId: "S5", status: "ONLINE", temperature: 5.3, humidity: 66.0 },
      ],
    };
  }

  client.on("connect", async () => {
    console.log("✓ Emulator: Đã kết nối MQTT Broker với vai trò ESP32.");
    client.publish(statusTopic, JSON.stringify({ deviceId: DEVICE_ID, status: "ONLINE" }), { retain: true });

    console.log("1. Phát gói tin telemetry bình thường...");
    client.publish(telemetryTopic, JSON.stringify(makeReading(false)));

    await new Promise((r) => setTimeout(r, 2000));

    console.log("\n2. BẮT ĐẦU MẤT MẠNG: Phát thông báo OFFLINE và ngắt kết nối MQTT...");
    client.publish(statusTopic, JSON.stringify({ deviceId: DEVICE_ID, status: "OFFLINE" }), { retain: true }, () => {
      client.end(true); // Ngắt kết nối thực sự

      const bufferedPackets = [];
      const totalSamples = Math.floor(DURATION_SEC / 4);

      console.log(`3. Giả lập ESP32 đo cảm biến ngoại tuyến trong ${DURATION_SEC}s (${totalSamples} mẫu)...`);
      let count = 0;
      const interval = setInterval(() => {
        count++;
        bufferedPackets.push(makeReading(true, (totalSamples - count) * 4));
        console.log(`   [ĐO NGOẠI TUYẾN] Đã ghi gói ${count}/${totalSamples} vào Ring Buffer.`);
        if (count >= totalSamples) {
          clearInterval(interval);

          console.log("\n4. HẾT THỜI GIAN NGẮT SÓNG: Kết nối lại WiFi & MQTT...");
          const reconnectedClient = mqtt.connect(BROKER_URL, {
            username: "esp32",
            password: process.env.MQTT_PASSWORD || "esp32",
            clientId: `${DEVICE_ID}-emulator`,
          });

          reconnectedClient.on("connect", async () => {
            console.log("✓ Emulator: Bắt lại sóng thành công! Phát ONLINE...");
            reconnectedClient.publish(statusTopic, JSON.stringify({ deviceId: DEVICE_ID, status: "ONLINE" }), { retain: true });

            console.log(`5. TIẾN HÀNH XẢ BỘ ĐỆM: Đang phát ${bufferedPackets.length} gói tin với isBuffered = true...`);
            for (const pkt of bufferedPackets) {
              reconnectedClient.publish(telemetryTopic, JSON.stringify(pkt));
              console.log(`   ➔ Đã xả gói đệm ${pkt.messageId} (isBuffered=true)`);
              await new Promise((r) => setTimeout(r, 400));
            }

            console.log("\n✓ Hoàn tất kịch bản demo một nút bấm qua luồng MQTT!");
            setTimeout(() => reconnectedClient.end(), 1500);
          });
        }
      }, 4000);
    });
  });
}
