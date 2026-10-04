const TELEGRAM_API = "https://api.telegram.org/bot";
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

// Giữ trạng thái trong RAM để tránh gửi lặp cùng một cảnh báo mỗi chu kỳ đo.
const recentlySent = new Map();
const urgentMessages = [];
const normalMessages = [];
let delivering = false;

async function drainTelegramQueue() {
  if (delivering) return;
  delivering = true;
  try {
    while (urgentMessages.length || normalMessages.length) {
      const item = urgentMessages.shift() || normalMessages.shift();
      try { await item.deliver(); }
      catch (error) { console.error(`Telegram queue failed: ${error.message}`); }
      item.done();
    }
  } finally {
    delivering = false;
  }
}

function enqueueTelegram(deliver, urgent) {
  return new Promise((done) => {
    (urgent ? urgentMessages : normalMessages).push({ deliver, done });
    void drainTelegramQueue();
  });
}

function isEnabled() {
  return String(process.env.TELEGRAM_ENABLED || "false").toLowerCase() === "true";
}

function getConfig() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) return null;
  return { token, chatId };
}

function formatAlert({ data, alert }) {
  const temperature = Number.isFinite(alert.temperature)
    ? `${alert.temperature.toFixed(1)}°C`
    : "không có dữ liệu";
  const threshold = Number.isFinite(alert.threshold)
    ? `${alert.threshold.toFixed(1)}°C`
    : "N/A";
  const location = Number.isFinite(data.latitude) && Number.isFinite(data.longitude)
    ? `${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`
    : "N/A";

  return [
    "⚠️ CẢNH BÁO CHUỖI LẠNH",
    `Thiết bị: ${data.deviceId}`,
    `Chuyến: ${data.tripId}`,
    `Cảm biến: ${alert.sensorId || "N/A"}`,
    `Loại: ${alert.type}`,
    `Nhiệt độ: ${temperature} (ngưỡng ${threshold})`,
    `Chi tiết: ${alert.message}`,
    `Cửa: ${data.door}`,
    `Vị trí: ${location}`,
    `Thời gian: ${data.timestamp}`
  ].join("\n");
}

async function sendTelegramMessage(config, text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${TELEGRAM_API}${config.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: config.chatId, text }),
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error(result.description || `HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function notifyTelegramAlerts(data, alerts) {
  if (!isEnabled() || !alerts?.length) return;

  const config = getConfig();
  if (!config) {
    console.warn("Telegram notification skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing");
    return;
  }

  for (const alert of alerts) {
    const key = [data.deviceId, data.tripId, alert.sensorId, alert.type].join(":");
    const deliver = async () => {
      // Check cooldown at delivery time: several callers may queue the same
      // alert before the first Telegram request finishes.
      const now = Date.now();
      const lastSent = recentlySent.get(key) || 0;
      const doorEvent = alert.type === "DOOR_BREACH" || alert.type === "DOOR_OPEN_TOO_LONG";
      if (!doorEvent && now - lastSent < ALERT_COOLDOWN_MS) return;
      try {
        await sendTelegramMessage(config, formatAlert({ data, alert }));
        recentlySent.set(key, Date.now());
        console.log(`Telegram alert sent: ${key}`);
      } catch (error) {
        console.error(`Telegram alert failed: ${error.message}`);
      }
    };
    const urgent = ["DOOR_BREACH", "DOOR_OPEN_TOO_LONG", "DEVICE_OFFLINE", "SENSOR_OFFLINE"].includes(alert.type);
    await enqueueTelegram(deliver, urgent);
  }
}

module.exports = { notifyTelegramAlerts };
