This directory is intentionally included so PlatformIO can provision a LittleFS image.
Flash this filesystem once on a new physical board before relying on Store & Forward:
    pio run --target uploadfs --environment esp32dev

Do not upload a filesystem image again while queued telemetry must be preserved; flashing
LittleFS replaces the queue contents. The firmware refuses to auto-format on mount failure.
