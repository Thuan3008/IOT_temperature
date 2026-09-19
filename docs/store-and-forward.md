# ESP32 Store & Forward

Firmware samples the five DHT22 sensors every 5 seconds. If Wi-Fi or MQTT is unavailable, the complete JSON payload is written to an individual LittleFS file in monotonically numbered FIFO order. On reconnection, it is replayed oldest-first with `isBuffered: true` and QoS 1. The file is removed only after the MQTT client reports the PUBACK exchange succeeded. If the ACK is lost after the backend committed the packet, replay uses the same `messageId`; SQL Server deduplication makes that replay safe.

The queue holds up to 512 records. It never overwrites the oldest unacknowledged item; when full, the firmware emits a critical Serial message. The firmware never auto-formats LittleFS on mount failure.

## Configure and flash a physical ESP32

1. Copy `esp32/secrets.example.h` to `esp32/secrets.h`. Set the Wi-Fi and `esp32` MQTT account credentials. Set `MQTT_BROKER_HOST` to the Windows computer's private LAN IPv4 address, not `localhost`/`127.0.0.1`.
2. The current Mosquitto config keeps port 1883 bound to loopback for backend/tester. For a physical ESP32, configure a second authenticated listener on a private LAN address and a separate port (for example 1884), retaining the ACL and password authentication. Scope the Windows Firewall rule to the Private profile/local subnet. Do not port-forward or expose the broker to the Internet. Set `MQTT_BROKER_PORT` to that listener.
3. From the `esp32` directory, build firmware with `pio run --environment esp32dev`.
4. On a new physical board, provision LittleFS once with `pio run --target uploadfs --environment esp32dev`, then flash firmware with `pio run --target upload --environment esp32dev`. Provisioning replaces the filesystem: never repeat it while queued telemetry must be preserved.
5. Open Serial Monitor at 115200 baud. Confirm `LittleFS ready`, Wi-Fi/MQTT connected and live `PUBACK` messages.

To test: keep the ESP32 powered, interrupt its Wi-Fi or stop the broker, and observe `Buffered packet ...`. Restore connectivity. Expected output is FIFO `Replaying buffered packet ...`, then `PUBACK received; removed ...`. Backend telemetry should show those original `messageId` values with `is_buffered = true`. The MQTT broker must be reachable on the LAN listener for this test.

## Wokwi simulation

The dedicated PlatformIO `wokwi` environment overrides the Wi-Fi settings to `Wokwi-GUEST` and the broker hostname to `host.wokwi.internal`. Wokwi for VS Code includes a Private IoT Gateway that can connect the virtual ESP32 to services on the host computer; enable it from the VS Code Command Palette if needed. Keep Mosquitto on its current authenticated loopback listener; no LAN listener or public port is needed. The local `esp32` MQTT password still must be configured in the ignored `secrets.h`. In the Wokwi build only, LittleFS formats a blank simulated filesystem; on a physical board the firmware continues to refuse auto-format. See [Wokwi ESP32 Wi-Fi docs](https://docs.wokwi.com/guides/esp32-wifi) and [Wokwi VS Code project config](https://docs.wokwi.com/vscode/project-config).

After building `.pio/build/wokwi/firmware.bin`, open `diagram.json` and start the simulation. Confirm the Serial Monitor shows Wi-Fi connected, MQTT connected and live PUBACKs. Stop Mosquitto temporarily while leaving the simulation running; queued samples should appear, then replay after Mosquitto restarts. Stopping/restarting a simulation may reset simulated flash; do not treat it as a power-loss durability test on physical hardware.

## Time and storage notes

The firmware starts its system clock from build time as a fallback, then synchronizes UTC using NTP when Wi-Fi is available. Measurements buffered after a successful time sync retain their measured time while the ESP32 stays powered offline. If it boots without Wi-Fi/NTP, timestamps are approximate until synchronization succeeds.
