#include <ArduinoJson.h>
#include <DHT.h>

const char* DEVICE_ID = "ESP32-01";
const char* TRIP_ID = "TRIP001";
const uint8_t PINS[] = {15, 16, 17, 18, 19};
DHT sensors[] = { DHT(15, DHT22), DHT(16, DHT22), DHT(17, DHT22), DHT(18, DHT22), DHT(19, DHT22) };

void setup() {
  Serial.begin(115200);
  for (auto &sensor : sensors) sensor.begin();
}

void loop() {
  StaticJsonDocument<2048> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["tripId"] = TRIP_ID;
  JsonArray readings = doc.createNestedArray("sensors");
  for (uint8_t i = 0; i < 5; i++) {
    float temperature = sensors[i].readTemperature();
    float humidity = sensors[i].readHumidity();
    JsonObject item = readings.createNestedObject();
    item["sensorId"] = String("S") + (i + 1);
    if (isnan(temperature) || isnan(humidity)) {
      item["temperature"] = nullptr;
      item["humidity"] = nullptr;
      item["status"] = "FAULT";
    } else {
      item["temperature"] = temperature;
      item["humidity"] = humidity;
      item["status"] = "ONLINE";
    }
  }
  doc["door"] = "CLOSED";
  doc["latitude"] = 10.762622;
  doc["longitude"] = 106.660172;
  doc["timestamp"] = "2026-09-10T10:30:00+07:00";
  doc["isBuffered"] = false;
  doc["type"] = "TELEMETRY";
  serializeJson(doc, Serial);
  Serial.println();
  delay(5000);
}
