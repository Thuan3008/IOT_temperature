# Smart Cold Chain IoT

Hệ thống giám sát và cảnh báo sớm điều kiện vận chuyển hàng hóa chuỗi lạnh.

**Hướng dẫn chạy đầy đủ:** [docs/run-project.md](docs/run-project.md)

## Công nghệ

Node.js/Express, React/Vite dashboard, Microsoft SQL Server, `mssql`, Mosquitto MQTT, ESP32/Wokwi và 5 DHT22.

## Chạy nhanh bằng PowerShell

Từ thư mục gốc repository:

```powershell
npm install --prefix backend
npm run dev
```

Backend đọc `backend/.env`. Tạo bản sao từ `backend/.env.example` và điền thông tin SQL Server/MQTT; không commit `.env` hoặc `mqtt/passwd`.

Trong PowerShell thứ hai, chạy giao diện:

```powershell
npm install --prefix frontend
npm run dev --prefix frontend
```

Mở URL Vite hiển thị trong terminal (thường là `http://localhost:5173`). Dashboard tự làm mới mỗi 5 giây.

```powershell
sqlcmd -S localhost -E -i database/schema.sql
sqlcmd -S localhost -E -i database/seed.sql
```

Nếu dùng SQL login, thay `-E` bằng `-U <user> -P <password>`. Kiểm tra `http://localhost:3000/` và `http://localhost:3000/api/health`.

## Mosquitto

`mqtt/mosquitto.conf` chỉ bind localhost, yêu cầu password và ACL. Tạo password file cục bộ (không commit):

```powershell
mosquitto_passwd -c mqtt/passwd backend
mosquitto_passwd mqtt/passwd esp32
mosquitto_passwd mqtt/passwd tester
mosquitto -c mqtt/mosquitto.conf -v
```

Publish payload mẫu trong cửa sổ PowerShell khác:

```powershell
mosquitto_pub -h 127.0.0.1 -p 1883 -u tester -P '<password>' -t coldchain/v1/devices/ESP32-01/telemetry -f mqtt/test-telemetry.json
```

Firmware mô phỏng đọc năm DHT22, đồng bộ UTC qua NTP, giám sát cửa, giả lập GPS TP.HCM và phát cảnh báo cục bộ. Khi Wi-Fi/MQTT mất, telemetry được xếp trong Ring Buffer RAM 30 gói; khi đầy, gói cũ nhất bị thay thế. Firmware dùng PubSubClient QoS 0, vì vậy trạng thái publish thành công không xác nhận broker/backend đã nhận. Queue mất sau reset/mất điện. Cấu hình MQTT đặt trong `esp32/secrets.h` (tạo từ `secrets.example.h`, file thật bị Git bỏ qua).

Với Wokwi trong VS Code, môi trường `wokwi` dùng `Wokwi-GUEST` và mặc định thử broker `host.wokwi.internal:1883` qua Private IoT Gateway. Bật lệnh `Wokwi: Enable Private Wokwi IoT Gateway` từ Command Palette và điền thông tin MQTT user `esp32`. Host/port chỉ hợp lệ nếu gateway và broker trên máy bạn được cấu hình để truy cập; hướng dẫn và cách kiểm tra tại [docs/wokwi-demo.md](docs/wokwi-demo.md). Store & Forward xem [docs/store-and-forward.md](docs/store-and-forward.md).

### Chạy mô phỏng Wokwi trong VS Code

Mở riêng thư mục `esp32` làm workspace (`File > Open Folder`), cài extension PlatformIO, chạy `pio run -e wokwi` để tạo firmware mô phỏng, rồi mở `diagram.json` và bấm Play. `wokwi.toml` trỏ tới firmware trong `.pio/build/wokwi/`.

## API

- `GET /`
- `GET /api/health`
- `GET /api/telemetry`
- `GET /api/telemetry/:tripId`
- `GET /api/sensors`
- `GET /api/trips/:tripId`
- `GET /api/alerts` (lọc tùy chọn: `?tripId=TRIP001`)

## MQTT và dữ liệu

Topic/command contract xem [docs/mqtt-topics.md](docs/mqtt-topics.md); toàn bộ mạch, lệnh kiểm thử và demo xem [docs/wokwi-demo.md](docs/wokwi-demo.md). Backend đã lưu `TEMPERATURE_EXCURSION` và `EARLY_WARNING`; cảnh báo sớm dùng hồi quy tuyến tính theo từng cảm biến. Firmware publish local alert, status/LWT, nhận command, theo dõi cửa và có LED/buzzer. Backend có thể gửi các cảnh báo đã lưu sang Telegram khi bật `TELEGRAM_ENABLED`.

## How to run

1. Khởi động và khởi tạo SQL Server
   Mở SQL Server/SSMS, rồi chạy từ thư mục gốc project:
   sqlcmd -S localhost -E -i database\schema.sql
   sqlcmd -S localhost -E -i database\seed.sql
   -E dùng đăng nhập Windows để chạy script. Backend lại dùng SQL login, nên tạo hoặc chọn một SQL login có quyền trên ColdChainDB, rồi điền tài khoản đó ở bước 3.
2. Tạo tài khoản và chạy Mosquitto
   Trong Terminal 1:
   cd E:\HK7\IOT\DACK_V1\IOT_temperature\mqtt
   mosquitto_passwd -c passwd backend
   mosquitto_passwd passwd esp32
   mosquitto_passwd passwd tester
   mosquitto -c mosquitto.conf -v
   Các lệnh đầu sẽ hỏi mật khẩu cho từng tài khoản. Ghi nhớ chúng để cấu hình backend và ESP32.
   File [mosquitto.conf](E:/HK7/IOT/DACK_V1/IOT_temperature/mqtt/mosquitto.conf) có thêm listener ở cổng 1884 gắn với một địa chỉ IP cố định. Wokwi chỉ cần cổng 1883; nếu Mosquitto báo không gắn được địa chỉ ở cổng 1884, hãy tạm comment dòng listener đó.
3. Cấu hình và chạy backend
   Từ thư mục gốc, tạo .env nếu chưa có:
   Copy-Item backend\.env.example backend\.env
   notepad backend\.env
   Điền SQL login hợp lệ và mật khẩu Mosquitto của tài khoản backend. Với Mosquitto chạy cục bộ, MQTT host mặc định mqtt://127.0.0.1:1883 có thể giữ nguyên.
   Trong Terminal 2:
   cd E:\HK7\IOT\DACK_V1\IOT_temperature
   npm install --prefix backend
   npm run dev
   Kiểm tra http://localhost:3000/api/health. Kết quả cần báo database đã kết nối. Xem log Terminal 2 để xác nhận backend kết nối MQTT.
4. Chạy dashboard
   Trong Terminal 3:
   cd E:\HK7\IOT\DACK_V1\IOT_temperature
   npm install --prefix frontend
   npm run dev --prefix frontend
   Mở địa chỉ Vite hiện trong terminal, thường là http://localhost:5173.
5. Chạy ESP32 trong Wokwi
   Mở thư mục E:\HK7\IOT\DACK_V1\IOT_temperature\esp32 trong VS Code. Đảm bảo đã cài PlatformIO và Wokwi extension.
   Kiểm tra esp32\secrets.h có tài khoản MQTT esp32. Đừng ghi đè file này nếu bạn đã có cấu hình riêng. Sau đó chạy trong terminal ở thư mục esp32:
   pio run -e wokwi
   Bật lệnh Wokwi: Enable Private Wokwi IoT Gateway từ Command Palette. Chạy diagram.json trong Wokwi và mở Serial Monitor ở 115200 baud. Với build Wokwi đúng, log phải hiện Wi‑Fi Wokwi-GUEST. Nếu vẫn hiện tên Wi‑Fi nhà/trường như log trước, có thể bạn đang chạy firmware build bằng môi trường esp32dev; hãy build và chọn firmware từ môi trường wokwi.
6. Kiểm tra luồng dữ liệu
   Khi cảm biến đọc thành công và MQTT đã kết nối:

- Serial Monitor hiện các cảm biến ONLINE.
- LED xanh sáng khi MQTT kết nối.
- Telemetry bắt đầu xuất hiện trên dashboard sau bản tin đầu tiên.
- Lệnh demo cửa/lỗi cảm biến/mất Wi‑Fi xem tại [wokwi-demo.md](E:/HK7/IOT/DACK_V1/IOT_temperature/docs/wokwi-demo.md).
  Để xem MQTT trực tiếp, mở thêm terminal và subscribe:
  mosquitto_sub -h 127.0.0.1 -p 1883 -u tester -P "<mật-khẩu-tester>" -t "coldchain/v1/devices/ESP32-01/#" -v
  Để gửi cấu hình từ MQTT, dùng mosquitto_pub lên topic coldchain/v1/devices/ESP32-01/command; ví dụ JSON có sẵn trong hướng dẫn demo. Dashboard hiện chủ yếu hiển thị dữ liệu, chưa có giao diện gửi command.
& "C:\Users\thuan\.platformio\penv\Scripts\platformio.exe" run -e wokwi

