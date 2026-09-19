# Smart Cold Chain IoT

Hệ thống giám sát và cảnh báo sớm điều kiện vận chuyển hàng hóa chuỗi lạnh.

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

Wokwi không dùng `127.0.0.1` để truy cập broker trên máy Windows. Firmware ESP32 đọc năm DHT22, lấy thời gian UTC/NTP, gửi MQTT QoS 1 và lưu FIFO từng payload xuống LittleFS khi Wi-Fi/MQTT mất; khi gửi lại giữ nguyên `messageId`, đặt `isBuffered: true` và chỉ xóa bản ghi sau PUBACK. Queue giới hạn 512 bản tin; khi đầy, firmware báo rõ và không ghi đè bản tin cũ. Cấu hình Wi-Fi/MQTT đặt trong `esp32/secrets.h` (tạo từ `secrets.example.h`, file thật bị Git bỏ qua). Broker cho thiết bị thật phải ở địa chỉ LAN riêng; không mở cổng ra Internet.

Với Wokwi trong VS Code, dùng PlatformIO environment `wokwi`: firmware dùng `Wokwi-GUEST`, broker `host.wokwi.internal:1883` qua Private IoT Gateway tích hợp; không cần board thật, Wi‑Fi nhà bạn hay mở listener LAN. Bật lệnh `Wokwi: Enable Private Wokwi IoT Gateway` từ Command Palette nếu gateway chưa hoạt động. Điền đúng mật khẩu MQTT của user `esp32` trong file local `esp32/secrets.h`. Trên board vật lý thì cần Wi‑Fi thật và broker LAN; hướng dẫn Store & Forward ở [docs/store-and-forward.md](docs/store-and-forward.md).

### Chạy mô phỏng Wokwi trong VS Code

Mở riêng thư mục `esp32` làm workspace (`File > Open Folder`), cài extension PlatformIO, chạy `platformio.exe run --environment wokwi` để tạo firmware mô phỏng, rồi mở `diagram.json` và bấm Play. `wokwi.toml` trỏ tới firmware trong `.pio/build/wokwi/`. Trong Wokwi, LittleFS chỉ tự format khi filesystem mô phỏng trắng/lỗi lần đầu; firmware board thật thì không tự format.

## API

- `GET /`
- `GET /api/health`
- `GET /api/telemetry`
- `GET /api/telemetry/:tripId`
- `GET /api/sensors`
- `GET /api/trips/:tripId`
- `GET /api/alerts` (lọc tùy chọn: `?tripId=TRIP001`)

## MQTT và dữ liệu

Topic và contract xem [docs/mqtt-topics.md](docs/mqtt-topics.md). Schema/seed xem [docs/database.md](docs/database.md). Dashboard hiển thị chuyến, ngưỡng bảo quản, 5 cảm biến, biểu đồ xu hướng và telemetry gần đây. Backend đã lưu `TEMPERATURE_EXCURSION` và `EARLY_WARNING` cùng transaction telemetry; cảnh báo sớm dùng hồi quy tuyến tính đơn giản trên tối đa 5 điểm trước đó và chỉ đánh giá khi có ít nhất 3 điểm gồm mẫu hiện tại. ESP32 Store & Forward đã có firmware và build thành công; cần chạy env `wokwi` và xác nhận gateway/MQTT/queue trong mô phỏng. Chưa có xử lý chuyển trạng thái/đóng alert, MQTT alert publish, Last Will, Telegram/Buzzer/LED.
