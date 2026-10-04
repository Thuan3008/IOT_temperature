# Bản đồ hành trình React + Vite

## Cài đặt và chạy

Đã cài vào frontend và cập nhật package-lock.json:

```powershell
cd E:\HK7\IOT\DACK_V1\IOT_temperature\frontend
npm install leaflet react-leaflet
npm install -D @types/leaflet
npm run dev
```

`@types/leaflet` hữu ích cho TypeScript/editor, không bắt buộc cho JSX.
React Leaflet 5 cần React 19 (project đang dùng React 19).

## Component và CSS

`frontend/src/components/TripMap.jsx` nhận ba props:

```jsx
import TripMap from "./components/TripMap";

<TripMap
  currentLocation={{ latitude: 10.762622, longitude: 106.660172 }}
  routeHistory={[
    { latitude: 10.762622, longitude: 106.660172, timestamp: "2026-09-30T08:00:00Z" },
    { latitude: 10.767100, longitude: 106.664300, timestamp: "2026-09-30T08:00:10Z" },
  ]}
  tripInfo={{ tripId: "TRIP001", vehiclePlate: "59C-12345", currentTemp: 5.2, doorStatus: "CLOSED" }}
/>
```

CSS của Leaflet được import trực tiếp trong component, trước CSS tùy chỉnh:

```js
import "leaflet/dist/leaflet.css";
import "./TripMap.css";
```

Chiều cao bản đồ 450px, trên điện thoại 400px. Chỉ đổi `center` của MapContainer
không cập nhật được tâm sau mount; component con `FollowTruck` dùng `useMap`
và `panTo` khi tọa độ thay đổi. ResizeObserver gọi invalidateSize khi khung thay đổi.

Icon mặc định dùng ảnh import từ package Leaflet qua Vite và được gán bằng
`L.icon` mới, không dùng imagePath tự phát hiện của `L.Icon.Default`.
Icon xe tải dùng SVG nội tuyến trong `L.divIcon`, không cần tải ảnh ngoài.

## Dữ liệu thật trên Dashboard

`frontend/src/main.jsx` nhận telemetry API mỗi 5 giây. Packet được gộp từ các dòng
sensor, rồi lọc theo cả trip_id và device_id. `routeHistory` sắp theo measured_at
(không dùng received_at vì gói buffered có thể gửi bù). Điểm mới nhất có GPS hợp lệ
là currentLocation. API GET /api/trips/:tripId bổ sung vehicle_plate từ bảng vehicles.
Popup hiển thị nhiệt độ cao nhất của packet hiện tại.

Chưa có GPS: hiển thị trung tâm TP.HCM [10.762622, 106.660172] và thông báo chờ GPS.
Không đặt marker xe tại tọa độ fallback. Dữ liệu GPS sai/null bị loại bỏ.
Lịch sử trên bản đồ hiện giới hạn theo response API telemetry (TOP 1000 dòng sensor,
khoảng 200 packet nếu mỗi packet có 5 sensor), chưa phải toàn bộ chuyến dài.
Firmware Wokwi hiện gửi tọa độ mô phỏng; bản đồ hiển thị đúng nguồn đó.

## Ví dụ dùng state và telemetry giả lập

`frontend/src/components/TripMapDemo.jsx` là ví dụ chạy độc lập bằng state
currentLocation/routeHistory và timer 5 giây. Để xem ví dụ, import và render:

```jsx
import TripMapDemo from "./components/TripMapDemo";

<TripMapDemo />
```

Thay `receiveTelemetry` bằng callback API/WebSocket/MQTT khi dùng dữ liệu thật.
Dashboard chính đã nối API nên không cần bật demo.

## OpenStreetMap

TileLayer dùng HTTPS, không cần API key, có attribution OpenStreetMap luôn hiển thị.
Nguồn tile công cộng dành cho xem tương tác, không tải hàng loạt/offline và không
có cam kết phục vụ không giới hạn. Xem chính sách:
https://operations.osmfoundation.org/policies/tiles/

Tài liệu thư viện: https://react-leaflet.js.org/docs/start-installation/
