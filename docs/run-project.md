# Cách chạy toàn bộ project

Project gồm 5 phần: SQL Server, Mosquitto MQTT, Backend Node.js, Frontend React và mô phỏng ESP32/Wokwi.

## 1. Chuẩn bị

- Cài Node.js, SQL Server và Mosquitto.
- Cài PlatformIO IDE và extension Wokwi trong VS Code.
- Mở project tại:

```text
E:\HK7\IOT\DACK_V1\IOT_temperature
```

Không commit các file chứa mật khẩu: `backend/.env`, `mqtt/passwd` và `esp32/secrets.h`.

## 2. Khởi tạo database

Mở PowerShell tại thư mục gốc và chạy:

```powershell
sqlcmd -S localhost -E -i database\schema.sql
sqlcmd -S localhost -E -i database\seed.sql
```

Nếu database đã tồn tại từ trước, chạy migration trạng thái cảnh báo một lần:

```powershell
sqlcmd -S localhost -E -b -i database\migrations\20260930_alert_lifecycle.sql
```

Sau khi khởi động lại Backend và tải lại Dashboard, mục **Cảnh báo** hiển thị cảnh báo đang mở. Bấm **Đã xử lý** để lưu `status = 'RESOLVED'`; chuyển sang tab **Đã xử lý** để xem lại lịch sử.

Lệnh trên dùng Windows Authentication. Nếu dùng SQL Login, thay `-E` bằng `-U <username> -P <password>`.

## 3. Chạy Mosquitto

Mở **Terminal 1**:

```powershell
cd E:\HK7\IOT\DACK_V1\IOT_temperature\mqtt
mosquitto_passwd -c passwd backend
mosquitto_passwd passwd esp32
mosquitto_passwd passwd tester
mosquitto -c mosquitto.conf -v
```

Chỉ chạy các lệnh `mosquitto_passwd` lần đầu hoặc khi cần đổi mật khẩu. Khi được hỏi, ghi nhớ mật khẩu của `backend`, `esp32` và `tester`.

Nếu Mosquitto báo lỗi listener `192.168.2.40:1884`, mở `mqtt/mosquitto.conf` và tạm comment dòng listener 1884. Wokwi dùng listener `host.wokwi.internal:1883` qua Private IoT Gateway.

## 4. Cấu hình và chạy Backend

Tạo file môi trường:

```powershell
Copy-Item backend\.env.example backend\.env
notepad backend\.env
```

Điền các giá trị chính:

```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=1433
DB_USER=<SQL_LOGIN>
DB_PASSWORD=<SQL_PASSWORD>
DB_NAME=ColdChainDB
MQTT_HOST=mqtt://127.0.0.1:1883
MQTT_USERNAME=backend
MQTT_PASSWORD=<MAT_KHAU_BACKEND>
```

Mở **Terminal 2**:

```powershell
cd E:\HK7\IOT\DACK_V1\IOT_temperature
npm install --prefix backend
npm run dev
```

Kiểm tra Backend:

```text
http://localhost:3000/api/health
```

Kết quả đúng phải có `backend: "OK"` và `database: "SQL Server Connected"`.

## 5. Chạy Frontend

Mở **Terminal 3**:

```powershell
cd E:\HK7\IOT\DACK_V1\IOT_temperature
npm install --prefix frontend
npm run dev --prefix frontend
```

Mở địa chỉ Vite hiện trong terminal, thường là:

```text
http://localhost:5173
```

Dashboard tự gọi Backend mỗi 5 giây.

## 6. Chuẩn bị firmware ESP32/Wokwi

Mở thư mục `esp32` trong VS Code:

```text
E:\HK7\IOT\DACK_V1\IOT_temperature\esp32
```

Tạo file cấu hình cục bộ:

```powershell
Copy-Item secrets.example.h secrets.h
```

Trong build Wokwi, firmware tự dùng:

```text
Wi-Fi: Wokwi-GUEST
Broker: host.wokwi.internal:1883
```

Nhập mật khẩu MQTT của tài khoản `esp32` vào `secrets.h` nếu broker yêu cầu.

Build firmware bằng lệnh đầy đủ nếu `pio` chưa có trong PATH:

```powershell
& "C:\Users\thuan\.platformio\penv\Scripts\platformio.exe" run -e wokwi
```

Kết quả cần có:

```text
wokwi SUCCESS
```

## 7. Chạy Wokwi

1. Bật **Wokwi: Enable Private Wokwi IoT Gateway** trong Command Palette của VS Code.
2. Mở `esp32/diagram.json`.
3. Bấm nút tam giác xanh **Start Simulation** trong cửa sổ Wokwi.
4. Không chọn COM3 trong Serial Monitor.
5. Chọn monitor mode **TCP**, Host `localhost`, Port `4000`.
6. Bấm **Start Monitoring**.

Nếu muốn dùng terminal thay cho Serial Monitor của VS Code:

```powershell
& "C:\Users\thuan\.platformio\penv\Scripts\platformio.exe" device monitor -p rfc2217://localhost:4000 -b 115200
```

Khi chạy đúng, log sẽ cho thấy Wi-Fi connected, MQTT connected và các cảm biến S1–S5 đọc được dữ liệu. Nếu mô phỏng dừng ngay, hãy kiểm tra tab **Output** của Wokwi.

## 8. Kiểm tra MQTT

Mở **Terminal 4**:

```powershell
mosquitto_sub -h 127.0.0.1 -p 1883 -u tester -P "<MAT_KHAU_TESTER>" -t "coldchain/v1/devices/ESP32-01/#" -v
```

Các topic chính:

```text
coldchain/v1/devices/ESP32-01/telemetry
coldchain/v1/devices/ESP32-01/alert
coldchain/v1/devices/ESP32-01/status
coldchain/v1/devices/ESP32-01/command
```

Gửi cấu hình chuyến:

```powershell
mosquitto_pub -h 127.0.0.1 -p 1883 -u tester -P "<MAT_KHAU_TESTER>" `
  -t coldchain/v1/devices/ESP32-01/command `
  -m '{"tripId":"TRIP001","tripState":"IN_TRANSIT","profileId":"VEGETABLE_CHILLED","Tmin":3.0,"Tmax":8.0,"earlyWarningMinutes":10,"maxDoorOpenSeconds":30,"deliveryMode":false}'
```

## 9. Lệnh demo trong Serial Monitor

```text
WIFI_OFF
WIFI_ON
SENSOR_FAIL S2
SENSOR_RECOVER S2
```

- `WIFI_OFF`: ngắt Wi-Fi và lưu telemetry vào Ring Buffer RAM.
- `WIFI_ON`: kết nối lại và phát bù dữ liệu với `isBuffered: true`.
- `SENSOR_FAIL S2`: giả lập S2 lỗi; S2 gửi `FAULT` và giá trị null.
- `SENSOR_RECOVER S2`: khôi phục S2.

Để kiểm tra cảnh báo nhiệt độ, bấm từng DHT22 trong Wokwi và thay đổi nhiệt độ. Ví dụ đặt S4 lên 9°C khi Tmax là 8°C. Để kiểm tra cửa, giữ nút `Door` liên tục 5 giây để mở, **thả hẳn**, rồi giữ thêm 5 giây để đóng. Có thể dùng phím `D` khi sơ đồ Wokwi đang được chọn: giữ `D` 5 giây, thả, rồi giữ `D` 5 giây nữa. Serial Monitor sẽ in `PRESSED`, `Door changed: OPEN`, `RELEASED`, `PRESSED`, `Door changed: CLOSED`. Nếu không thấy `RELEASED`, kiểm tra nút Wokwi có đang bị giữ dính do Ctrl-click hay không. Bấm ngắn không đổi trạng thái, giữ lâu hơn 5 giây chỉ đổi một lần. Thời gian tính theo đồng hồ mô phỏng Wokwi.

## 10. Thứ tự chạy nhanh mỗi lần

1. SQL Server đang chạy.
2. Terminal 1: Mosquitto.
3. Terminal 2: Backend.
4. Terminal 3: Frontend.
5. Build firmware Wokwi nếu vừa sửa code.
6. Start Wokwi và mở TCP Serial Monitor.
7. Mở dashboard tại `http://localhost:5173`.

Nếu chỉ muốn chạy mô phỏng ESP32, chỉ cần Mosquitto (nếu muốn MQTT), PlatformIO/Wokwi và Serial Monitor. Backend/frontend không bắt buộc cho phần mô phỏng độc lập.

## 11. Thông báo Telegram

Backend gửi cảnh báo `TEMPERATURE_EXCURSION` và `EARLY_WARNING` sau khi lưu telemetry; gửi `DEVICE_OFFLINE`/`SENSOR_OFFLINE` khi timeout; và nhận `DOOR_BREACH`/`DOOR_OPEN_TOO_LONG` từ topic MQTT `/alert` của ESP32. Cấu hình trong `backend/.env`:

```env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=<token_botfather>
TELEGRAM_CHAT_ID=<chat_id>
```

Sau khi sửa `.env`, khởi động lại backend:

```powershell
cd backend
npm run dev
```

Cảnh báo nhiệt độ và offline trên cùng thiết bị/chuyến/cảm biến được giới hạn một tin nhắn trong 5 phút để tránh gửi lặp. Cảnh báo cửa được ESP32 phát khi trạng thái vi phạm mới xuất hiện nên mỗi sự cố cửa đều được gửi. Token chỉ đặt trong `backend/.env`; không commit file này lên Git.

## 12. Kiểm tra timeout thiết bị/cảm biến

Timeout mặc định là 30 giây, quét mỗi 15 giây. Để kiểm tra thiết bị:

1. Để Wokwi gửi telemetry bình thường và xác nhận backend đã lưu packet.
2. Gõ `WIFI_OFF` trong TCP Serial Monitor hoặc dừng mô phỏng.
3. Chờ khoảng 30–45 giây. Backend phải log `DEVICE_OFFLINE` và tạo alert cùng tên.

Để kiểm tra cảm biến, gõ `SENSOR_FAIL S2`. Vì S2 không còn trạng thái `ONLINE`, sau timeout backend tạo `SENSOR_OFFLINE`. Gõ `SENSOR_RECOVER S2` để khôi phục; lần đọc ONLINE tiếp theo sẽ xóa trạng thái timeout trong RAM và cập nhật `last_seen`.

Backend subscribe topic MQTT `coldchain/v1/devices/+/status`. Khi broker phát Last Will `OFFLINE` sau khi ESP32 mất kết nối, backend ghi `DEVICE_OFFLINE` ngay khi nhận được; thời gian thực tế phụ thuộc keepalive của broker. Dashboard làm mới trạng thái mỗi 5 giây qua `/api/devices` và `/api/sensors`, hiển thị `OFFLINE`/`N/A` thay cho nhiệt độ cũ. Nếu không có LWT, timeout telemetry 30 giây vẫn đánh dấu thiết bị offline. Khởi động lại backend để áp dụng thay đổi này.

## 13. Control Panel trên Dashboard

Dashboard có hai thao tác điều khiển:

- **Delivery Mode**: gửi `deliveryMode: true/false` qua `POST /api/control/delivery-mode`, đồng thời cập nhật `trips.delivery_mode`.
- **Quét QR giả lập / Bắt đầu chuyến**: nhập `Trip ID`, `Tmin`, `Tmax`, sau đó gửi `POST /api/control/start-trip`. Backend cập nhật chuyến sang `IN_TRANSIT` và publish lệnh MQTT cho ESP32.

MQTT phải kết nối trước khi bấm nút. Nếu chưa kết nối, dashboard sẽ hiển thị lỗi thay vì cập nhật trạng thái giả.
