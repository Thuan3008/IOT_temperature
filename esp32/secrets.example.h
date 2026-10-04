#pragma once

// Copy this file to secrets.h. This file is local and must not be committed.
// Edit these values to match the broker reachable from your Wokwi environment.
#ifdef WOKWI_SIMULATION
#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""
#define WOKWI_MQTT_BROKER_HOST "host.wokwi.internal"
#define WOKWI_MQTT_BROKER_PORT 1883
#else
#define WIFI_SSID "HUIT_GV"
#define WIFI_PASSWORD "mku53t27"
#define MQTT_BROKER_HOST "172.17.23.96"
#define MQTT_BROKER_PORT 1883
#endif

#define MQTT_USERNAME "esp32"
#define MQTT_PASSWORD "123456"
