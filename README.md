# Smart Cold Chain IoT

Hệ thống giám sát và cảnh báo sớm điều kiện vận chuyển hàng hóa chuỗi lạnh.

## Công nghệ

Node.js/Express, React/Vite (frontend đang là khung trống), Microsoft SQL Server, `mssql`, Mosquitto MQTT, ESP32/Wokwi và 5 DHT22.

## Chạy nhanh bằng PowerShell

Từ thư mục gốc repository:

```powershell
npm install --prefix backend
npm run dev
```

Backend đọc `backend/.env`. Tạo bản sao từ `backend/.env.example` và điền thông tin SQL Server/MQTT; không commit `.env` hoặc `mqtt/passwd`.

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

Wokwi không dùng `127.0.0.1` để truy cập broker trên máy Windows nếu không có endpoint mạng phù hợp. `esp32/sketch.ino` hiện ưu tiên đọc và in JSON năm cảm biến qua Serial; MQTT/Wi-Fi và ring buffer là phần tiếp theo.

## API

- `GET /`
- `GET /api/health`
- `GET /api/telemetry`
- `GET /api/telemetry/:tripId`
- `GET /api/sensors`

## MQTT và dữ liệu

Topic và contract xem [docs/mqtt-topics.md](docs/mqtt-topics.md). Schema/seed xem [docs/database.md](docs/database.md). Các chức năng cảnh báo nâng cao, Last Will, regression, Telegram/Buzzer/LED và frontend chưa hoàn thiện trong prototype tuần 1.
