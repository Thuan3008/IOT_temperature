# Control Panel phục vụ demo

Khởi động SQL Server, Mosquitto, backend (`npm run dev` trong backend), frontend
(`npm run dev` trong frontend) và Wokwi. Sau khi sửa code backend cần restart.

## Kịch bản 2: khởi tạo cấu hình chuyến

1. Trên Dashboard, mở Control Panel và bấm **Khởi tạo chuyến**.
2. Dùng chuyến đã có trong database, ví dụ `TRIP001` gắn với `ESP32-01`.
3. Chọn/nhập mã lô hàng `LOT-VEG-001`. Danh sách gợi ý lấy từ database.
4. Chọn Storage Profile `VEGETABLE_CHILLED`. Modal hiển thị ngưỡng mặc định
   từ bảng `storage_profiles`, đồng thời điền hai input Tmin/Tmax.
5. Chỉnh tay ngưỡng nếu cần, ví dụ Tmin 3°C, Tmax 8°C. Bấm **Bắt đầu chuyến**.
6. Serial ESP32 cần có `MQTT command received` và `Config applied` với đúng
   trip, profile, Tmin/Tmax, `state=IN_TRANSIT`, `deliveryMode=OFF`.

Backend cập nhật ngưỡng thực tế trên bảng `trips` và liên kết lô hàng trên
`trip_lots` trong cùng transaction. Ngưỡng mặc định của profile được giữ nguyên.
Modal demo dùng một lô hàng và thay liên kết lô cũ của chuyến đã chọn. Lô hàng,
profile và chuyến phải tồn tại trong database; modal không tự tạo hàng hóa mới.

## Kịch bản 3: giao hàng hợp lệ

1. Bảo đảm cảm biến ONLINE, nhiệt độ trong ngưỡng, cửa đang đóng.
2. Bấm **Bắt đầu giao hàng**, xác nhận ESP32 log `deliveryMode=ON`.
3. Giữ nút Door 5 giây trong Wokwi để mở, sau đó thả nút. Không phát sinh `DOOR_BREACH`.
4. Giữ nút Door thêm 5 giây để đóng cửa rồi bấm **Kết thúc giao hàng**, xác nhận `deliveryMode=OFF`.

Cảnh báo nhiệt độ và `DOOR_OPEN_TOO_LONG` vẫn hoạt động khi giao hàng. Vì thế
cần mở cửa dưới 30 giây và để nhiệt độ trong ngưỡng khi demo không kêu. Để xem
cảnh báo mở cửa quá lâu, giữ nút Door 5 giây để mở rồi **thả nút**, chờ thêm
30 giây mà không đóng cửa. ESP32 phát `DOOR_OPEN_TOO_LONG`; backend lưu cảnh báo
và gửi Telegram khi đang kết nối MQTT.

## Kịch bản 4: mở cửa trái phép

1. Chuyến ở `IN_TRANSIT`, Delivery Mode OFF.
2. Giữ nút Door 5 giây để mở. ESP32 kích hoạt `DOOR_BREACH`, LED/còi theo firmware.
3. Đóng cửa để khôi phục.

## API

- `GET /api/control/options`: danh sách lô hàng và storage profile.
- `POST /api/control/start-trip`: `{ deviceId, tripId, lotId, profileId,
  minTemperature, maxTemperature, deliveryMode: false }`.
- `POST /api/control/delivery-mode`: `{ deviceId, tripId, deliveryMode: true/false }`.

Backend gửi command đến `coldchain/v1/devices/{deviceId}/command`. API thành công
nghĩa là cấu hình đã lưu và thư viện MQTT đã nhận publish; hiện chưa có ACK từ ESP32.
Luôn dùng log `Config applied` để xác nhận thiết bị đã áp dụng cấu hình.
Nếu MQTT lỗi sau khi database đã commit, API trả thông báo đã lưu nhưng chưa gửi;
kết nối lại broker và thực hiện lại thao tác.
