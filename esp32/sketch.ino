#include <ArduinoJson.h>
#include <DHTesp.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <time.h>
#include <sys/time.h>
#include <esp_system.h>

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Copy secrets.example.h to secrets.h and configure the MQTT credentials."
#endif

#ifndef DEVICE_ID
#define DEVICE_ID "ESP32-01"
#endif
#ifndef TRIP_ID
#define TRIP_ID "TRIP001"
#endif

#ifdef WOKWI_SIMULATION
// A local secrets.h may contain the real Wi-Fi credentials. Never use them in
// the simulator: Wokwi's virtual access point is always Wokwi-GUEST, channel 6.
#ifndef WOKWI_MQTT_BROKER_HOST
#define WOKWI_MQTT_BROKER_HOST "host.wokwi.internal"
#endif
#ifndef WOKWI_MQTT_BROKER_PORT
#define WOKWI_MQTT_BROKER_PORT 1883
#endif
#undef WIFI_SSID
#undef WIFI_PASSWORD
#undef MQTT_BROKER_HOST
#undef MQTT_BROKER_PORT
#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""
#define MQTT_BROKER_HOST WOKWI_MQTT_BROKER_HOST
#define MQTT_BROKER_PORT WOKWI_MQTT_BROKER_PORT
#endif

// GPIO map must stay in sync with diagram.json.
constexpr uint8_t SENSOR_PINS[] = {13, 14, 25, 26, 27};
constexpr uint8_t DOOR_PIN = 32;
constexpr uint8_t RED_LED_PIN = 18;
constexpr uint8_t BUZZER_PIN = 19;
constexpr uint8_t GREEN_LED_PIN = 23;
constexpr size_t SENSOR_COUNT = 5;
constexpr size_t RING_CAPACITY = 30;
constexpr size_t MAX_PAYLOAD_BYTES = 1200;
constexpr uint32_t SAMPLE_INTERVAL_MS = 10000;
constexpr uint32_t DEBOUNCE_MS = 45;
constexpr uint32_t DOOR_HOLD_MS = 5000;
constexpr uint32_t WIFI_RETRY_MS = 10000;
constexpr uint32_t MQTT_RETRY_MS = 5000;
constexpr uint32_t GPS_STEP_MS = 30000;
constexpr uint32_t ALERT_BLINK_MS = 350;

const char* const DEVICE_ID_VALUE = DEVICE_ID;
const char* const TRIP_ID_VALUE = TRIP_ID;
char telemetryTopic[100];
char alertTopic[100];
char statusTopic[100];
char commandTopic[100];
char lwtPayload[128];

DHTesp dht[SENSOR_COUNT];
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

struct SensorReading {
  float temperature = NAN;
  float humidity = NAN;
  bool online = false;
};

struct QueuedPacket {
  char payload[MAX_PAYLOAD_BYTES];
  bool used = false;
};

QueuedPacket ringBuffer[RING_CAPACITY];
size_t ringHead = 0;
size_t ringCount = 0;
SensorReading readings[SENSOR_COUNT];
bool sensorForcedFault[SENSOR_COUNT] = {};
bool tempAlertActive[SENSOR_COUNT] = {};
bool doorBreachActive = false;
bool doorTooLongActive = false;
bool doorOpen = false;
bool deliveryMode = false;
bool wifiSuppressed = false;
bool lastWifiConnected = false;
bool clockSynchronized = false;
bool redLedOn = false;
bool doorPressActive = false;
bool doorHoldHandled = false;
uint32_t doorPressedAtMs = 0;
uint32_t doorOpenedAtMs = 0;
uint32_t lastSampleMs = 0;
uint32_t lastGpsStepMs = 0;
uint32_t lastWifiAttemptMs = 0;
uint32_t lastMqttAttemptMs = 0;
uint32_t lastAlertBlinkMs = 0;
uint32_t messageSequence = 0;
uint32_t simulatedSensorReadCount[SENSOR_COUNT] = {};
uint32_t maxDoorOpenSeconds = 30;
uint16_t earlyWarningMinutes = 10;
float minTemperature = 3.0f;
float maxTemperature = 8.0f;
char tripId[32] = "TRIP001";
char profileId[48] = "VEGETABLE_CHILLED";
char tripState[20] = "IN_TRANSIT";

// Approximate route within Ho Chi Minh City. These are simulated coordinates.
struct Coordinate { double latitude; double longitude; };
const Coordinate ROUTE[] = {
  {10.762622, 106.660172}, {10.767100, 106.664300},
  {10.772500, 106.669100}, {10.778000, 106.674500},
  {10.783400, 106.680000}, {10.789000, 106.685800}
};
constexpr size_t ROUTE_COUNT = sizeof(ROUTE) / sizeof(ROUTE[0]);
size_t routeIndex = 0;

size_t ringTail() { return (ringHead + ringCount) % RING_CAPACITY; }

size_t bufferedCount() { return ringCount; }

void makeTopics() {
  snprintf(telemetryTopic, sizeof(telemetryTopic), "coldchain/v1/devices/%s/telemetry", DEVICE_ID_VALUE);
  snprintf(alertTopic, sizeof(alertTopic), "coldchain/v1/devices/%s/alert", DEVICE_ID_VALUE);
  snprintf(statusTopic, sizeof(statusTopic), "coldchain/v1/devices/%s/status", DEVICE_ID_VALUE);
  snprintf(commandTopic, sizeof(commandTopic), "coldchain/v1/devices/%s/command", DEVICE_ID_VALUE);
  snprintf(lwtPayload, sizeof(lwtPayload), "{\"deviceId\":\"%s\",\"status\":\"OFFLINE\"}", DEVICE_ID_VALUE);
}

void printBufferCount() {
  Serial.printf("Ring Buffer: %u/%u packet(s)\n", static_cast<unsigned>(ringCount), static_cast<unsigned>(RING_CAPACITY));
}

bool storeToRingBuffer(const char* payload) {
  if (!payload) return false;
  const size_t length = strlen(payload);
  if (length >= MAX_PAYLOAD_BYTES) {
    Serial.println("ERROR: telemetry exceeds RAM ring slot; packet dropped.");
    return false;
  }
  size_t index;
  if (ringCount == RING_CAPACITY) {
    index = ringHead;
    ringHead = (ringHead + 1) % RING_CAPACITY;
    Serial.println("Ring Buffer full: overwriting oldest telemetry packet.");
  } else {
    index = ringTail();
    ++ringCount;
  }
  strlcpy(ringBuffer[index].payload, payload, sizeof(ringBuffer[index].payload));
  ringBuffer[index].used = true;
  printBufferCount();
  return true;
}

bool flushRingBuffer();
bool publishAlert(const char* type, bool active, int sensorIndex = -1, float temperature = NAN, float threshold = NAN);
void checkLocalAlerts();

String currentTimestamp() {
  time_t now = time(nullptr);
  if (!clockSynchronized || now < 1700000000) return String("1970-01-01T00:00:00Z");
  struct tm utc;
  gmtime_r(&now, &utc);
  char out[25];
  strftime(out, sizeof(out), "%Y-%m-%dT%H:%M:%SZ", &utc);
  return String(out);
}

void updateClockStatus() {
  const time_t now = time(nullptr);
  if (now > 1700000000 && !clockSynchronized) {
    clockSynchronized = true;
    Serial.println("System clock synchronized by NTP.");
  }
}

void beginWiFiConnection();

void setupWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  beginWiFiConnection();
  lastWifiAttemptMs = millis();
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.printf("Wi-Fi connecting to %s...\n", WIFI_SSID);
}

void beginWiFiConnection() {
#ifdef WOKWI_SIMULATION
  // Wokwi's virtual Wokwi-GUEST access point is on channel 6.
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 6);
#else
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
#endif
}

void publishStatus(const char* status) {
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID_VALUE;
  doc["status"] = status;
  doc["timestamp"] = currentTimestamp();
  char payload[180];
  const size_t written = serializeJson(doc, payload, sizeof(payload));
  if (written > 0) mqtt.publish(statusTopic, payload, true);
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, commandTopic) != 0) return;
  Serial.printf("MQTT command received (%u bytes).\n", length);
  // PubSubClient payload is not guaranteed to be null terminated.
  char command[768];
  if (length == 0 || length >= sizeof(command)) {
    Serial.println("Command rejected: invalid payload size.");
    return;
  }
  memcpy(command, payload, length);
  command[length] = '\0';
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, command);
  if (error) {
    Serial.printf("Command rejected: JSON error: %s\n", error.c_str());
    return;
  }
  // Apply atomically after validating all supplied values.
  if (doc["tripId"].is<const char*>()) {
    const char* value = doc["tripId"];
    if (strlen(value) == 0 || strlen(value) >= sizeof(tripId)) { Serial.println("Command rejected: invalid tripId."); return; }
  }
  if (doc["tripState"].is<const char*>()) {
    const char* value = doc["tripState"];
    if (strcmp(value, "IN_TRANSIT") && strcmp(value, "IDLE") && strcmp(value, "COMPLETED") && strcmp(value, "READY")) { Serial.println("Command rejected: invalid tripState."); return; }
  }
  if (doc["profileId"].is<const char*>()) {
    const char* value = doc["profileId"];
    if (strlen(value) == 0 || strlen(value) >= sizeof(profileId)) { Serial.println("Command rejected: invalid profileId."); return; }
  }
  float newMin = minTemperature, newMax = maxTemperature;
  if (doc["Tmin"].is<float>() || doc["Tmin"].is<int>()) newMin = doc["Tmin"].as<float>();
  if (doc["Tmax"].is<float>() || doc["Tmax"].is<int>()) newMax = doc["Tmax"].as<float>();
  if (!isfinite(newMin) || !isfinite(newMax) || newMin >= newMax || newMin < -40 || newMax > 80) { Serial.println("Command rejected: invalid Tmin/Tmax."); return; }
  uint32_t newDoorLimit = maxDoorOpenSeconds;
  if (doc["maxDoorOpenSeconds"].is<uint32_t>()) newDoorLimit = doc["maxDoorOpenSeconds"].as<uint32_t>();
  if (newDoorLimit < 1 || newDoorLimit > 86400) { Serial.println("Command rejected: maxDoorOpenSeconds out of range."); return; }
  uint16_t newEarlyWarning = earlyWarningMinutes;
  if (doc["earlyWarningMinutes"].is<uint16_t>()) newEarlyWarning = doc["earlyWarningMinutes"].as<uint16_t>();
  if (newEarlyWarning > 1440) { Serial.println("Command rejected: earlyWarningMinutes out of range."); return; }
  if (doc["deliveryMode"].is<bool>() == false && !doc["deliveryMode"].isUnbound()) { Serial.println("Command rejected: deliveryMode must be boolean."); return; }

  minTemperature = newMin;
  maxTemperature = newMax;
  maxDoorOpenSeconds = newDoorLimit;
  earlyWarningMinutes = newEarlyWarning;
  if (doc["deliveryMode"].is<bool>()) deliveryMode = doc["deliveryMode"].as<bool>();
  if (doc["tripId"].is<const char*>()) strlcpy(tripId, doc["tripId"], sizeof(tripId));
  if (doc["tripState"].is<const char*>()) strlcpy(tripState, doc["tripState"], sizeof(tripState));
  if (doc["profileId"].is<const char*>()) strlcpy(profileId, doc["profileId"], sizeof(profileId));
  Serial.printf("Config applied: trip=%s state=%s profile=%s Tmin=%.1f Tmax=%.1f deliveryMode=%s maxDoor=%lus\n",
    tripId, tripState, profileId, minTemperature, maxTemperature, deliveryMode ? "ON" : "OFF", static_cast<unsigned long>(maxDoorOpenSeconds));
  checkLocalAlerts();
}

bool reconnectMQTT() {
  if (!WiFi.isConnected() || mqtt.connected()) return mqtt.connected();
  char clientId[64];
  snprintf(clientId, sizeof(clientId), "%s-%04X", DEVICE_ID_VALUE, static_cast<unsigned>(esp_random() & 0xFFFF));
  Serial.printf("Connecting MQTT %s:%u...\n", MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  bool connected = mqtt.connect(clientId, MQTT_USERNAME, MQTT_PASSWORD,
    statusTopic, 0, true, lwtPayload);
  if (!connected) {
    Serial.printf("MQTT connect failed, state=%d\n", mqtt.state());
    return false;
  }
  Serial.println("MQTT connected; publishing ONLINE and subscribing to command topic.");
  mqtt.publish(statusTopic, "{\"deviceId\":\"" DEVICE_ID "\",\"status\":\"ONLINE\"}", true);
  if (!mqtt.subscribe(commandTopic)) Serial.println("WARNING: command subscription failed.");
  flushRingBuffer();
  return true;
}

void readDoor() {
  const uint32_t now = millis();
  // Nút INPUT_PULLUP: LOW là đang giữ. Tín hiệu HIGH là đã thả nút và
  // luôn cho phép bắt đầu một lượt giữ mới, kể cả khi thả rất nhanh.
  const bool pressed = digitalRead(DOOR_PIN) == LOW;
  if (!pressed) {
    if (doorPressActive) Serial.println("Door button RELEASED; ready for next 5s hold.");
    doorPressActive = false;
    doorHoldHandled = false;
    return;
  }
  if (!doorPressActive) {
    doorPressActive = true;
    doorHoldHandled = false;
    doorPressedAtMs = now;
    Serial.println("Door button PRESSED; hold for 5s.");
  }

  // Không dùng delay(5000): MQTT, lấy mẫu và cảnh báo vẫn chạy khi giữ nút.
  // Mỗi lần giữ chỉ đổi một lần; phải thả nút rồi giữ tiếp để đổi lại.
  if (!doorHoldHandled && now - doorPressedAtMs >= DOOR_HOLD_MS) {
    doorHoldHandled = true;
    doorOpen = !doorOpen;
    doorOpenedAtMs = doorOpen ? now : 0;
    Serial.printf("Door changed: %s\n", doorOpen ? "OPEN" : "CLOSED");
    checkLocalAlerts();
  }
}

void updateSimulatedGPS() {
  const uint32_t now = millis();
  if (now - lastGpsStepMs >= GPS_STEP_MS) {
    lastGpsStepMs = now;
    routeIndex = (routeIndex + 1) % ROUTE_COUNT;
  }
}

void readSensors() {
  for (size_t i = 0; i < SENSOR_COUNT; ++i) {
    ++simulatedSensorReadCount[i];
    if (sensorForcedFault[i]) {
      readings[i].online = false;
      readings[i].temperature = NAN;
      readings[i].humidity = NAN;
      Serial.printf("S%u: FAULT (forced by Serial command)\n", static_cast<unsigned>(i + 1));
      continue;
    }
    TempAndHumidity value = dht[i].getTempAndHumidity();
    if (dht[i].getStatus() != DHTesp::ERROR_NONE || !isfinite(value.temperature) || !isfinite(value.humidity)) {
      readings[i].online = false;
      readings[i].temperature = NAN;
      readings[i].humidity = NAN;
      Serial.printf("S%u GPIO%u: FAULT (%s)\n", static_cast<unsigned>(i + 1), SENSOR_PINS[i], dht[i].getStatusString());
    } else {
      readings[i].online = true;
      readings[i].temperature = value.temperature;
      readings[i].humidity = value.humidity;
      Serial.printf("S%u GPIO%u: %.1f C, %.1f %%RH ONLINE\n", static_cast<unsigned>(i + 1), SENSOR_PINS[i], value.temperature, value.humidity);
    }
  }
}

bool publishAlert(const char* type, bool active, int sensorIndex, float temperature, float threshold) {
  if (!mqtt.connected()) return false;
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID_VALUE;
  doc["tripId"] = tripId;
  doc["type"] = type;
  doc["active"] = active;
  doc["timestamp"] = currentTimestamp();
  if (sensorIndex >= 0) {
    char sensorId[4]; snprintf(sensorId, sizeof(sensorId), "S%d", sensorIndex + 1);
    doc["sensorId"] = sensorId;
    if (isfinite(temperature)) doc["temperature"] = temperature;
    if (isfinite(threshold)) doc["threshold"] = threshold;
  }
  char payload[320];
  const size_t written = serializeJson(doc, payload, sizeof(payload));
  if (!written || written >= sizeof(payload)) return false;
  bool sent = mqtt.publish(alertTopic, payload);
  Serial.printf("Alert %s %s%s\n", type, active ? "ACTIVE" : "CLEARED", sent ? " published" : " (publish failed)");
  return sent;
}

void checkLocalAlerts() {
  bool anyAlert = false;
  for (size_t i = 0; i < SENSOR_COUNT; ++i) {
    bool active = readings[i].online && (readings[i].temperature < minTemperature || readings[i].temperature > maxTemperature);
    if (active != tempAlertActive[i]) {
      float threshold = readings[i].temperature < minTemperature ? minTemperature : maxTemperature;
      publishAlert("TEMPERATURE_EXCURSION", active, static_cast<int>(i), readings[i].temperature, threshold);
      tempAlertActive[i] = active;
    }
    anyAlert |= active;
  }
  bool transit = strcmp(tripState, "IN_TRANSIT") == 0;
  bool breach = transit && !deliveryMode && doorOpen;
  if (breach != doorBreachActive) {
    publishAlert("DOOR_BREACH", breach);
    doorBreachActive = breach;
  }
  bool tooLong = doorOpen && (millis() - doorOpenedAtMs >= maxDoorOpenSeconds * 1000UL);
  if (tooLong != doorTooLongActive) {
    publishAlert("DOOR_OPEN_TOO_LONG", tooLong);
    doorTooLongActive = tooLong;
  }
  anyAlert |= breach || tooLong;
  if (!anyAlert && redLedOn) {
    digitalWrite(RED_LED_PIN, LOW);
    noTone(BUZZER_PIN);
    redLedOn = false;
  }
}

void updateLocalIndicators() {
  const bool any = [&]() {
    if (doorBreachActive || doorTooLongActive) return true;
    for (bool active : tempAlertActive) if (active) return true;
    return false;
  }();
  digitalWrite(GREEN_LED_PIN, mqtt.connected() ? HIGH : LOW);
  if (!any) {
    if (redLedOn) { digitalWrite(RED_LED_PIN, LOW); noTone(BUZZER_PIN); redLedOn = false; }
    return;
  }
  const uint32_t now = millis();
  if (now - lastAlertBlinkMs >= ALERT_BLINK_MS) {
    lastAlertBlinkMs = now;
    redLedOn = !redLedOn;
    digitalWrite(RED_LED_PIN, redLedOn ? HIGH : LOW);
    if (redLedOn) tone(BUZZER_PIN, 2200); else noTone(BUZZER_PIN);
  }
}

String makeTelemetryPayload() {
  JsonDocument doc;
  char messageId[80];
  snprintf(messageId, sizeof(messageId), "%s-%08lx-%lu", DEVICE_ID_VALUE, static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(++messageSequence));
  doc["messageId"] = messageId;
  doc["deviceId"] = DEVICE_ID_VALUE;
  doc["tripId"] = tripId;
  doc["tripState"] = tripState;
  doc["profileId"] = profileId;
  doc["deliveryMode"] = deliveryMode;
  JsonArray array = doc["sensors"].to<JsonArray>();
  for (size_t i = 0; i < SENSOR_COUNT; ++i) {
    JsonObject sensor = array.add<JsonObject>();
    char sensorId[4]; snprintf(sensorId, sizeof(sensorId), "S%u", static_cast<unsigned>(i + 1));
    sensor["sensorId"] = sensorId;
    sensor["status"] = readings[i].online ? "ONLINE" : "FAULT";
    if (readings[i].online) {
      sensor["temperature"] = roundf(readings[i].temperature * 10.0f) / 10.0f;
      sensor["humidity"] = roundf(readings[i].humidity * 10.0f) / 10.0f;
    } else {
      sensor["temperature"] = nullptr;
      sensor["humidity"] = nullptr;
    }
  }
  doc["door"] = doorOpen ? "OPEN" : "CLOSED";
  doc["latitude"] = ROUTE[routeIndex].latitude;
  doc["longitude"] = ROUTE[routeIndex].longitude;
  doc["gpsSimulated"] = true;
  doc["timestamp"] = currentTimestamp();
  doc["timeSynchronized"] = clockSynchronized;
  doc["isBuffered"] = false;
  doc["type"] = "TELEMETRY";
  String payload;
  serializeJson(doc, payload);
  return payload;
}

bool publishTelemetry(const char* payload) {
  if (!mqtt.connected()) return false;
  // PubSubClient publishes at QoS 0: success means locally accepted for send,
  // not broker/backend delivery confirmation.
  return mqtt.publish(telemetryTopic, payload);
}

bool flushRingBuffer() {
  while (mqtt.connected() && ringCount > 0) {
    QueuedPacket& packet = ringBuffer[ringHead];
    if (!packet.used) { ringHead = (ringHead + 1) % RING_CAPACITY; --ringCount; continue; }
    JsonDocument doc;
    if (deserializeJson(doc, packet.payload)) {
      Serial.println("Ring packet JSON is invalid; discarding that RAM entry.");
      packet.used = false; ringHead = (ringHead + 1) % RING_CAPACITY; --ringCount; continue;
    }
    doc["isBuffered"] = true;
    char replay[MAX_PAYLOAD_BYTES];
    const size_t written = serializeJson(doc, replay, sizeof(replay));
    if (!written || written >= sizeof(replay) || !mqtt.publish(telemetryTopic, replay)) {
      Serial.println("Buffered publish failed; remaining packets retained in RAM.");
      return false;
    }
    Serial.printf("Buffered packet sent (best-effort QoS 0): %u remaining before pop.\n", static_cast<unsigned>(ringCount));
    packet.used = false;
    packet.payload[0] = '\0';
    ringHead = (ringHead + 1) % RING_CAPACITY;
    --ringCount;
    printBufferCount();
    mqtt.loop();
  }
  return ringCount == 0;
}

void sampleAndPublish() {
  readSensors();
  readDoor();
  updateSimulatedGPS();
  updateClockStatus();
  checkLocalAlerts();
  String payload = makeTelemetryPayload();
  Serial.printf("Door=%s | GPS(sim)=%.6f, %.6f | MQTT=%s\n", doorOpen ? "OPEN" : "CLOSED", ROUTE[routeIndex].latitude, ROUTE[routeIndex].longitude, mqtt.connected() ? "ONLINE" : "OFFLINE");
  Serial.println(payload);
  if (mqtt.connected() && ringCount == 0 && publishTelemetry(payload.c_str())) {
    Serial.println("Live telemetry accepted by PubSubClient (QoS 0; no PUBACK guarantee).");
  } else {
    storeToRingBuffer(payload.c_str());
    if (mqtt.connected()) flushRingBuffer();
  }
}

void setWifiOff() {
  wifiSuppressed = true;
  // Drop Wi-Fi without an MQTT DISCONNECT packet so the broker can exercise LWT.
  WiFi.disconnect(true, false);
  Serial.println("Wi-Fi dropped without MQTT DISCONNECT; reconnect suppressed. Local monitoring continues and broker LWT should mark the device OFFLINE.");
}

void setWifiOn() {
  wifiSuppressed = false;
  WiFi.mode(WIFI_STA);
  beginWiFiConnection();
  lastWifiAttemptMs = millis();
  Serial.println("Wi-Fi reconnect enabled.");
}

int sensorIndexFromId(const char* id) {
  if (!id || id[0] != 'S' || id[1] < '1' || id[1] > '5' || id[2] != '\0') return -1;
  return id[1] - '1';
}

void processSerialCommands() {
  static String line;
  while (Serial.available()) {
    char c = static_cast<char>(Serial.read());
    if (c == '\r') continue;
    if (c != '\n') { if (line.length() < 100) line += c; continue; }
    line.trim();
    if (line.equalsIgnoreCase("WIFI_OFF")) setWifiOff();
    else if (line.equalsIgnoreCase("WIFI_ON")) setWifiOn();
    else if (line.startsWith("SENSOR_FAIL ")) {
      int index = sensorIndexFromId(line.substring(12).c_str());
      if (index < 0) Serial.println("Usage: SENSOR_FAIL S1..S5");
      else { sensorForcedFault[index] = true; readings[index].online = false; Serial.printf("S%u forced to FAULT.\n", static_cast<unsigned>(index + 1)); }
    } else if (line.startsWith("SENSOR_RECOVER ")) {
      int index = sensorIndexFromId(line.substring(15).c_str());
      if (index < 0) Serial.println("Usage: SENSOR_RECOVER S1..S5");
      else { sensorForcedFault[index] = false; Serial.printf("S%u sensor fault simulation cleared.\n", static_cast<unsigned>(index + 1)); }
    } else if (line.length()) {
      Serial.println("Commands: WIFI_OFF, WIFI_ON, SENSOR_FAIL S2, SENSOR_RECOVER S2");
    }
    line = "";
  }
}

void setup() {
  Serial.begin(115200);
  snprintf(tripId, sizeof(tripId), "%s", TRIP_ID_VALUE);
  makeTopics();
  pinMode(DOOR_PIN, INPUT_PULLUP);
  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(GREEN_LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(GREEN_LED_PIN, LOW);
  doorPressActive = false;
  doorHoldHandled = false;
  doorOpen = false;
  doorOpenedAtMs = 0;
  for (size_t i = 0; i < SENSOR_COUNT; ++i) dht[i].setup(SENSOR_PINS[i], DHTesp::DHT22);
  mqtt.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(2048);
  mqtt.setKeepAlive(30);
  mqtt.setSocketTimeout(2);
  setupWiFi();
  Serial.printf("Booted %s. Sampling every %lu ms.\n", DEVICE_ID_VALUE, static_cast<unsigned long>(SAMPLE_INTERVAL_MS));
  Serial.println("GPS positions are simulated HCMC route coordinates.");
  Serial.printf("Topics: %s | %s | %s | %s\n", telemetryTopic, alertTopic, statusTopic, commandTopic);
}

void loop() {
  const uint32_t now = millis();
  processSerialCommands();
  readDoor();
  const bool wifiConnected = WiFi.status() == WL_CONNECTED;
  if (wifiConnected != lastWifiConnected) {
    lastWifiConnected = wifiConnected;
    if (wifiConnected) Serial.printf("Wi-Fi connected: %s\n", WiFi.localIP().toString().c_str());
    else Serial.println("Wi-Fi disconnected.");
  }
  if (!wifiSuppressed && !wifiConnected && now - lastWifiAttemptMs >= WIFI_RETRY_MS) {
    lastWifiAttemptMs = now;
    Serial.println("Wi-Fi offline; reconnecting while local monitoring continues.");
    WiFi.disconnect();
    beginWiFiConnection();
  }
  if (wifiConnected) {
    updateClockStatus();
    if (!mqtt.connected() && now - lastMqttAttemptMs >= MQTT_RETRY_MS) {
      lastMqttAttemptMs = now;
      reconnectMQTT();
    }
    if (mqtt.connected()) mqtt.loop();
  }
  checkLocalAlerts();
  updateLocalIndicators();
  if (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    lastSampleMs = now;
    sampleAndPublish();
  }
  delay(2);
}
