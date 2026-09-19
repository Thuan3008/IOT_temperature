#pragma once

// Copy this file to secrets.h. This file is local and must not be committed.
// In the Wokwi PlatformIO environment the Wi-Fi/broker host below are overridden
// with Wokwi-GUEST and host.wokwi.internal. MQTT account credentials remain yours.
#ifdef WOKWI_SIMULATION
#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""
#define MQTT_BROKER_HOST "host.wokwi.internal"
#define MQTT_BROKER_PORT 1883
#else
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define MQTT_BROKER_HOST "192.168.1.100"
#define MQTT_BROKER_PORT 1883
#endif

#define MQTT_USERNAME "esp32"
#define MQTT_PASSWORD "YOUR_ESP32_MQTT_PASSWORD"
