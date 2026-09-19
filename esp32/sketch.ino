#include <ArduinoJson.h>
#include <DHTesp.h>
#include <LittleFS.h>
#include <MQTT.h>
#include <WiFi.h>
#include <esp_system.h>
#include <time.h>
#include <sys/time.h>

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Copy secrets.example.h to secrets.h and configure Wi-Fi/MQTT before building"
#endif

#ifdef WOKWI_SIMULATION
#undef WIFI_SSID
#undef WIFI_PASSWORD
#undef MQTT_BROKER_HOST
#undef MQTT_BROKER_PORT
#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""
#define MQTT_BROKER_HOST "host.wokwi.internal"
#define MQTT_BROKER_PORT 1883
#endif

constexpr char DEVICE_ID[] = "ESP32-01";
constexpr char TRIP_ID[] = "TRIP001";
constexpr char TELEMETRY_TOPIC[] = "coldchain/v1/devices/ESP32-01/telemetry";
constexpr uint32_t SAMPLE_INTERVAL_MS = 5000;
constexpr uint32_t WIFI_RETRY_INTERVAL_MS = 10000;
constexpr uint32_t MQTT_RETRY_INTERVAL_MS = 5000;
constexpr size_t MAX_QUEUED_PACKETS = 512;

constexpr uint8_t SENSOR_PINS[] = {15, 16, 17, 18, 19};
DHTesp sensors[5];

WiFiClient network;
MQTTClient mqtt(1024);
uint64_t bootNonce = 0;
uint32_t messageSequence = 0;
uint64_t nextQueueId = 1;
uint32_t lastSampleAt = 0;
uint32_t lastWifiAttemptAt = 0;
uint32_t lastMqttAttemptAt = 0;
bool storageReady = false;

String queuePath(uint64_t id) {
  char path[32];
  snprintf(path, sizeof(path), "/q%020llu.json", static_cast<unsigned long long>(id));
  return String(path);
}

String normalizedPath(File& entry) {
  String name = entry.name();
  if (!name.startsWith("/")) name = "/" + name;
  return name;
}

size_t queuedPacketCount() {
  if (!storageReady) return 0;
  File root = LittleFS.open("/");
  if (!root || !root.isDirectory()) return 0;

  size_t count = 0;
  File entry = root.openNextFile();
  while (entry) {
    String name = normalizedPath(entry);
    if (!entry.isDirectory() && name.startsWith("/q") && name.endsWith(".json")) ++count;
    entry.close();
    entry = root.openNextFile();
  }
  root.close();
  return count;
}

String oldestQueuedPath() {
  if (!storageReady) return String();
  File root = LittleFS.open("/");
  if (!root || !root.isDirectory()) return String();

  String oldest;
  File entry = root.openNextFile();
  while (entry) {
    String name = normalizedPath(entry);
    if (!entry.isDirectory() && name.startsWith("/q") && name.endsWith(".json") &&
        (oldest.isEmpty() || name < oldest)) {
      oldest = name;
    }
    entry.close();
    entry = root.openNextFile();
  }
  root.close();
  return oldest;
}

bool initializeStorage() {
  // Wokwi starts with a blank simulated flash, so format only in the isolated simulator.
#ifdef WOKWI_SIMULATION
  if (!LittleFS.begin(true)) {
    Serial.println("ERROR: could not initialize simulated LittleFS.");
    return false;
  }
#else
  // On hardware never auto-format on mount failure; queued telemetry must survive.
  if (!LittleFS.begin(false)) {
    Serial.println("ERROR: LittleFS unavailable; refusing to format so queued data is not erased.");
    return false;
  }
#endif

  File root = LittleFS.open("/");
  File entry = root.openNextFile();
  while (entry) {
    String name = normalizedPath(entry);
    if (!entry.isDirectory() && name.startsWith("/q") && name.endsWith(".json")) {
      String digits = name.substring(2, name.length() - 5);
      uint64_t id = strtoull(digits.c_str(), nullptr, 10);
      if (id >= nextQueueId) nextQueueId = id + 1;
    }
    entry.close();
    entry = root.openNextFile();
  }
  root.close();
  Serial.printf("LittleFS ready; %u buffered packet(s) found.\n", static_cast<unsigned>(queuedPacketCount()));
  return true;
}

bool enqueueBuffered(const String& payload) {
  if (!storageReady) {
    Serial.println("ERROR: cannot buffer telemetry because LittleFS is unavailable.");
    return false;
  }
  const size_t count = queuedPacketCount();
  if (count >= MAX_QUEUED_PACKETS) {
    Serial.println("CRITICAL: Store & Forward queue is full; sample was not persisted.");
    return false;
  }

  const uint64_t id = nextQueueId;
  String path = queuePath(id);
  File file = LittleFS.open(path, FILE_WRITE);
  if (!file) {
    Serial.printf("ERROR: could not open queue file %s\n", path.c_str());
    return false;
  }
  size_t written = file.print(payload);
  file.flush();
  file.close();
  if (written != payload.length()) {
    LittleFS.remove(path);
    Serial.println("ERROR: incomplete queue write; sample was not acknowledged or discarded silently.");
    return false;
  }
  ++nextQueueId;
  Serial.printf("Buffered packet %llu (%u/%u).\n",
    static_cast<unsigned long long>(id), static_cast<unsigned>(count + 1),
    static_cast<unsigned>(MAX_QUEUED_PACKETS));
  return true;
}

bool publishPayload(const String& payload) {
  if (!mqtt.connected()) return false;
  // MQTT QoS 1 publish returns true only after the publish exchange is acknowledged.
  return mqtt.publish(TELEMETRY_TOPIC, payload, false, 1);
}

void drainQueue() {
  while (mqtt.connected() && storageReady) {
    String path = oldestQueuedPath();
    if (path.isEmpty()) return;

    File file = LittleFS.open(path, FILE_READ);
    if (!file) {
      Serial.printf("ERROR: cannot read oldest queue record %s; stopping FIFO drain.\n", path.c_str());
      return;
    }
    String payload = file.readString();
    file.close();

    JsonDocument doc;
    DeserializationError parseError = deserializeJson(doc, payload);
    if (parseError || !doc["messageId"].is<const char*>()) {
      Serial.printf("ERROR: invalid queued record %s; preserving it and stopping drain.\n", path.c_str());
      return;
    }
    doc["isBuffered"] = true;
    String bufferedPayload;
    serializeJson(doc, bufferedPayload);

    Serial.printf("Replaying buffered packet %s...\n", doc["messageId"].as<const char*>());
    if (!publishPayload(bufferedPayload)) {
      Serial.println("MQTT PUBACK not received; keeping packet and stopping FIFO drain.");
      return;
    }
    if (!LittleFS.remove(path)) {
      // If power/storage fails here, the next replay uses the same messageId and
      // the backend's unique key safely deduplicates it.
      Serial.printf("WARNING: PUBACK received but could not remove %s; it will be replayed.\n", path.c_str());
      return;
    }
    Serial.printf("PUBACK received; removed %s from queue.\n", path.c_str());
  }
}

String timestampNow() {
  time_t now = time(nullptr);
  struct tm utcTime;
  gmtime_r(&now, &utcTime);
  char value[25];
  strftime(value, sizeof(value), "%Y-%m-%dT%H:%M:%SZ", &utcTime);
  return String(value);
}

String createTelemetryPayload(bool buffered) {
  JsonDocument doc;
  char messageId[80];
  snprintf(messageId, sizeof(messageId), "%s-%08lx%08lx-%lu", DEVICE_ID,
    static_cast<unsigned long>(bootNonce >> 32),
    static_cast<unsigned long>(bootNonce & 0xFFFFFFFFULL),
    static_cast<unsigned long>(++messageSequence));

  doc["messageId"] = messageId;
  doc["deviceId"] = DEVICE_ID;
  doc["tripId"] = TRIP_ID;
  JsonArray readings = doc["sensors"].to<JsonArray>();
  for (uint8_t i = 0; i < 5; ++i) {
    TempAndHumidity reading = sensors[i].getTempAndHumidity();
    float temperature = reading.temperature;
    float humidity = reading.humidity;
    Serial.printf("DHT S%u GPIO%u: %s (T=%.2f, H=%.2f)\n",
      static_cast<unsigned>(i + 1), SENSOR_PINS[i], sensors[i].getStatusString(),
      temperature, humidity);
    JsonObject item = readings.add<JsonObject>();
    char sensorId[3];
    snprintf(sensorId, sizeof(sensorId), "S%u", static_cast<unsigned>(i + 1));
    item["sensorId"] = sensorId;
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
  doc["timestamp"] = timestampNow();
  doc["isBuffered"] = buffered;
  doc["type"] = "TELEMETRY";

  String payload;
  serializeJson(doc, payload);
  return payload;
}

void sampleAndSend() {
  bool mustBuffer = !mqtt.connected() || queuedPacketCount() > 0;
  String payload = createTelemetryPayload(mustBuffer);
  Serial.println(payload);

  if (mustBuffer) {
    enqueueBuffered(payload);
    if (mqtt.connected()) drainQueue();
    return;
  }

  if (publishPayload(payload)) {
    Serial.println("Telemetry PUBACK received; live packet delivered.");
    return;
  }

  Serial.println("Live publish not acknowledged; preserving packet for Store & Forward.");
  JsonDocument doc;
  if (deserializeJson(doc, payload)) {
    Serial.println("ERROR: could not mark failed live packet as buffered.");
    return;
  }
  doc["isBuffered"] = true;
  String bufferedPayload;
  serializeJson(doc, bufferedPayload);
  enqueueBuffered(bufferedPayload);
}

void setup() {
  Serial.begin(115200);
  bootNonce = (static_cast<uint64_t>(esp_random()) << 32) | esp_random();
  for (uint8_t i = 0; i < 5; ++i) {
    sensors[i].setup(SENSOR_PINS[i], DHTesp::DHT22);
  }

  setenv("TZ", "UTC0", 1);
  tzset();
  struct tm buildTime = {};
  char month[4] = {};
  int day = 0, year = 0, hour = 0, minute = 0, second = 0;
  sscanf(__DATE__, "%3s %d %d", month, &day, &year);
  sscanf(__TIME__, "%d:%d:%d", &hour, &minute, &second);
  const char* months[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
  for (int i = 0; i < 12; ++i) if (strcmp(month, months[i]) == 0) buildTime.tm_mon = i;
  buildTime.tm_mday = day;
  buildTime.tm_year = year - 1900;
  buildTime.tm_hour = hour;
  buildTime.tm_min = minute;
  buildTime.tm_sec = second;
  struct timeval fallbackTime = {mktime(&buildTime), 0};
  settimeofday(&fallbackTime, nullptr);

  storageReady = initializeStorage();
  mqtt.begin(MQTT_BROKER_HOST, MQTT_BROKER_PORT, network);
  mqtt.setOptions(30, true, 2500);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttemptAt = millis();
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.printf("Booted %s; sampling every %lu ms.\n", DEVICE_ID, static_cast<unsigned long>(SAMPLE_INTERVAL_MS));
}

void loop() {
  const uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED && now - lastWifiAttemptAt >= WIFI_RETRY_INTERVAL_MS) {
    lastWifiAttemptAt = now;
    Serial.println("Wi-Fi offline; retrying while sensor sampling continues.");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }

  if (WiFi.status() == WL_CONNECTED) {
    if (!mqtt.connected() && now - lastMqttAttemptAt >= MQTT_RETRY_INTERVAL_MS) {
      lastMqttAttemptAt = now;
      Serial.printf("Wi-Fi connected (%s); connecting MQTT...\n", WiFi.localIP().toString().c_str());
      if (mqtt.connect(DEVICE_ID, MQTT_USERNAME, MQTT_PASSWORD)) {
        Serial.println("MQTT connected; starting FIFO replay.");
        drainQueue();
      } else {
        Serial.println("MQTT connection failed; telemetry will be buffered.");
      }
    }
    if (mqtt.connected()) mqtt.loop();
  }

  if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
    lastSampleAt = now;
    sampleAndSend();
  }
  delay(10);
}
