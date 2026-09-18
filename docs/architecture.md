# Kiến trúc

ESP32/DHT22 → MQTT Mosquitto → Node.js/Express → SQL Server `ColdChainDB` → REST API/Frontend.

Backend dùng `mssql` connection pool và transaction cho mỗi telemetry packet: một dòng `telemetry_packets` và năm dòng `sensor_readings`. Payload JSON giữ camelCase; SQL dùng snake_case.

Store & Forward hiện được mô tả và hỗ trợ qua `isBuffered`; ring buffer phía ESP32 cần hoàn thiện cùng message ID/sequence number để chống trùng.
