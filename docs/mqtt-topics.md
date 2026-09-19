 # MQTT contract

 Backend subscribes to `coldchain/v1/devices/+/telemetry`. The topic device ID must equal `payload.deviceId`.

 - `coldchain/v1/devices/{deviceId}/telemetry`: ESP32/tester publishes telemetry; backend consumes it.
 - `coldchain/v1/devices/{deviceId}/alert`: backend publishes alerts in a later phase.
 - `coldchain/v1/devices/{deviceId}/status`: device status/LWT.
 - `coldchain/v1/devices/{deviceId}/command`: backend commands.
 - `coldchain/v1/trips/{tripId}/telemetry`: reserved for trip-level consumers.

 The official payload is `mqtt/test-telemetry.json`, with exactly five sensor objects and a `messageId`. The field is optional for backward compatibility; messages without it are accepted but cannot be deduplicated. For messages with an ID, SQL Server enforces uniqueness on `(device_id, message_id)`. ESP32 creates a boot nonce plus increasing sequence value; each buffered payload is saved with its ID and `isBuffered: true`, then replayed FIFO with QoS 1 until PUBACK. The queue record is removed only after the PUBACK exchange succeeds.
