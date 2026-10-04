import { useEffect, useState } from "react";
import TripMap from "./TripMap";

const DEMO_ROUTE = [
  { latitude: 10.762622, longitude: 106.660172 },
  { latitude: 10.767100, longitude: 106.664300 },
  { latitude: 10.773800, longitude: 106.671400 },
  { latitude: 10.781200, longitude: 106.678500 },
  { latitude: 10.789000, longitude: 106.685800 },
];

// Ví dụ độc lập: thay timer bằng callback WebSocket/MQTT hoặc response từ API.
// Không nhúng vào dashboard thật để tránh trộn GPS giả với dữ liệu telemetry.
export default function TripMapDemo() {
  const [currentLocation, setCurrentLocation] = useState(null);
  const [routeHistory, setRouteHistory] = useState([]);

  useEffect(() => {
    let index = 0;
    function receiveTelemetry() {
      const startsNewRoute = index === 0;
      const point = { ...DEMO_ROUTE[index], timestamp: new Date().toISOString() };
      setCurrentLocation(point);
      setRouteHistory((history) => startsNewRoute ? [point] : [...history, point]);
      index = (index + 1) % DEMO_ROUTE.length;
    }
    // Nhận điểm đầu ngay, sau đó giả lập telemetry mỗi 5 giây.
    receiveTelemetry();
    const timer = window.setInterval(receiveTelemetry, 5000);
    return () => window.clearInterval(timer);
  }, []);

  return <section className="panel trip-map-panel">
    <div className="panel-heading"><h3>Hành trình giả lập</h3></div>
    <TripMap currentLocation={currentLocation} routeHistory={routeHistory}
      tripInfo={{ tripId: "TRIP001", vehiclePlate: "59C-12345", currentTemp: 5.2, doorStatus: "CLOSED" }} />
  </section>;
}
