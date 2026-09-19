# Kiến trúc

ESP32/DHT22 → MQTT Mosquitto → Node.js/Express → SQL Server `ColdChainDB` → REST API/Frontend.

Backend dùng `mssql` connection pool và transaction cho mỗi telemetry packet: một dòng `telemetry_packets` và năm dòng `sensor_readings`. Payload JSON giữ camelCase; SQL dùng snake_case.

`messageId` được giữ nguyên khi gửi lại; unique filtered index theo thiết bị giúp MQTT redelivery không tạo packet/readings lặp. Payload đời cũ không có ID vẫn được nhận nhưng không có bảo đảm chống trùng.

Trong transaction lưu telemetry, Backend đọc ngưỡng min/max và `early_warning_minutes` đã cấu hình trên chuyến. Mỗi cảm biến ONLINE ngoài ngưỡng tạo `TEMPERATURE_EXCURSION`; nếu ít nhất ba điểm đo cho thấy xu hướng tuyến tính dự kiến chạm ngưỡng trong khoảng cảnh báo thì tạo `EARLY_WARNING`. Alert gắn với packet/sensor và được commit hoặc rollback cùng packet/readings. API `GET /api/alerts` hỗ trợ lọc bằng `?tripId=TRIP001`.

ESP32 ghi payload chờ gửi thành từng file FIFO trong LittleFS; khi Wi-Fi/MQTT mất vẫn lấy mẫu, khi kết nối lại phát lại theo thứ tự với QoS 1. `isBuffered` được đặt true cho payload lưu hàng đợi; bản ghi chỉ bị xóa sau PUBACK. Mỗi retry giữ nguyên messageId, nên nếu PUBACK bị mất sau khi backend đã nhận, backend chống lưu trùng qua unique index. Hàng đợi giới hạn 512 bản ghi và không tự ghi đè dữ liệu cũ khi đầy.
