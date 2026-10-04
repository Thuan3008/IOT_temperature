# Mô phỏng ESP32 trên Wokwi

## Kiến trúc

```text
5 x DHT22 ─┐
Nút cửa ───┼─> ESP32 ── MQTT telemetry/alert/status ──> Broker ──> Backend/SQL/Dashboard
GPS giả ───┘      ^              command <──────────────────┘
                  ├─ LED đỏ + buzzer (cảnh báo cục bộ)
                  ├─ LED xanh (MQTT đã kết nối)
                  └─ Ring Buffer RAM 30 gói khi MQTT/Wi-Fi không sẵn sàng
```

ESP32 lấy mẫu năm vùng độc lập, kiểm tra Tmin/Tmax riêng từng cảm biến, đọc cửa, cập nhật tọa độ giả lập và gửi telemetry. Backend hiện có sẵn trong repository, lưu telemetry và tính `TEMPERATURE_EXCURSION`/`EARLY_WARNING`; firmware không chạy hồi quy tuyến tính. Firmware tạo cảnh báo cục bộ cho vượt ngưỡng, DOOR_BREACH và DOOR_OPEN_TOO_LONG.

## Linh kiện và chân

| Linh kiện | GPIO | Nối dây |
|---|---:|---|
| DHT22 S1–S5 DATA | 13, 14, 25, 26, 27 | Mỗi cảm biến cấp 3V3/GND và có pull-up 10 kΩ từ SDA lên 3V3 |
| Nút cửa | 32 | Chân còn lại nối GND; dùng INPUT_PULLUP |
| LED đỏ | 18 | Qua điện trở 220 Ω xuống GND |
| Buzzer | 19 | Chân còn lại xuống GND |
| LED xanh | 23 | Qua điện trở 220 Ω xuống GND |

Vị trí S1–S5 lần lượt là gần dàn lạnh, phía trước, trung tâm, gần cửa và phía sau khoang. Đối chiếu dây và GPIO trực tiếp trong `esp32/diagram.json`.

## Mở và chạy Wokwi

1. Mở thư mục `esp32` trong VS Code, cài PlatformIO IDE và Wokwi extension.
2. Tạo `esp32/secrets.h` từ `secrets.example.h`. File này bị Git bỏ qua; nhập MQTT username/password của broker. Không chia sẻ hoặc commit mật khẩu.
3. Chạy `pio run -e wokwi` để biên dịch.
4. Mở `diagram.json`, chạy Wokwi, mở Serial Monitor ở 115200 baud.
5. Nếu dùng Mosquitto đang chạy trên máy phát triển, bật **Wokwi: Enable Private Wokwi IoT Gateway**. Trong firmware Wokwi, broker mặc định `host.wokwi.internal:1883`. Đây là thiết lập cho Wokwi VS Code Private Gateway; nó không phải broker Internet công cộng. Có thể đổi `WOKWI_MQTT_BROKER_HOST`/`WOKWI_MQTT_BROKER_PORT` trong `secrets.h`; địa chỉ IP LAN như `172.x.x.x` thường không truy cập được từ mô phỏng nếu gateway/broker không định tuyến tới đó.

Mosquitto trong repository yêu cầu tài khoản và ACL. Nếu cần tạo tài khoản cục bộ:

```powershell
mosquitto_passwd -c mqtt/passwd backend
mosquitto_passwd mqtt/passwd esp32
mosquitto_passwd mqtt/passwd tester
mosquitto -c mqtt/mosquitto.conf -v
```

`MQTT_USERNAME`/`MQTT_PASSWORD` trong `esp32/secrets.h` phải là tài khoản `esp32`. Broker xác thực subscriber/publisher theo `mqtt/acl`. Broker của bạn có thể khác; hãy xác minh host, cổng, xác thực và ACL thay vì giả định địa chỉ nào luôn hoạt động.

## Kiểm tra MQTT hai chiều

Topic thiết bị mặc định:

```text
coldchain/v1/devices/ESP32-01/telemetry
coldchain/v1/devices/ESP32-01/alert
coldchain/v1/devices/ESP32-01/status
coldchain/v1/devices/ESP32-01/command
coldchain/v1/devices/ESP32-01/ack
```

Dùng `mosquitto_sub` để xem dữ liệu và cảnh báo (đổi thông tin đăng nhập theo broker):

```powershell
mosquitto_sub -h 127.0.0.1 -p 1883 -u tester -P '<password>' -t 'coldchain/v1/devices/ESP32-01/#' -v
```

Gửi cấu hình ngưỡng và chế độ giao hàng:

```powershell
mosquitto_pub -h 127.0.0.1 -p 1883 -u tester -P '<password>' -t coldchain/v1/devices/ESP32-01/command -m '{"commandId":"manual-001","tripId":"TRIP001","tripState":"IN_TRANSIT","profileId":"VEGETABLE_CHILLED","Tmin":3.0,"Tmax":8.0,"earlyWarningMinutes":10,"maxDoorOpenSeconds":30,"deliveryMode":false}'
```

Lệnh chỉ được áp dụng nếu JSON và ngưỡng hợp lệ. `tripState` và `deliveryMode` là hai cài đặt độc lập. Storage Profile mang tên và ngưỡng giám sát, firmware không điều khiển máy lạnh. `earlyWarningMinutes` được firmware giữ làm cấu hình nhưng dự báo cảnh báo sớm hiện do backend tính từ lịch sử.

Sau khi áp dụng, Serial in `Command ACK APPLIED` và topic `.../ack` có bản tin cùng `commandId`. Nếu ESP32 từ chối, ACK có `status: REJECTED` và `reason`. Dashboard chờ tối đa 25 giây; hết hạn chỉ có nghĩa chưa xác nhận. Sau khi sửa firmware hoặc ACL, build lại `pio run -e wokwi`, khởi động lại mô phỏng, Mosquitto và Backend để nạp cấu hình mới.

PubSubClient publish telemetry/alert/status ở QoS 0. Vì vậy `publish()` thành công chỉ cho biết thư viện đã chấp nhận gửi, không xác nhận broker hay backend đã xử lý gói. Ring Buffer lưu trong RAM, mất khi reset/mất điện; đầy sẽ ghi đè gói cũ nhất. LWT được Broker phát khi phát hiện kết nối MQTT bị mất bất thường.

## Kịch bản demo

| Kịch bản | Thao tác | Kết quả mong đợi |
|---|---|---|
| Bình thường | Để S1–S5 trong 4–5°C, cửa đóng | Không có cảnh báo; LED xanh sáng khi MQTT kết nối |
| Xu hướng tăng | Tăng S4 từng bước từ 4°C lên 7.5°C, chờ các mẫu | Telemetry đầy đủ; backend có thể tạo `EARLY_WARNING` khi lịch sử cho thấy chạm ngưỡng trong khoảng cấu hình |
| Vượt ngưỡng | Đặt S4 = 9°C, các vùng khác = 5°C, Tmax = 8°C | Chỉ S4 bất thường; `TEMPERATURE_EXCURSION`, LED đỏ nhấp nháy và buzzer |
| Mở cửa trái phép | Gửi cấu hình `IN_TRANSIT`, `deliveryMode:false`, giữ nút Door 5 giây | Cửa đổi trạng thái một lần, phát `DOOR_BREACH` và báo động cục bộ; thả rồi giữ 5 giây để đóng |
| Giao hàng | Gửi command `deliveryMode:true`, mở cửa | Không có `DOOR_BREACH`; nhiệt độ và thời gian mở cửa vẫn được giám sát; quá thời hạn sẽ có `DOOR_OPEN_TOO_LONG` |
| Mất mạng | Gõ `WIFI_OFF` trong Serial Monitor | Lấy mẫu và báo động cục bộ vẫn chạy; telemetry được lưu trong RAM ring buffer; broker có thể phát LWT OFFLINE sau timeout |
| Khôi phục | Gõ `WIFI_ON` | Thiết bị kết nối lại và lần lượt phát lại hàng đợi với `isBuffered:true` |
| Lỗi cảm biến | Gõ `SENSOR_FAIL S2`, sau đó `SENSOR_RECOVER S2` | S2 mang trạng thái FAULT với nhiệt độ/độ ẩm null; các cảm biến khác tiếp tục gửi |

Nút nhấn hoạt động theo kiểu nhấn một lần mở, nhấn lần nữa đóng. Nhiệt độ/độ ẩm DHT22 được chỉnh trực tiếp trong Wokwi: bấm vào từng cảm biến và sửa thuộc tính. Firmware đọc DHT22 theo chu kỳ 4 giây; Dashboard nhận mẫu mới qua luồng trực tiếp và cập nhật lịch sử từ SQL mỗi 5 giây.

Các lệnh Serial không phân biệt hoa thường cho WIFI_ON/OFF; lệnh cảm biến dùng ID S1–S5. Serial Monitor cũng in trạng thái Wi-Fi/MQTT, cửa, cảm biến và số phần tử đang đệm.

## Lỗi thường gặp

- **Wi-Fi lên nhưng MQTT không kết nối:** kiểm tra Private IoT Gateway, broker host/port, Mosquitto đang chạy, thông tin đăng nhập và ACL.
- **Không nhận command:** publish đúng topic device ID, JSON hợp lệ, quyền ACL cần có `write` command; kiểm tra log “MQTT command received”.
- **Dashboard/API không thấy telemetry:** backend subscribe topic wildcard telemetry và cần SQL Server/schema/seed hợp lệ; kiểm tra `/api/health` và log backend.
- **LED xanh tắt:** chỉ biểu thị MQTT đã kết nối; kiểm tra Wi-Fi trước, rồi tới broker.
- **Số đo null hoặc FAULT:** kiểm tra dây DATA/GPIO của đúng DHT22 hoặc xem có đang bật `SENSOR_FAIL` không.
- **Không nghe buzzer:** xác nhận cảnh báo còn active; buzzer chỉ kêu theo nhịp trong khi có cảnh báo.
- **Queue bị mất sau khi restart:** đây là thiết kế Ring Buffer trong RAM, dữ liệu không tồn tại sau reset hoặc mất điện.
- **Số gói đệm không tăng khi mất mạng:** xác nhận đã nhập `WIFI_OFF` trong Serial Monitor; lệnh này chủ động chặn reconnect để demo.
