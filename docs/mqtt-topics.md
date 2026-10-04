 # MQTT contract

 Backend subscribes to `coldchain/v1/devices/+/telemetry`. The topic device ID must equal `payload.deviceId`.

 - `coldchain/v1/devices/{deviceId}/telemetry`: ESP32/tester publishes telemetry; backend consumes it.
 - `coldchain/v1/devices/{deviceId}/alert`: ESP32 publishes local alert activation/clear events.
 - `coldchain/v1/devices/{deviceId}/status`: ESP32 publishes retained ONLINE; MQTT broker publishes OFFLINE from LWT on an unexpected disconnect. Backend subscribes topic này để cập nhật `devices` và `sensors`, lưu `DEVICE_OFFLINE` cho chuyến đang hoạt động và gửi Telegram nếu được bật.
 - `coldchain/v1/devices/{deviceId}/command`: ESP32 subscribes for JSON configuration; backend or tester publishes commands.
 - `coldchain/v1/devices/{deviceId}/ack`: ESP32 publishes `COMMAND_ACK` after validating and applying a command; backend matches `commandId` and checks the reported configuration.
 - `coldchain/v1/trips/{tripId}/telemetry`: reserved for trip-level consumers.

The official payload is `mqtt/test-telemetry.json`, with exactly five sensor objects and a `messageId`. The field is optional for backward compatibility; messages without it are accepted but cannot be deduplicated. For messages with an ID, SQL Server enforces uniqueness on `(device_id, message_id)`. Firmware Store & Forward uses a 30-entry RAM FIFO. PubSubClient publishes at QoS 0: a successful `publish()` call is not a PUBACK and does not prove backend persistence. See [wokwi-demo.md](wokwi-demo.md) for setup, command examples and demo scenarios.

Dashboard commands include a unique `commandId`. The ESP32 responds with `{"type":"COMMAND_ACK","commandId":"...","deviceId":"ESP32-01","status":"APPLIED","applied":{...}}` or `status:"REJECTED"` with `reason`. Backend reports success only after a matching `APPLIED` ACK; an ACK timeout (25 seconds) means the state is unknown, not necessarily that the ESP32 rejected the command. This application ACK confirms firmware configuration, not SQL telemetry persistence. Command and ACK remain MQTT QoS 0.
