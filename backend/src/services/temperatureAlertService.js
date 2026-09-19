function predictCrossingMinutes(history, current) {
  const points = [...history, current]
    .filter((point) => Number.isFinite(point.temperature) && Number.isFinite(point.time))
    .sort((a, b) => a.time - b.time);

  if (points.length < 3 || points.at(-1).time <= points[0].time) return null;

  const origin = points[0].time;
  const xs = points.map((point) => (point.time - origin) / 60000);
  const ys = points.map((point) => point.temperature);
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const denominator = xs.reduce((sum, value) => sum + ((value - meanX) ** 2), 0);
  if (!denominator) return null;

  const slope = xs.reduce((sum, value, index) => sum + ((value - meanX) * (ys[index] - meanY)), 0) / denominator;
  if (!Number.isFinite(slope) || Math.abs(slope) < 1e-9) return null;

  return { slope, current: points.at(-1).temperature };
}

function evaluateTemperatureAlerts({ sensors, minTemperature, maxTemperature, earlyWarningMinutes, historyBySensor, measuredAt }) {
  const alerts = [];
  const currentTime = new Date(measuredAt).getTime();

  for (const sensor of sensors) {
    if (sensor.status !== "ONLINE" || !Number.isFinite(sensor.temperature)) continue;

    const temperature = sensor.temperature;
    if (minTemperature !== null && minTemperature !== undefined && temperature < minTemperature) {
      alerts.push({
        sensorId: sensor.sensorId,
        type: "TEMPERATURE_EXCURSION",
        temperature,
        threshold: minTemperature,
        message: `${sensor.sensorId}: nhiệt độ ${temperature}°C thấp hơn ngưỡng ${minTemperature}°C`
      });
      continue;
    }
    if (maxTemperature !== null && maxTemperature !== undefined && temperature > maxTemperature) {
      alerts.push({
        sensorId: sensor.sensorId,
        type: "TEMPERATURE_EXCURSION",
        temperature,
        threshold: maxTemperature,
        message: `${sensor.sensorId}: nhiệt độ ${temperature}°C cao hơn ngưỡng ${maxTemperature}°C`
      });
      continue;
    }

    if (!Number.isFinite(currentTime) || earlyWarningMinutes <= 0) continue;
    const trend = predictCrossingMinutes(historyBySensor[sensor.sensorId] || [], {
      temperature,
      time: currentTime
    });
    if (!trend) continue;

    const candidates = [];
    if (minTemperature !== null && minTemperature !== undefined && trend.slope < 0) {
      candidates.push({ threshold: minTemperature, minutes: (minTemperature - temperature) / trend.slope });
    }
    if (maxTemperature !== null && maxTemperature !== undefined && trend.slope > 0) {
      candidates.push({ threshold: maxTemperature, minutes: (maxTemperature - temperature) / trend.slope });
    }
    const approaching = candidates.find((candidate) => candidate.minutes > 0 && candidate.minutes <= earlyWarningMinutes);
    if (approaching) {
      alerts.push({
        sensorId: sensor.sensorId,
        type: "EARLY_WARNING",
        temperature,
        threshold: approaching.threshold,
        message: `${sensor.sensorId}: xu hướng nhiệt độ dự kiến chạm ngưỡng ${approaching.threshold}°C trong khoảng ${approaching.minutes.toFixed(1)} phút`
      });
    }
  }

  return alerts;
}

module.exports = { evaluateTemperatureAlerts };
