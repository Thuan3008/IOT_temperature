require("dotenv").config();

const express = require("express");
const cors = require("cors");

const poolPromise = require("./db");
const startMqtt = require("./mqttClient");
const { startTimeoutMonitor } = require("./timeoutMonitor");
const telemetryRoutes = require("./routes/telemetryRoutes");
const controlRoutes = require("./routes/controlRoutes");
const { streamTelemetry } = require("./liveTelemetry");

const app = express();

app.use(cors());
app.use(express.json());
app.get("/api/live", streamTelemetry);

app.get("/", (req, res) => {
  res.json({
    message: "Smart Cold Chain IoT Backend"
  });
});

app.get("/api/health", async (req, res) => {
  try {
    const pool = await poolPromise;

    await pool.request().query("SELECT 1");

    res.json({
      backend: "OK",
      database: "SQL Server Connected"
    });
  } catch (error) {
    res.status(503).json({
      backend: "OK",
      database: "Disconnected"
    });
  }
});

app.use("/api", telemetryRoutes);
app.use("/api/control", controlRoutes);

async function start() {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Backend running on port ${port}`));
  try { await poolPromise; }
  catch (error) { console.error(`Database unavailable: ${error.message}`); }
  startMqtt();
  startTimeoutMonitor();
}

start();
