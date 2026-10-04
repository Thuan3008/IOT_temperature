# ESP32 Store & Forward

Firmware đọc năm DHT22 theo chu kỳ 4 giây. Nếu Wi-Fi hoặc MQTT không sẵn sàng, JSON telemetry được đưa vào Ring Buffer trong RAM tối đa 30 phần tử (khoảng 2 phút), ESP32 vẫn tiếp tục đọc cảm biến, kiểm tra cửa và phát cảnh báo cục bộ. Khi đầy, phần tử cũ nhất bị thay thế. Queue không bền vững qua reset/mất điện.

Khi MQTT kết nối lại, các gói đang chờ được phát lại theo thứ tự và đánh dấu `isBuffered: true`; sau khi phát hết queue mới gửi mẫu trực tiếp. Firmware dùng PubSubClient với QoS 0. `publish()` trả về true chỉ xác nhận việc publish được thư viện chấp nhận, không phải PUBACK hay xác nhận backend đã lưu. Không có bảo đảm giao hàng tuyệt đối.

Để demo mất mạng, nhập `WIFI_OFF` trong Serial Monitor. Lệnh tắt tự kết nối Wi-Fi trong firmware, không cần ngắt kết nối Internet của máy. Nhập `WIFI_ON` để cho phép kết nối lại. Serial Monitor hiển thị kích thước queue.

Thời gian được đồng bộ UTC qua NTP khi có Wi-Fi. Khi chưa đồng bộ, telemetry dùng thời gian sentinel `1970-01-01T00:00:00Z` cùng `timeSynchronized:false`; dữ liệu đó không phải giờ đo đáng tin cậy. Khi NTP đồng bộ thành công, firmware đặt `timeSynchronized:true`.

Wokwi VS Code có thể kết nối broker host qua Private IoT Gateway. Wokwi build mặc định dùng `Wokwi-GUEST` và `host.wokwi.internal:1883`; phải bật gateway và đảm bảo broker đang lắng nghe trên host. Khả năng truy cập phụ thuộc môi trường Wokwi và cấu hình broker, nên cần xác minh bằng log Serial Monitor và một subscriber MQTT.
