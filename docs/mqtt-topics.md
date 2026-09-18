 # MQTT contract

 Backend subscribes to `coldchain/v1/devices/+/telemetry`. The topic device ID must equal `payload.deviceId`.

 - `coldchain/v1/devices/{deviceId}/telemetry`: ESP32/tester publishes telemetry; backend consumes it.
 - `coldchain/v1/devices/{deviceId}/alert`: backend publishes alerts in a later phase.
 - `coldchain/v1/devices/{deviceId}/status`: device status/LWT.
 - `coldchain/v1/devices/{deviceId}/command`: backend commands.
 - `coldchain/v1/trips/{tripId}/telemetry`: reserved for trip-level consumers.

 The current official payload is `mqtt/test-telemetry.json`, with exactly five sensor objects. The current contract has no message ID, so duplicate delivery is not fully preventable. Add `messageId` or a device `sequenceNumber` in the next compatible contract version and enforce a unique key in SQL Server.
