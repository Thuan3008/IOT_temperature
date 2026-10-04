# Kiến trúc

ESP32/DHT22 → MQTT Mosquitto → Node.js/Express → SQL Server `ColdChainDB` → REST API/Frontend.

Backend dùng `mssql` connection pool và transaction cho mỗi telemetry packet: một dòng `telemetry_packets` và năm dòng `sensor_readings`. Payload JSON giữ camelCase; SQL dùng snake_case.

`messageId` được giữ nguyên khi gửi lại; unique filtered index theo thiết bị giúp MQTT redelivery không tạo packet/readings lặp. Payload đời cũ không có ID vẫn được nhận nhưng không có bảo đảm chống trùng.

Trong transaction lưu telemetry, Backend đọc ngưỡng min/max và `early_warning_minutes` đã cấu hình trên chuyến. Mỗi cảm biến ONLINE ngoài ngưỡng kích hoạt `TEMPERATURE_EXCURSION`; nếu ít nhất ba điểm đo cho thấy xu hướng tuyến tính dự kiến chạm ngưỡng trong khoảng cảnh báo thì kích hoạt `EARLY_WARNING`. Mỗi chuyến/thiết bị/cảm biến/loại sự cố chỉ có một incident chưa phục hồi: các mẫu tiếp theo cập nhật `last_seen_at` và `occurrence_count`, Telegram chỉ gửi lúc bắt đầu. Mẫu ONLINE không còn điều kiện cảnh báo sẽ ghi `recovered_at`, chuyển trạng thái sang `RESOLVED`. Alert đầu tiên gắn với packet mở sự cố và được commit hoặc rollback cùng packet/readings. API `GET /api/alerts` hỗ trợ lọc bằng `?tripId=TRIP001`.

Backend có timeout monitor chạy mỗi 15 giây. Monitor giữ `lastSeen` trong RAM cho thiết bị và từng cảm biến có dữ liệu ONLINE; quá 30 giây sẽ cập nhật trạng thái `OFFLINE`, tạo `DEVICE_OFFLINE` hoặc `SENSOR_OFFLINE` và gửi Telegram nếu được bật. Các khoảng thời gian có thể đổi bằng `DEVICE_TIMEOUT_SECONDS`, `SENSOR_TIMEOUT_SECONDS` và `OFFLINE_SCAN_INTERVAL_SECONDS` trong `.env`.

Backend cũng subscribe `coldchain/v1/devices/+/status`. Khi Broker phát LWT `OFFLINE`, backend đánh dấu thiết bị và các cảm biến của nó `OFFLINE` ngay, ghi `DEVICE_OFFLINE` cho chuyến đang hoạt động. Gói `ONLINE` và telemetry hợp lệ phục hồi trạng thái. Timeout 30 giây là đường dự phòng khi không nhận được LWT. Dashboard lấy trạng thái từ API `/api/devices` và `/api/sensors`; cảm biến offline hiện `N/A` thay vì số đo của packet trước.

ESP32 lấy mẫu năm DHT22 mỗi 4 giây, giám sát cửa và phát cảnh báo cục bộ. Khi Wi-Fi/MQTT mất, telemetry được lưu trong Ring Buffer RAM 30 phần tử (khoảng 2 phút ở nhịp 4 giây); queue đầy thì ghi đè dữ liệu cũ nhất. Khi kết nối lại, firmware phát lại FIFO và đặt `isBuffered:true`. Queue mất khi reset/mất điện. Firmware dùng PubSubClient QoS 0; publish thành công không phải xác nhận broker hoặc backend đã nhận.

Khi nhận telemetry hợp lệ, Backend đẩy mẫu mới qua `GET /api/live` (Server-Sent Events) để Dashboard cập nhật ngay, song song với hàng đợi lưu SQL. Dashboard vẫn tải lịch sử và trạng thái từ REST API mỗi 5 giây. Backend gom các truy vấn kiểm tra/lịch sử và các lệnh ghi của một packet thành ít lượt gọi SQL hơn để hàng đợi lưu không tăng theo thời gian.

Device nhận cấu hình từ topic `command`, publish cảnh báo và trạng thái, đồng thời đặt MQTT Last Will `OFFLINE`. Tọa độ GPS là tuyến mô phỏng trong TP.HCM. Firmware kiểm tra ngưỡng riêng từng vùng và trạng thái cửa; backend vẫn chịu trách nhiệm cảnh báo xu hướng tuyến tính `EARLY_WARNING`.

Lệnh điều khiển từ Dashboard có `commandId`. ESP32 kiểm tra toàn bộ cấu hình, áp dụng rồi publish `COMMAND_ACK` lên topic `coldchain/v1/devices/{deviceId}/ack` với trạng thái `APPLIED` và giá trị thực tế, hoặc `REJECTED` kèm lý do. Backend chờ ACK khớp tối đa 25 giây; chỉ khi đó mới lưu Delivery Mode/cấu hình chuyến và trả thành công cho Dashboard. Nếu ACK thất lạc, trạng thái thiết bị chưa xác định dù lệnh có thể đã được áp dụng; QoS 0 vẫn không bảo đảm giao nhận.

Backend xử lý telemetry theo thứ tự, giữ hàng đợi riêng cho trạng thái và cho từng loại cảnh báo MQTT của mỗi thiết bị. Các lệnh gửi Telegram được thực hiện lần lượt; cảnh báo cửa và offline được ưu tiên trước cảnh báo nhiệt độ đang chờ, để tin không chồng lên nhau và cảnh báo khẩn không bị kẹt sau telemetry.
