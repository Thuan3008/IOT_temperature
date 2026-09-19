# Database

Chạy `database/schema.sql` trước, sau đó `database/seed.sql` trong SQL Server Management Studio 21. Hai script không DROP database/table và seed có thể chạy lại.

Database gồm 11 bảng bắt buộc: vehicles, products, storage_profiles, lots, trips, trip_lots, devices, sensors, telemetry_packets, sensor_readings và alerts. `trips` lưu ngưỡng thực tế của chuyến; profile có thể chỉ có `max_temperature`.

`telemetry_packets.message_id` là nullable để tương thích dữ liệu/client cũ. Unique filtered index `UX_telemetry_device_message_id` áp dụng cho `(device_id, message_id)` khi ID có giá trị. Chạy lại `schema.sql` để thêm cột/index an toàn vào database hiện có; không cần xóa dữ liệu.
